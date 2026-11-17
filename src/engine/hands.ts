/**
 * Reads WebXR hand joints each frame and exposes "tips": the points of the
 * hand that can hit things (fingertips and palm), with smoothed velocity.
 * Pure TypeScript (no three.js) so the server's self-playtest can reuse the
 * same Tip shape with a virtual fingertip. Allocates nothing per frame.
 */

import type { Handedness, Tip } from './tip.js';

export type { Handedness, Tip };

const TIP_JOINTS: { joint: XRHandJoint | 'palm'; radius: number }[] = [
  { joint: 'index-finger-tip', radius: 0.009 },
  { joint: 'middle-finger-tip', radius: 0.009 },
  { joint: 'thumb-tip', radius: 0.01 },
  { joint: 'palm', radius: 0.03 },
];

/** Number of past samples used for velocity: averages out tracking jitter. */
const HISTORY = 4;
const PINCH_ON = 0.015;
const PINCH_OFF = 0.03;

class TipHistory {
  readonly px = new Float64Array(HISTORY);
  readonly py = new Float64Array(HISTORY);
  readonly pz = new Float64Array(HISTORY);
  readonly t = new Float64Array(HISTORY);
  count = 0;
  head = 0;
  push(x: number, y: number, z: number, time: number) {
    this.head = (this.head + 1) % HISTORY;
    this.px[this.head] = x; this.py[this.head] = y; this.pz[this.head] = z; this.t[this.head] = time;
    this.count = Math.min(HISTORY, this.count + 1);
  }
  reset() { this.count = 0; }
  /** Velocity between the oldest and newest sample. */
  velocity(out: Tip) {
    if (this.count < 2) { out.vx = out.vy = out.vz = 0; return; }
    const oldest = (this.head - this.count + 1 + HISTORY) % HISTORY;
    const dt = this.t[this.head] - this.t[oldest];
    if (dt <= 1e-4) { out.vx = out.vy = out.vz = 0; return; }
    out.vx = (this.px[this.head] - this.px[oldest]) / dt;
    out.vy = (this.py[this.head] - this.py[oldest]) / dt;
    out.vz = (this.pz[this.head] - this.pz[oldest]) / dt;
  }
}

export interface PinchState { active: boolean; started: boolean; ended: boolean; x: number; y: number; z: number }

/** Palm pose: centre, normal (out of the palm) and forward (toward the fingers), world space. */
export interface PalmPose { valid: boolean; x: number; y: number; z: number; nx: number; ny: number; nz: number; fx: number; fy: number; fz: number }

/** Flip if palm detection is upside down on a device (console: conjure.palmSign = -1). */
export const PALM = { sign: 1 };

export class HandTracker {
  readonly tips: Tip[] = [];
  readonly pinch: Record<Handedness, PinchState> = {
    left: { active: false, started: false, ended: false, x: 0, y: 0, z: 0 },
    right: { active: false, started: false, ended: false, x: 0, y: 0, z: 0 },
  };
  readonly palms: Record<Handedness, PalmPose> = {
    left: { valid: false, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, fx: 0, fy: 0, fz: -1 },
    right: { valid: false, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, fx: 0, fy: 0, fz: -1 },
  };
  private readonly histories: TipHistory[] = [];
  private readonly j = { w: new Float64Array(3), i: new Float64Array(3), p: new Float64Array(3), m: new Float64Array(3) };
  private readonly scratch = new Float64Array(3);

  constructor() {
    for (const hand of ['left', 'right'] as const) {
      for (const { joint, radius } of TIP_JOINTS) {
        this.tips.push({ hand, joint, active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, radius });
        this.histories.push(new TipHistory());
      }
    }
  }

