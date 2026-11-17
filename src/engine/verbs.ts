/**
 * Interaction verbs: turns hand tips + part zones into events.
 * Implemented today: strike (hit with speed) and press (push down, release).
 * Pure TypeScript and allocation-free per frame, so the server can run the
 * exact same logic with a virtual fingertip for the self-playtest.
 */
import { assetDims } from '../spec/schema.js';
import type { PartT, Verb } from '../spec/schema.js';
import type { Tip } from './tip.js';

/** Forgiving defaults: tuned blind (no headset), adjustable at runtime. */
export const TUNING = {
  /** Hit zones are this much larger than the visible shape (radially). */
  zoneScale: 1.3,
  /** Extra room above a surface where an approaching fingertip already counts (m). */
  approachMargin: 0.02,
  /** Below this approach speed a strike doesn't fire (m/s). */
  minStrikeSpeed: 0.25,
  /** Approach speed that gives full velocity (m/s). */
  maxStrikeSpeed: 2.2,
  /** Minimum share of the motion that must go into the surface (0-1). */
  minApproachRatio: 0.4,
  /** Minimum time between two hits on the same part (s). */
  cooldown: 0.06,
  /** Quietest audible hit, so every intentional touch is heard (0-1). */
  velocityFloor: 0.3,
};

export type VerbEventKind = 'hit' | 'down' | 'up';

export interface VerbEvent {
  kind: VerbEventKind;
  part: number;
  velocity: number;
  x: number; y: number; z: number;
}

export interface PartZone {
  index: number;
  verb: Verb;
  /** Omnidirectional zones (spheres, rings) accept hits from any side. */
  omni: boolean;
  kind: 'cyl' | 'box' | 'sphere' | 'capsule';
  radius: number; halfHeight: number;
  /** Local y offset of the zone centre from the part origin (tubes hang down from it). */
  oy: number;
  hx: number; hy: number; hz: number;
  /** World -> part-local matrix (column-major). */
  inv: Float64Array;
  /** Part's local +Y axis in world space (the playing surface normal). */
  nx: number; ny: number; nz: number;
  /** Part centre in world space. */
  cx: number; cy: number; cz: number;
  /** Uniform world scale of the part. */
  scale: number;
  cooldownUntil: number;
  enabled: boolean;
}

export function createZone(part: PartT, index: number): PartZone {
  const z: PartZone = {
    index, verb: part.verb, omni: false, kind: 'cyl',
    radius: 0, halfHeight: 0, oy: 0, hx: 0, hy: 0, hz: 0,
    inv: new Float64Array(16), nx: 0, ny: 1, nz: 0, cx: 0, cy: 0, cz: 0, scale: 1,
    cooldownUntil: 0, enabled: part.verb === 'strike' || part.verb === 'press',
  };
  const s = part.shape;
  switch (s.kind) {
    case 'cylinder':
    case 'cone':
      z.kind = 'cyl'; z.radius = s.radius; z.halfHeight = s.height / 2; break;
    case 'box':
      z.kind = 'box'; z.hx = s.size[0] / 2; z.hy = s.size[1] / 2; z.hz = s.size[2] / 2; break;
    case 'sphere':
      z.kind = 'sphere'; z.radius = s.radius; z.omni = true; break;
    case 'torus':
      z.kind = 'cyl'; z.radius = s.radius + s.tube; z.halfHeight = s.tube; z.omni = true; break;
    case 'capsule':
      z.kind = 'capsule'; z.radius = s.radius; z.halfHeight = s.length / 2; z.omni = true; break;
    case 'lathe': {
      const ys = s.profile.map((p) => p[1]);
      z.kind = 'cyl'; z.radius = Math.max(...s.profile.map((p) => p[0]));
      z.halfHeight = (Math.max(...ys) - Math.min(...ys)) / 2; z.omni = true; break;
    }
    case 'tube':
      // thin and hanging: generous capsule from the origin down
      z.kind = 'capsule'; z.radius = Math.max(0.015, s.radius * 1.8); z.halfHeight = s.length / 2; z.oy = -s.length / 2; z.omni = true; break;
    case 'blob':
      z.kind = 'sphere'; z.radius = s.radius * Math.max(1, s.squash ?? 1); z.omni = true; break;
    case 'frustum':
      z.kind = 'cyl'; z.radius = Math.max(s.top, s.bottom); z.halfHeight = s.height / 2; break;
    case 'asset': {
      // Base on the ground: a generous upright cylinder from the base to the top, hit from any side.
      const d = assetDims(s.type, s.size);
      z.kind = 'cyl'; z.radius = Math.max(0.012, d.radius * 0.8); z.halfHeight = d.height / 2; z.oy = d.height / 2; z.omni = true; break;
    }
  }
  return z;
}

/** Update a zone's pose from the part's world matrix and its inverse. */
export function setZonePose(z: PartZone, world: ArrayLike<number>, inverse: ArrayLike<number>) {
  for (let i = 0; i < 16; i++) z.inv[i] = inverse[i];
  const len = Math.hypot(world[4], world[5], world[6]);
  z.scale = len || 1;
  z.nx = world[4] / z.scale; z.ny = world[5] / z.scale; z.nz = world[6] / z.scale;
  // centre includes the local y offset (world col 1 already carries the scale)
  z.cx = world[12] + world[4] * z.oy; z.cy = world[13] + world[5] * z.oy; z.cz = world[14] + world[6] * z.oy;
}

