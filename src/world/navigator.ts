/**
 * Moves the WORLD, not the user. In passthrough AR the room stays put, so to
 * travel through a conjured world we move, turn and scale the world anchor
 * around the user. Seated-friendly: no walking needed.
 *
 *   table      the miniature sits in front of you (or on your left palm)
 *   immersive  the world is life-size around you and keeps going forever
 *
 * Inputs (all optional, whatever the device has):
 *   hands        pinch + drag in the air = pull the world; two-hand pinch = scale/turn
 *                (pull apart past ~2.5x to step inside, squeeze together to leave)
 *   controllers  left stick = walk, right stick left/right = snap turn,
 *                right stick up/down = step in / step out, grip + drag = pull the world
 *   keyboard     W/S = walk, A/D = turn, I = step in/out (desktop browser)
 *
 * Anchor pose: world = P + Ry(yaw) * (scale * local).
 */
import { Group, Vector3 } from '@iwsdk/core';
import type { PalmPose } from '../engine/hands.js';

export type NavMode = 'table' | 'immersive';

export interface Grab { active: boolean; x: number; y: number; z: number }

export interface NavInput {
  dt: number;
  xr: boolean;
  /** Head position and horizontal forward, world space. */
  head: Vector3;
  forward: Vector3;
  floorY: number;
  /** A world is loaded (only worlds can be entered). */
  canEnter: boolean;
  stickL: { x: number; y: number };
  stickR: { x: number; y: number };
  grabL: Grab;
  grabR: Grab;
  /** Left palm for holding the miniature. */
  palm: PalmPose | null;
  keys: { forward: number; turn: number; run?: boolean };
}

export const NAV = {
  /** World scale when you step inside: 40 = a 4 cm person is 1.6 m, a 17 cm tree is 7 m. */
  immersiveScale: 40,
  /** Step inside automatically once a newly conjured world has assembled. */
  autoEnter: true,
  /** Walking speed, metres per second. */
  /** Walking speed (m/s); Shift runs at runFactor x. */
  speed: 5,
  runFactor: 2.5,
  /** Pulling the world with a hand moves you this many times the hand's travel. */
  pullGain: 4,
  snapTurnDeg: 30,
  /** Two-hand scaling: release above this to step inside, below exitScale to step out. */
  enterScale: 2.5,
  exitScale: 1.8,
  minScale: 0.3,
  maxScale: 80,
};