  /**
   * @param toWorld column-major 4x4 matrix (three.js Matrix4.elements) mapping
   *   the XR reference space into world space (the player rig's matrixWorld).
   * @param time seconds
   */
  update(frame: XRFrame, refSpace: XRReferenceSpace, toWorld: ArrayLike<number>, time: number) {
    for (const t of this.tips) t.active = false;
    for (const p of Object.values(this.pinch)) { p.started = false; p.ended = false; }
    this.palms.left.valid = false;
    this.palms.right.valid = false;

    for (const source of frame.session.inputSources) {
      const hand = source.hand;
      const side = source.handedness;
      if (!hand || (side !== 'left' && side !== 'right')) continue;
      const base = side === 'left' ? 0 : TIP_JOINTS.length;

      for (let i = 0; i < TIP_JOINTS.length; i++) {
        const tip = this.tips[base + i];
        const ok = TIP_JOINTS[i].joint === 'palm'
          ? this.palmPosition(frame, hand, refSpace, toWorld)
          : this.jointPosition(frame, hand.get(TIP_JOINTS[i].joint as XRHandJoint), refSpace, toWorld);
        if (!ok) continue;
        tip.active = true;
        tip.x = this.scratch[0]; tip.y = this.scratch[1]; tip.z = this.scratch[2];
        this.histories[base + i].push(tip.x, tip.y, tip.z, time);
        this.histories[base + i].velocity(tip);
      }

      this.updatePalm(frame, hand, refSpace, toWorld, side);

      const index = this.tips[base];
      const thumb = this.tips[base + 2];
      const pinch = this.pinch[side];
      if (index.active && thumb.active) {
        const d = Math.hypot(index.x - thumb.x, index.y - thumb.y, index.z - thumb.z);
        const was = pinch.active;
        pinch.active = was ? d < PINCH_OFF : d < PINCH_ON;
        pinch.started = !was && pinch.active;
        pinch.ended = was && !pinch.active;
        pinch.x = (index.x + thumb.x) / 2; pinch.y = (index.y + thumb.y) / 2; pinch.z = (index.z + thumb.z) / 2;
      }
    }
    for (let i = 0; i < this.tips.length; i++) if (!this.tips[i].active) this.histories[i].reset();
  }

  /** Clear all tracking (session ended). */
  reset() {
    for (const t of this.tips) t.active = false;
    for (const h of this.histories) h.reset();
    for (const p of Object.values(this.pinch)) p.active = p.started = p.ended = false;
  }

  private updatePalm(frame: XRFrame, hand: XRHand, ref: XRReferenceSpace, m: ArrayLike<number>, side: Handedness) {
    const get = (name: XRHandJoint, out: Float64Array) => {
      if (!this.jointPosition(frame, hand.get(name), ref, m)) return false;
      out.set(this.scratch);
      return true;
    };
    const { w, i, p, m: mid } = this.j;
    if (!get('wrist', w) || !get('index-finger-metacarpal', i) || !get('pinky-finger-metacarpal', p) || !get('middle-finger-phalanx-proximal', mid)) return;
    const ax = i[0] - w[0], ay = i[1] - w[1], az = i[2] - w[2];
    const bx = p[0] - w[0], by = p[1] - w[1], bz = p[2] - w[2];
    // cross(index - wrist, pinky - wrist) points out of the back of the left hand
    // and out of the palm of the right hand.
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const s = (side === 'left' ? -1 : 1) * PALM.sign / (Math.hypot(nx, ny, nz) || 1);
    nx *= s; ny *= s; nz *= s;
    let fx = mid[0] - w[0], fy = mid[1] - w[1], fz = mid[2] - w[2];
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    const palm = this.palms[side];
    palm.valid = true;
    palm.x = (w[0] + mid[0]) / 2; palm.y = (w[1] + mid[1]) / 2; palm.z = (w[2] + mid[2]) / 2;
    palm.nx = nx; palm.ny = ny; palm.nz = nz; palm.fx = fx; palm.fy = fy; palm.fz = fz;
  }

  private jointPosition(frame: XRFrame, space: XRJointSpace | undefined, ref: XRReferenceSpace, m: ArrayLike<number>) {
    if (!space || !frame.getJointPose) return false;
    const pose = frame.getJointPose(space, ref);
    if (!pose) return false;
    const p = pose.transform.position;
    this.toWorld(p.x, p.y, p.z, m);
    return true;
  }

  /** WebXR has no palm joint: approximate it between wrist and middle knuckle. */
  private palmPosition(frame: XRFrame, hand: XRHand, ref: XRReferenceSpace, m: ArrayLike<number>) {
    if (!frame.getJointPose) return false;
    const a = frame.getJointPose(hand.get('wrist')!, ref);
    const b = frame.getJointPose(hand.get('middle-finger-phalanx-proximal')!, ref);
    if (!a || !b) return false;
    const pa = a.transform.position, pb = b.transform.position;
    this.toWorld((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, (pa.z + pb.z) / 2, m);
    return true;
  }

  private toWorld(x: number, y: number, z: number, m: ArrayLike<number>) {
    this.scratch[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
    this.scratch[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    this.scratch[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
}