export class VerbEngine {
  readonly events: VerbEvent[] = [];
  eventCount = 0;
  private inside = new Uint8Array(0);
  private tipCount = 0;
  private zoneCount = 0;
  private readonly local = new Float64Array(3);

  constructor(private readonly maxEvents = 32) {
    for (let i = 0; i < maxEvents; i++) this.events.push({ kind: 'hit', part: 0, velocity: 0, x: 0, y: 0, z: 0 });
  }

  /** Call when the set of parts changes. */
  resize(tipCount: number, zoneCount: number) {
    this.tipCount = tipCount;
    this.zoneCount = zoneCount;
    this.inside = new Uint8Array(tipCount * zoneCount);
  }

  /** Simulated hit for desktop clicks and the self-playtest. */
  trigger(zone: PartZone, velocity: number, time: number, x = 0, y = 0, z = 0) {
    this.eventCount = 0;
    if (!zone.enabled || time < zone.cooldownUntil) return;
    zone.cooldownUntil = time + TUNING.cooldown;
    this.emit(zone.verb === 'press' ? 'down' : 'hit', zone.index, velocity, x, y, z);
  }

  /** Run one frame. Results land in `events[0..eventCount)`. */
  update(tips: readonly Tip[], zones: readonly PartZone[], time: number) {
    this.eventCount = 0;
    if (tips.length !== this.tipCount || zones.length !== this.zoneCount) this.resize(tips.length, zones.length);

    for (let ti = 0; ti < tips.length; ti++) {
      const tip = tips[ti];
      for (let zi = 0; zi < zones.length; zi++) {
        const zone = zones[zi];
        if (!zone.enabled) continue;
        const slot = ti * zones.length + zi;
        const was = this.inside[slot] === 1;
        const now = tip.active && this.contains(zone, tip, was);
        this.inside[slot] = now ? 1 : 0;

        if (now && !was) this.onEnter(zone, tip, time);
        else if (!now && was && zone.verb === 'press') this.emit('up', zone.index, 0, tip.x, tip.y, tip.z);
      }
    }
  }

  private onEnter(zone: PartZone, tip: Tip, time: number) {
    if (time < zone.cooldownUntil) return;
    const speed = Math.hypot(tip.vx, tip.vy, tip.vz);
    let approach: number;
    if (zone.omni) {
      // Speed toward the part's centre.
      const dx = zone.cx - tip.x, dy = zone.cy - tip.y, dz = zone.cz - tip.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      approach = (tip.vx * dx + tip.vy * dy + tip.vz * dz) / d;
    } else {
      // Speed into the playing surface (against its normal).
      approach = -(tip.vx * zone.nx + tip.vy * zone.ny + tip.vz * zone.nz);
    }

    if (zone.verb === 'press') {
      zone.cooldownUntil = time + TUNING.cooldown;
      const v = Math.max(0.45, velocityCurve(approach));
      this.emit('down', zone.index, v, tip.x, tip.y, tip.z);
      return;
    }
    if (approach < TUNING.minStrikeSpeed) return;
    if (speed > 0 && approach / speed < TUNING.minApproachRatio) return;
    zone.cooldownUntil = time + TUNING.cooldown;
    this.emit('hit', zone.index, velocityCurve(approach), tip.x, tip.y, tip.z);
  }

  private contains(zone: PartZone, tip: Tip, wasInside: boolean): boolean {
    const m = zone.inv;
    const lx = m[0] * tip.x + m[4] * tip.y + m[8] * tip.z + m[12];
    const ly = m[1] * tip.x + m[5] * tip.y + m[9] * tip.z + m[13] - zone.oy;
    const lz = m[2] * tip.x + m[6] * tip.y + m[10] * tip.z + m[14];
    const r = tip.radius / zone.scale + (wasInside ? 0.01 : 0); // hysteresis
    const k = TUNING.zoneScale;
    const above = TUNING.approachMargin / zone.scale;
    switch (zone.kind) {
      case 'cyl': {
        if (Math.hypot(lx, lz) > zone.radius * k + r) return false;
        const top = zone.halfHeight + (zone.omni ? 0 : above) + r;
        return ly <= top && ly >= -zone.halfHeight - r;
      }
      case 'box': {
        if (Math.abs(lx) > zone.hx * k + r || Math.abs(lz) > zone.hz * k + r) return false;
        return ly <= zone.hy + above + r && ly >= -zone.hy - r;
      }
      case 'sphere':
        return Math.hypot(lx, ly, lz) <= zone.radius * k + r;
      case 'capsule': {
        const cy = Math.max(-zone.halfHeight, Math.min(zone.halfHeight, ly));
        return Math.hypot(lx, ly - cy, lz) <= zone.radius * k + r;
      }
    }
  }

  private emit(kind: VerbEventKind, part: number, velocity: number, x: number, y: number, z: number) {
    if (this.eventCount >= this.maxEvents) return;
    const e = this.events[this.eventCount++];
    e.kind = kind; e.part = part; e.velocity = velocity; e.x = x; e.y = y; e.z = z;
  }
}

/** Map approach speed to a 0-1 velocity with a soft curve and an audible floor. */
export function velocityCurve(approach: number): number {
  const t = (approach - TUNING.minStrikeSpeed) / (TUNING.maxStrikeSpeed - TUNING.minStrikeSpeed);
  const c = Math.min(1, Math.max(0, t));
  return TUNING.velocityFloor + (1 - TUNING.velocityFloor) * Math.sqrt(c);
}