interface Pose { p: Vector3; yaw: number; s: number }
interface Tween { from: Pose; to: Pose; pivot: Vector3; t: number; dur: number; then: NavMode; glide?: boolean }

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Navigator {
  mode: NavMode = 'table';
  readonly table: Pose = { p: new Vector3(), yaw: 0, s: 1 };
  /** World held on the left palm (table mode, worlds only). */
  holding = false;
  palmEnabled = true;
  onModeChange: ((mode: NavMode) => void) | null = null;
  /** Metres the user travelled last frame (footsteps). */
  moved = 0;

  private tween: Tween | null = null;
  private palmUp = 0;
  private palmDown = 0;
  private two: { d0: number; a0: number; local: Vector3; s0: number; yaw0: number } | null = null;
  private one: { hand: 'L' | 'R'; last: Vector3; start: Vector3; engaged: boolean } | null = null;
  private turnLatch = false;
  private scaleLatch = false;
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private headLocal = new Vector3();

  constructor(private anchor: Group, private groundAt: (lx: number, lz: number) => number) {}

  get scale() { return this.anchor.scale.x; }

  // --- Voice movement -------------------------------------------------------
  /** Walk on by itself (voice "keep walking"): 1 forward, 0 standing. */
  autoWalk = 0;
  /** Voice "faster" / "slower". */
  boost = 1;
  private pendingTurn = 0;

  /** Turn smoothly by `rad` (voice "turn left", "turn around"). */
  turnBy(rad: number) { this.pendingTurn += rad; }

  /** Stop every voice-driven motion (and any glide under way). */
  stopVoice() {
    this.autoWalk = 0;
    this.pendingTurn = 0;
    if (this.tween && this.tween.then === 'immersive' && this.mode === 'immersive' && this.tween.glide) this.tween = null;
  }

  /**
   * Glide to a spot of the world (anchor units), stopping `standoff` short of it and,
   * if `face`, turning so it is straight ahead when you arrive. Inside only.
   */
  travelTo(head: Vector3, forward: Vector3, floorY: number, x: number, z: number, standoff = 0.05, face = true) {
    if (this.mode !== 'immersive') return false;
    this.autoWalk = 0;
    this.pendingTurn = 0;
    const from = this.toLocal(head, new Vector3());
    let dx = x - from.x, dz = z - from.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return false;
    const ux = dx / d, uz = dz / d;
    const go = Math.max(0, d - standoff);
    const tx = from.x + ux * go, tz = from.z + uz * go;
    const yaw0 = this.anchor.rotation.y, s = this.scale;
    let yaw = yaw0;
    if (face) {
      // World direction of the trip now, then the turn that points it along your gaze.
      const c = Math.cos(yaw0), sn = Math.sin(yaw0);
      const wx = c * ux + sn * uz, wz = -sn * ux + c * uz;
      yaw = wrap(yaw0 + Math.atan2(forward.x, forward.z) - Math.atan2(wx, wz));
    }
    dx = tx; dz = tz;
    const pivot = new Vector3(dx, this.groundAt(dx, dz), dz);
    const to: Pose = { p: new Vector3(), yaw, s };
    this.poseFromPivot(pivot, new Vector3(head.x, floorY, head.z), yaw, s, to.p);
    // About 10 m/s, never longer than 3.5 s (a gentle, eased glide).
    const metres = go * s;
    this.startTween(to, pivot, Math.min(3.5, Math.max(0.7, metres / 10)), 'immersive');
    this.tween!.glide = true;
    return true;
  }
  get busy() { return this.tween !== null || this.two !== null; }

  /** Table placement (called by place()). */
  setTable(pos: Vector3, yaw: number) {
    this.table.p.copy(pos); this.table.yaw = yaw;
    if (this.mode === 'table' && !this.tween) this.applyPose(this.table);
  }

  /** Big worlds are shown smaller on the table so they fit. */
  setTableScale(s: number) {
    this.table.s = s;
  }

  /** Where you land when stepping inside (world units), set per world. */
  landing = new Vector3(0, 0, 0.17);

  /** Where the user's head is in world units (for chunk streaming). */
  headInWorld(head: Vector3, out = this.headLocal) { return this.toLocal(head, out); }

  /** Step inside: grow the world around you, landing on its near shore. */
  enter(head: Vector3, floorY: number, landing: Vector3) {
    if (this.mode === 'immersive' || this.tween?.then === 'immersive') return;
    const s = NAV.immersiveScale;
    const pivot = landing.clone();
    pivot.y = this.groundAt(pivot.x, pivot.z);
    const to: Pose = { p: new Vector3(), yaw: this.anchor.rotation.y, s };
    this.poseFromPivot(pivot, this.tmp.set(head.x, floorY, head.z), to.yaw, s, to.p);
    this.startTween(to, pivot, 1.6, 'immersive');
    this.holding = false;
  }

  /** Step out: the world shrinks back onto the table. */
  exit() {
    if (this.mode === 'table' && !this.tween) return;
    this.startTween({ p: this.table.p.clone(), yaw: this.table.yaw, s: this.table.s }, new Vector3(0, 0, 0), 1.2, 'table');
  }

  /** Back to the table immediately (new creation, not a world). */
  reset() {
    this.tween = null; this.two = null; this.one = null; this.holding = false;
    this.setMode('table');
    this.applyPose(this.table);
  }

  update(i: NavInput) {
    const dt = Math.min(i.dt, 1 / 20);
    this.moved = 0;
    if (!i.canEnter && this.mode === 'immersive' && !this.tween) this.reset();

    // Step in / out: right stick up/down, or the I key.
    const sy = i.stickR.y;
    if (Math.abs(sy) > 0.7 && !this.scaleLatch) {
      this.scaleLatch = true;
      if (sy < 0 && i.canEnter && this.mode === 'table') this.enterFromTable(i);
      else if (sy > 0 && this.mode === 'immersive') this.exit();
    } else if (Math.abs(sy) < 0.3) this.scaleLatch = false;

    if (this.tween) { this.stepTween(dt); return; }

    if (this.twoHands(i)) return;
    this.oneHand(i);

    if (this.mode === 'immersive') this.walk(i, dt);
    else this.tableHold(i, dt);
  }

  /** Called by the I key / HUD: toggle. */
  toggle(i: Pick<NavInput, 'head' | 'floorY' | 'canEnter'>) {
    if (this.mode === 'immersive' || this.tween?.then === 'immersive') this.exit();
    else if (i.canEnter) this.enterFromTable(i);
  }

  private enterFromTable(i: Pick<NavInput, 'head' | 'floorY'>) {
    // Land at the world's spawn (on the near shore), facing its middle.
    this.enter(i.head, i.floorY, this.landing.clone());
  }

  private walk(i: NavInput, dt: number) {
    const p = this.anchor.position;
    let fwd = -i.stickL.y + i.keys.forward;
    const side = i.stickL.x;
    // Any hand on the stick or keys takes over from voice walking.
    if (Math.abs(fwd) > 0.12 || Math.abs(side) > 0.12) this.autoWalk = 0;
    fwd += this.autoWalk;
    fwd = Math.max(-1, Math.min(1, fwd));
    if (Math.abs(fwd) > 0.12 || Math.abs(side) > 0.12) {
      const f = i.forward;
      const speed = NAV.speed * (i.keys.run ? NAV.runFactor : 1) * this.boost;
      const dx = (f.x * fwd + -f.z * side) * speed * dt;
      const dz = (f.z * fwd + f.x * side) * speed * dt;
      p.x -= dx; p.z -= dz;
      this.moved += Math.hypot(dx, dz);
    }
    // Snap turn on the right stick, smooth turn on the keyboard.
    const sx = i.stickR.x;
    if (Math.abs(sx) > 0.7 && !this.turnLatch) {
      this.turnLatch = true;
      this.turnAround(i.head, Math.sign(sx) * (NAV.snapTurnDeg * Math.PI) / 180);
    } else if (Math.abs(sx) < 0.3) this.turnLatch = false;
    if (i.keys.turn) this.turnAround(i.head, i.keys.turn * dt * 1.6);
    if (this.pendingTurn) {
      const step = Math.sign(this.pendingTurn) * Math.min(Math.abs(this.pendingTurn), dt * 2.6);
      this.turnAround(i.head, step);
      this.pendingTurn -= step;
      if (Math.abs(this.pendingTurn) < 1e-3) this.pendingTurn = 0;
    }

    // Follow the ground (and the sea surface) so you walk over hills.
    const local = this.toLocal(i.head, this.tmp);
    const target = i.floorY - this.groundAt(local.x, local.z) * this.scale;
    p.y += (target - p.y) * (1 - Math.exp(-dt * 5));
  }

  /** Turn the world around the head (mouse look, snap turn). */
  turnAround(head: Vector3, angle: number) {
    const p = this.anchor.position;
    const dx = p.x - head.x, dz = p.z - head.z;
    const c = Math.cos(angle), s = Math.sin(angle);
    p.x = head.x + c * dx + s * dz;
    p.z = head.z - s * dx + c * dz;
    this.anchor.rotation.y = wrap(this.anchor.rotation.y + angle);
  }

  /** One hand (pinch or grip) dragging the air pulls the world along. */
  private oneHand(i: NavInput) {
    const g = i.grabR.active ? i.grabR : i.grabL.active ? i.grabL : null;
    const hand = i.grabR.active ? 'R' : 'L';
    if (!g || (this.mode === 'table' && this.holding)) { this.endOne(); return; }
    const cur = this.tmp2.set(g.x, g.y, g.z);
    if (!this.one || this.one.hand !== hand) {
      this.one = { hand, last: cur.clone(), start: cur.clone(), engaged: false };
      return;
    }
    // A short dead zone so a pinch to select something doesn't nudge the world.
    if (!this.one.engaged && cur.distanceTo(this.one.start) > 0.025) this.one.engaged = true;
    if (this.one.engaged) {
      const p = this.anchor.position;
      if (this.mode === 'immersive') {
        const dx = (cur.x - this.one.last.x) * NAV.pullGain, dz = (cur.z - this.one.last.z) * NAV.pullGain;
        p.x += dx; p.z += dz;
        this.moved += Math.hypot(dx, dz);
      } else {
        p.x += cur.x - this.one.last.x; p.y += cur.y - this.one.last.y; p.z += cur.z - this.one.last.z;
        this.table.p.copy(p);
      }
    }
    this.one.last.copy(cur);
  }

  private endOne() { this.one = null; }

  /** Two hands pinching: scale and turn the world around the midpoint. */
  private twoHands(i: NavInput): boolean {
    const both = i.grabL.active && i.grabR.active && !(this.mode === 'table' && this.holding);
    if (!both) {
      if (this.two) this.releaseTwo();
      return false;
    }
    this.one = null;
    const dx = i.grabR.x - i.grabL.x, dz = i.grabR.z - i.grabL.z;
    const d = Math.max(0.02, Math.hypot(dx, i.grabR.y - i.grabL.y, dz));
    const a = Math.atan2(-dz, dx);
    const mid = this.tmp.set((i.grabL.x + i.grabR.x) / 2, (i.grabL.y + i.grabR.y) / 2, (i.grabL.z + i.grabR.z) / 2);
    if (!this.two) {
      this.two = { d0: d, a0: a, local: this.toLocal(mid, new Vector3()), s0: this.scale, yaw0: this.anchor.rotation.y };
      return true;
    }
    const ratio = d / this.two.d0;
    const s = Math.min(NAV.maxScale, Math.max(NAV.minScale, this.two.s0 * ratio * ratio));
    const yaw = wrap(this.two.yaw0 + (a - this.two.a0));
    this.anchor.scale.setScalar(s);
    this.anchor.rotation.y = yaw;
    this.poseFromPivot(this.two.local, mid, yaw, s, this.anchor.position);
    return true;
  }

  private releaseTwo() {
    const s = this.scale;
    this.two = null;
    if (this.mode === 'table') {
      if (s >= NAV.enterScale) { this.setMode('immersive'); return; }
      this.table.p.copy(this.anchor.position); this.table.yaw = this.anchor.rotation.y; this.table.s = s;
    } else if (s < NAV.exitScale) {
      this.exit();
    }
  }

  /** Table mode: rest on the table, or float onto the left palm (worlds). */
  private tableHold(i: NavInput, dt: number) {
    const palm = i.palm;
    const up = i.canEnter && this.palmEnabled && !!palm && palm.valid && palm.ny > 0.55;
    if (up) { this.palmUp += dt; this.palmDown = 0; } else { this.palmDown += dt; this.palmUp = 0; }
    if (!this.holding && this.palmUp > 0.25) this.holding = true;
    if (this.holding && (this.palmDown > 0.5 || !i.canEnter)) this.holding = false;

    const k = 1 - Math.exp(-dt * 10);
    let yaw: number, scale: number;
    if (this.holding && palm && palm.valid) {
      this.tmp.set(palm.x + palm.nx * 0.035, palm.y + palm.ny * 0.035, palm.z + palm.nz * 0.035);
      this.anchor.position.lerp(this.tmp, k);
      yaw = Math.atan2(-palm.fx, -palm.fz);
      scale = 0.5 * this.table.s;
    } else {
      this.anchor.position.lerp(this.table.p, k);
      yaw = this.table.yaw;
      scale = this.table.s;
    }
    this.anchor.rotation.y += wrap(yaw - this.anchor.rotation.y) * k;
    this.anchor.scale.setScalar(this.scale + (scale - this.scale) * k);
  }

  private startTween(to: Pose, pivot: Vector3, dur: number, then: NavMode) {
    this.two = null; this.one = null;
    const from: Pose = { p: this.anchor.position.clone(), yaw: this.anchor.rotation.y, s: this.scale };
    this.tween = { from, to, pivot, t: 0, dur, then };
    if (then === 'immersive') this.setMode('immersive');
  }

  private stepTween(dt: number) {
    const tw = this.tween!;
    tw.t = Math.min(1, tw.t + dt / tw.dur);
    const e = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - (-2 * tw.t + 2) ** 3 / 2;
    const s = tw.from.s * Math.pow(tw.to.s / tw.from.s, e);
    const yaw = tw.from.yaw + wrap(tw.to.yaw - tw.from.yaw) * e;
    // The pivot glides from where it was to where it lands while the world scales.
    const a = this.fromLocal(tw.pivot, tw.from, new Vector3());
    const b = this.fromLocal(tw.pivot, tw.to, new Vector3());
    const w = a.lerp(b, e);
    this.anchor.scale.setScalar(s);
    this.anchor.rotation.y = yaw;
    this.poseFromPivot(tw.pivot, w, yaw, s, this.anchor.position);
    if (tw.t >= 1) {
      this.tween = null;
      this.setMode(tw.then);
      if (tw.then === 'table') this.applyPose(this.table);
    }
  }

  private setMode(m: NavMode) {
    if (this.mode === m) return;
    this.mode = m;
    this.onModeChange?.(m);
  }

  private applyPose(p: Pose) {
    this.anchor.position.copy(p.p);
    this.anchor.rotation.y = p.yaw;
    this.anchor.scale.setScalar(p.s);
  }

  /** World point -> anchor-local point. */
  private toLocal(w: Vector3, out: Vector3) {
    const p = this.anchor.position, yaw = this.anchor.rotation.y, s = this.scale || 1;
    const dx = w.x - p.x, dz = w.z - p.z, c = Math.cos(yaw), sn = Math.sin(yaw);
    return out.set((c * dx - sn * dz) / s, (w.y - p.y) / s, (sn * dx + c * dz) / s);
  }

  private fromLocal(l: Vector3, pose: Pose, out: Vector3) {
    const c = Math.cos(pose.yaw), sn = Math.sin(pose.yaw);
    return out.set(pose.p.x + pose.s * (c * l.x + sn * l.z), pose.p.y + pose.s * l.y, pose.p.z + pose.s * (-sn * l.x + c * l.z));
  }

  /** The anchor position that puts local point `l` at world point `w`. */
  private poseFromPivot(l: Vector3, w: Vector3, yaw: number, s: number, out: Vector3) {
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    return out.set(w.x - s * (c * l.x + sn * l.z), w.y - s * l.y, w.z - s * (-sn * l.x + c * l.z));
  }
}
