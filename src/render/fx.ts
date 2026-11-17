/**
 * Touch feedback and the assembly animation. With no controller haptics,
 * every hit must be seen as well as heard: squash, flash, overshoot.
 */
import type { CreationRuntime, PartRuntime } from './build.js';
import { groundY } from '../engine/terrain.js';

export function triggerReaction(p: PartRuntime, kind: 'jump' | 'grow' | 'spin') {
  p.asset?.trigger?.(kind);
  if (kind === 'jump') p.jumpT = 0.55;
  if (kind === 'grow') p.growT = 0.8;
  if (kind === 'spin') p.spinT = 0.9;
}

const SQUASH_STIFFNESS = 520;
const SQUASH_DAMPING = 22;
const FLASH_DECAY = 7;
const APPEAR_TIME = 0.35;

export function triggerHitFx(p: PartRuntime, velocity: number) {
  const fx = p.spec.fx ?? ['squash', 'flash'];
  if (fx.includes('flash')) p.flash = Math.max(p.flash, 0.4 + 0.6 * velocity);
  if (fx.includes('squash')) p.squashVel -= 3 + 6 * velocity;
}

/** Overshoot easing for parts growing in. */
function easeOutBack(t: number) {
  const c1 = 1.9, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * Advance effects. Returns the parts that just started appearing this frame
 * (so the caller can play a "place" sound) via the callback.
 */
export function updateFx(rt: CreationRuntime, dt: number, onAppear?: (p: PartRuntime) => void) {
  const step = Math.min(dt, 1 / 30);
  for (const p of rt.parts) {
    // Assembly
    if (p.appear < 1) {
      if (p.appearDelay > 0) {
        p.appearDelay -= step;
      } else {
        if (!p.placedSoundPlayed) { p.placedSoundPlayed = true; onAppear?.(p); }
        p.appear = Math.min(1, p.appear + step / APPEAR_TIME);
      }
    }
    const base = (p.pivot.userData.baseScale as number) ?? 1;
    const grow = p.appear >= 1 ? 1 : Math.max(0.0001, easeOutBack(p.appear));
    if (p.growT > 0) p.growT = Math.max(0, p.growT - step);
    const growBump = p.growT > 0 ? 1 + 0.45 * Math.sin((1 - p.growT / 0.8) * Math.PI) : 1;
    p.pivot.scale.setScalar(base * grow * growBump);

    // Position: rest pose, plus wander / orbit (worlds) and jump.
    const mo = p.spec.motion;
    let [px, py, pz] = p.base;
    const terrain = rt.spec.kind === 'world' ? rt.spec.terrain : undefined;
    if (mo && (mo.type === 'wander' || mo.type === 'orbit')) {
      const t = p.motionTime, w = (mo.freq ?? 0.3), ph = mo.phase ?? 0;
      if (mo.type === 'wander') {
        const r = mo.radius ?? 0.05;
        const nx = p.base[0] + r * Math.sin(t * w * 1.1 + ph) * Math.cos(t * w * 0.37 + ph * 2);
        const nz = p.base[2] + r * Math.sin(t * w * 0.73 + ph * 3);
        const lift = terrain ? groundY(terrain, nx, nz) - groundY(terrain, p.base[0], p.base[2]) : 0;
        p.pivot.rotation.y = Math.atan2(nx - p.pivot.position.x, nz - p.pivot.position.z) || p.pivot.rotation.y;
        px = nx; pz = nz; py = p.base[1] + lift + Math.abs(Math.sin(t * 6 * w + ph)) * 0.004;
      } else {
        const [ox, oz] = p.center;
        const r = mo.radius ?? Math.max(0.05, Math.hypot(p.base[0] - ox, p.base[2] - oz));
        const a = Math.atan2(p.base[0] - ox, p.base[2] - oz) + t * w * 0.6 + ph;
        px = ox + Math.sin(a) * r; pz = oz + Math.cos(a) * r;
        p.pivot.rotation.y = a + Math.PI / 2;
      }
    }
    if (p.jumpT > 0) {
      p.jumpT = Math.max(0, p.jumpT - step);
      py += 0.05 * Math.sin((1 - p.jumpT / 0.55) * Math.PI);
    }
    if (p.spinT > 0) {
      p.spinT = Math.max(0, p.spinT - step);
      p.mesh.rotation.y += step * Math.PI * 2 / 0.9;
    }
    p.pivot.position.set(px, py, pz);

    // Squash spring on the mesh (pivot stays fixed so hit zones don't move).
    const accel = -SQUASH_STIFFNESS * p.squash - SQUASH_DAMPING * p.squashVel;
    p.squashVel += accel * step;
    p.squash += p.squashVel * step;
    const sq = Math.max(-0.25, Math.min(0.25, p.squash * 0.05));
    p.motionTime += step;
    let pulse = 1;
    if (mo && mo.type !== 'wander' && mo.type !== 'orbit') {
      const amp = mo.amp ?? 0.5, w = Math.PI * 2 * (mo.freq ?? 0.6), ph = mo.phase ?? 0, t = p.motionTime;
      switch (mo.type) {
        case 'pulse': pulse = 1 + 0.1 * amp * Math.sin(w * t + ph); break;
        case 'sway':
          p.mesh.rotation.z = 0.35 * amp * Math.sin(w * t + ph);
          p.mesh.rotation.x = 0.22 * amp * Math.cos(w * 0.8 * t + ph);
          break;
        case 'bob': p.mesh.position.y = 0.02 * amp * Math.sin(w * t + ph); break;
        case 'spin': p.mesh.rotation.y += w * step * 0.25; break;
        case 'flutter':
          p.mesh.rotation.z = 0.15 * amp * Math.sin(w * 3 * t + ph);
          pulse = 1 + 0.03 * amp * Math.sin(w * 6 * t + ph);
          break;
      }
    }
    p.mesh.scale.set((1 - sq * 0.5) * pulse, (1 + sq) * (2 - pulse), (1 - sq * 0.5) * pulse);

    // Flash
    if (p.flash > 0) p.flash = Math.max(0, p.flash - FLASH_DECAY * step * p.flash - 0.01);
    if (p.asset) {
      p.asset.update?.(step, p.motionTime);
      if (p.flash > 0) for (const x of p.asset.mats) x.m.emissiveIntensity = x.base + p.flash * 0.9;
    } else p.material.emissiveIntensity = p.baseEmissive + p.flash * 1.6;
  }
}
