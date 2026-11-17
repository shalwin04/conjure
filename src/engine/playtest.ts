/**
 * Self-playtest: a virtual fingertip strikes or presses every interactive part
 * using the exact hit logic the headset runs (verbs.ts). Catches parts that
 * can't be triggered, make no sound, or are covered by / ambiguous with others.
 * Runs on the server after generation; failures go to the Repairer agent.
 */
import type { CreationT } from '../spec/schema.js';
import type { PlaytestResult } from '../spec/protocol.js';
import type { Tip } from './tip.js';
import { invertRigidScaled, partMatrix } from './transform.js';
import { createZone, setZonePose, VerbEngine, type PartZone } from './verbs.js';

const STEP = 1 / 72;
const SPEED = 1.2; // m/s, a confident tap
const START_ABOVE = 0.08; // m above the surface

export function playtest(creation: CreationT): PlaytestResult[] {
  const zones: PartZone[] = creation.parts.map((p, i) => {
    const z = createZone(p, i);
    const m = partMatrix(p, undefined, creation);
    setZonePose(z, m, invertRigidScaled(m));
    return z;
  });

  return creation.parts.map((part, i) => {
    const issues: string[] = [];
    const zone = zones[i];
    if (part.verb === 'none') return { partId: part.id, ok: true, issues };
    if (!zone.enabled) {
      return { partId: part.id, ok: false, issues: [`verb "${part.verb}" is not playable yet; use strike or press`] };
    }
    if (!part.sound && !(part.fx?.length)) issues.push('makes no sound or effect');

    // Directional parts (drum tops, keys) are played from above; omni parts
    // (bells, tentacles, spheres) count as reachable from any side a seated
    // user can get to.
    const dirs: [number, number, number][] = zone.omni
      ? [[zone.nx, zone.ny, zone.nz], [0, 0, 1], [1, 0, 0], [-1, 0, 0], [0, -1, 0], [0, 0, -1]]
      : [[zone.nx, zone.ny, zone.nz]];
    let first: ReturnType<typeof approach> | null = null;
    let success: ReturnType<typeof approach> | null = null;
    for (const d of dirs) {
      const r = approach(zones, i, d);
      first ??= r;
      if (r.hitSelf && r.firstOther === null) { success = r; break; }
    }
    const result = success ?? first!;
    if (!result.hitSelf) {
      issues.push(result.firstOther !== null
        ? `can't be reached: "${creation.parts[result.firstOther].id}" is in the way`
        : 'a tap does not trigger it (check its size and rotation)');
    } else if (result.firstOther !== null) {
      issues.push(`covered by "${creation.parts[result.firstOther].id}", which triggers first`);
    }
    if (success) {
      for (const other of success.hitBy) {
        if (other !== i) issues.push(`too close to "${creation.parts[other].id}": one tap triggers both`);
      }
    }
    return { partId: part.id, ok: issues.length === 0, issues };
  });
}

/** Move a virtual fingertip toward part i from direction d; report what it triggers. */
function approach(zones: PartZone[], i: number, d: [number, number, number]) {
  for (const z of zones) z.cooldownUntil = 0;
  const zone = zones[i];
  const engine = new VerbEngine();
  const start = extent(zone) + START_ABOVE;
  const tip: Tip = {
    hand: 'right', joint: 'index-finger-tip', active: true,
    x: zone.cx + d[0] * start, y: zone.cy + d[1] * start, z: zone.cz + d[2] * start,
    vx: -d[0] * SPEED, vy: -d[1] * SPEED, vz: -d[2] * SPEED,
    radius: 0.009,
  };
  const hitBy = new Set<number>();
  let firstOther: number | null = null;
  let hitSelf = false;
  for (let t = 0; t < 0.4 && !hitSelf; t += STEP) {
    engine.update([tip], zones, t);
    for (let k = 0; k < engine.eventCount; k++) {
      const e = engine.events[k];
      if (e.kind === 'up') continue;
      hitBy.add(e.part);
      if (e.part === i) hitSelf = true;
      else if (!hitSelf && firstOther === null) firstOther = e.part;
    }
    tip.x += tip.vx * STEP; tip.y += tip.vy * STEP; tip.z += tip.vz * STEP;
  }
  return { hitSelf, firstOther, hitBy };
}

/** Rough distance from the zone centre to its outside, in world units. */
function extent(zone: PartZone): number {
  const local = zone.kind === 'box' ? Math.max(zone.hx, zone.hy, zone.hz)
    : zone.kind === 'sphere' ? zone.radius
    : Math.max(zone.radius, zone.halfHeight + (zone.kind === 'capsule' ? zone.radius : 0));
  return local * zone.scale * 1.3;
}

export function playtestPassed(results: readonly PlaytestResult[]) {
  return results.every((r) => r.ok);
}
