/**
 * World environment for kind:'world' creations: terrain mesh coloured by
 * height, water, a rocky underside for floating islands, ambient particles
 * (fireflies, snow, rain, bubbles, leaves, stars), day/dusk/night lighting,
 * and a pooled particle system for reactions (bursts, eruptions, blooms).
 */
import { BIOME_LOOK, biomeOf } from '../engine/biome.js';
import type { Biome } from '../spec/schema.js';
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute,
  Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, NormalBlending, Points, PointsMaterial,
} from '@iwsdk/core';
import { terrainHeight, waterLevel, WORLD_BASE_Y, type TerrainT } from '../engine/terrain.js';

type Particles = 'none' | 'fireflies' | 'snow' | 'rain' | 'bubbles' | 'leaves' | 'stars';
type Light = 'day' | 'dusk' | 'night';

const LIGHTS: Record<Light, { sky: number; intensity: number; tint: number }> = {
  day: { sky: 0xfff4e0, intensity: 1.0, tint: 0xffffff },
  dusk: { sky: 0xffb38a, intensity: 0.75, tint: 0xffd2b0 },
  night: { sky: 0x6f7dff, intensity: 0.45, tint: 0x9aa6ff },
};

/** Ground colour by height: sand, grass, rock, snow. Shared by the island and the endless chunks. */
export function terrainPalette(accent: number, biome: Biome = 'meadow') {
  const L = BIOME_LOOK[biome];
  return {
    sand: new Color(L.sand), grass: new Color(L.grass).lerp(new Color(accent), biome === 'city' || biome === 'desert' ? 0.04 : 0.12),
    rock: new Color(L.rock), snow: new Color(L.snow),
  };
}
/** By absolute height (world units), so a gentle hill stays green and only real peaks get rock and snow. */
export function terrainColour(pal: ReturnType<typeof terrainPalette>, terrain: TerrainT, h: number, out: Color) {
  const shore = terrain.water ? terrain.height * 0.12 + 0.006 : -1;
  if (h < shore) out.copy(pal.sand);
  else if (h < shore + 0.008) out.copy(pal.sand).lerp(pal.grass, (h - shore) / 0.008);
  else if (h < 0.07) out.copy(pal.grass);
  else if (h < 0.1) out.copy(pal.grass).lerp(pal.rock, (h - 0.07) / 0.03);
  else out.copy(pal.rock).lerp(pal.snow, Math.min(1, (h - 0.1) / 0.03));
  return out;
}

const AMBIENT_COUNT = 140;
const BURST_COUNT = 260;

export class WorldEnv {
  readonly root = new Group();
  private terrain: TerrainT;
  private terrainMat: MeshStandardMaterial;
  private water: Mesh | null = null;
  private ambient: Points;
  private ambientMat: PointsMaterial;
  private ambientPos: Float32Array;
  private ambientVel: Float32Array;
  private ambientKind: Particles;
  private rainUntil = 0;
  private burst: Points;
  private burstPos: Float32Array;
  private burstVel: Float32Array;
  private burstLife: Float32Array;
  private burstCol: Float32Array;
  private burstNext = 0;
  private time = 0;
  /** The miniature island's own meshes (hidden when the endless chunks take over). */
  private island: Mesh[] = [];
  /** Ambient particles live around this point (the user, when inside the world). */
  private focusX = 0;
  private focusZ = 0;
  private spread: number;
  private pointScale = 1;
  light: Light;
  private lightColor = new Color();
  private lightTarget = new Color();

  constructor(terrain: TerrainT, ambient: { particles?: Particles; light?: Light } | undefined, accent: number) {
    this.terrain = terrain;
    this.spread = terrain.radius;
    this.root.name = 'conjure-world';
    this.light = ambient?.light ?? 'day';
    this.ambientKind = ambient?.particles ?? 'none';

    // Terrain: a radial grid lifted by the shared height function, coloured by height.
    const rings = 28, segs = 72;
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const pal = terrainPalette(accent, biomeOf({ terrain, ambient }));
    const c = new Color();
    pos.push(0, WORLD_BASE_Y + terrainHeight(terrain, 0, 0), 0);
    pushColour(0);
    for (let i = 1; i <= rings; i++) {
      const r = (i / rings) * terrain.radius;
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const x = Math.sin(a) * r, z = Math.cos(a) * r;
        const h = i === rings ? 0 : terrainHeight(terrain, x, z);
        pos.push(x, WORLD_BASE_Y + h, z);
        pushColour(h);
      }
    }
    function pushColour(h: number) {
      terrainColour(pal, terrain, h, c);
      col.push(c.r, c.g, c.b);
    }
    for (let j = 0; j < segs; j++) idx.push(0, 1 + j, 1 + ((j + 1) % segs));
    for (let i = 1; i < rings; i++) {
      const a0 = 1 + (i - 1) * segs, a1 = 1 + i * segs;
      for (let j = 0; j < segs; j++) {
        const j1 = (j + 1) % segs;
        idx.push(a0 + j, a1 + j, a1 + j1, a0 + j, a1 + j1, a0 + j1);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.terrainMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: DoubleSide });
    const ground = new Mesh(geo, this.terrainMat);
    ground.receiveShadow = true;
    this.root.add(ground);
    this.island.push(ground);

    if (terrain.style === 'floating') {
      const under = new Mesh(
        new ConeGeometry(terrain.radius * 0.98, terrain.radius * 0.9, 9, 3),
        new MeshStandardMaterial({ color: 0x6d5a4c, roughness: 1, flatShading: true }),
      );
      under.rotation.x = Math.PI;
      under.position.y = WORLD_BASE_Y - terrain.radius * 0.45;
      this.root.add(under);
      this.island.push(under);
    } else {
      const base = new Mesh(
        new CylinderGeometry(terrain.radius * 1.06, terrain.radius * 1.1, 0.02, 64),
        new MeshStandardMaterial({ color: 0x2a2c3a, roughness: 0.8 }),
      );
      base.position.y = WORLD_BASE_Y - 0.011;
      this.root.add(base);
      this.island.push(base);
    }
    if (terrain.water) {
      this.water = new Mesh(
        new CylinderGeometry(terrain.radius * 1.04, terrain.radius * 1.04, 0.004, 64),
        new MeshStandardMaterial({ color: 0x3fa7d6, transparent: true, opacity: 0.6, roughness: 0.1, metalness: 0.1, emissive: new Color(0x0e4a6b), emissiveIntensity: 0.4 }),
      );
      this.water.position.y = WORLD_BASE_Y + waterLevel(terrain);
      this.root.add(this.water);
      this.island.push(this.water);
    }

    // Ambient particles
    this.ambientPos = new Float32Array(AMBIENT_COUNT * 3);
    this.ambientVel = new Float32Array(AMBIENT_COUNT * 3);
    const ag = new BufferGeometry();
    ag.setAttribute('position', new BufferAttribute(this.ambientPos, 3));
    this.ambientMat = new PointsMaterial({ size: 0.006, transparent: true, depthWrite: false, blending: AdditiveBlending, color: 0xffffff });
    this.ambient = new Points(ag, this.ambientMat);
    this.ambient.frustumCulled = false;
    this.root.add(this.ambient);
    this.setAmbient(this.ambientKind);

    // Burst pool (reactions)
    this.burstPos = new Float32Array(BURST_COUNT * 3);
    this.burstVel = new Float32Array(BURST_COUNT * 3);
    this.burstLife = new Float32Array(BURST_COUNT);
    this.burstCol = new Float32Array(BURST_COUNT * 3);
    const bg = new BufferGeometry();
    bg.setAttribute('position', new BufferAttribute(this.burstPos, 3));
    bg.setAttribute('color', new BufferAttribute(this.burstCol, 3));
    this.burst = new Points(bg, new PointsMaterial({ size: 0.007, vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending }));
    this.burst.frustumCulled = false;
    this.root.add(this.burst);
    for (let i = 0; i < BURST_COUNT; i++) this.burstPos[i * 3 + 1] = -10;

    this.lightTarget.set(LIGHTS[this.light].tint);
    this.lightColor.copy(this.lightTarget);
  }

  /**
   * Inside the world: hide the miniature island (the endless chunks draw the
   * ground instead) and keep the ambient particles around the user.
   */
  setImmersive(on: boolean) {
    for (const m of this.island) m.visible = !on;
    this.spread = on ? 0.55 : this.terrain.radius;
    if (!on) { this.focusX = 0; this.focusZ = 0; }
    for (let i = 0; i < AMBIENT_COUNT; i++) this.respawn(i, this.currentAmbient, true);
  }

  /** Where the user is, in world units, when inside the world. */
  setFocus(x: number, z: number) { this.focusX = x; this.focusZ = z; }

  /** Points are sized in metres, so they need scaling with the world. */
  setPointScale(scale: number) {
    if (Math.abs(scale - this.pointScale) < 0.01) return;
    this.pointScale = scale;
    this.applyAmbientSize();
    (this.burst.material as PointsMaterial).size = 0.007 * Math.sqrt(scale) * 1.5;
  }

  /** Light colour + intensity for the stage light, eased between modes. */
  get lightTint() { return this.lightColor; }
  get lightIntensity() { return LIGHTS[this.light].intensity; }

  toggleDayNight() {
    this.light = this.light === 'night' ? 'day' : 'night';
    this.lightTarget.set(LIGHTS[this.light].tint);
    if (this.light === 'night' && this.ambientKind === 'none') this.setAmbient('fireflies');
  }

  rain(seconds = 4) { this.rainUntil = this.time + seconds; }

  /** Particle burst at a point in world-root space. kind picks colours and motion. */
  emit(x: number, y: number, z: number, kind: 'burst' | 'erupt' | 'bloom', color = 0xffffff) {
    const n = kind === 'erupt' ? 90 : kind === 'bloom' ? 50 : 36;
    const c = new Color();
    for (let k = 0; k < n; k++) {
      const i = this.burstNext;
      this.burstNext = (this.burstNext + 1) % BURST_COUNT;
      const a = Math.random() * Math.PI * 2, up = kind === 'erupt' ? 0.5 + Math.random() * 0.6 : Math.random() * 0.5;
      const sp = kind === 'erupt' ? 0.12 + Math.random() * 0.2 : 0.06 + Math.random() * 0.1;
      this.burstPos.set([x, y, z], i * 3);
      this.burstVel.set([Math.cos(a) * sp * 0.6, up * sp * 3, Math.sin(a) * sp * 0.6], i * 3);
      this.burstLife[i] = kind === 'erupt' ? 1.6 : 1.0;
      if (kind === 'erupt') c.setHSL(0.02 + Math.random() * 0.08, 1, 0.5 + Math.random() * 0.2);
      else if (kind === 'bloom') c.setHSL(0.9 + Math.random() * 0.1, 0.8, 0.7);
      else c.set(color).offsetHSL(0, 0, Math.random() * 0.2);
      this.burstCol.set([c.r, c.g, c.b], i * 3);
    }
  }

  update(dt: number, time: number) {
    this.time = time;
    const step = Math.min(dt, 1 / 30);
    this.lightColor.lerp(this.lightTarget, 1 - Math.exp(-step * 2));
    if (this.water) this.water.position.y = WORLD_BASE_Y + waterLevel(this.terrain) + 0.0015 * Math.sin(time * 1.3);

    const raining = time < this.rainUntil;
    const kind: Particles = raining ? 'rain' : this.ambientKind;
    if (kind !== this.currentAmbient) this.setAmbient(kind, !raining);
    const R = this.spread;
    for (let i = 0; i < AMBIENT_COUNT; i++) {
      const o = i * 3;
      const p = this.ambientPos, v = this.ambientVel;
      p[o] += v[o] * step; p[o + 1] += v[o + 1] * step; p[o + 2] += v[o + 2] * step;
      if (kind === 'fireflies' || kind === 'leaves') { p[o] += Math.sin(time * 1.3 + i) * 0.004 * step * 10; }
      const out = Math.hypot(p[o] - this.focusX, p[o + 2] - this.focusZ) > R || p[o + 1] < WORLD_BASE_Y - 0.02 || p[o + 1] > WORLD_BASE_Y + 0.42;
      if (out) this.respawn(i, kind);
    }
    (this.ambient.geometry.attributes.position as BufferAttribute).needsUpdate = true;
    this.ambientMat.opacity = kind === 'none' ? 0 : kind === 'fireflies' || kind === 'stars' ? 0.55 + 0.45 * Math.sin(time * 4) : 0.85;

    for (let i = 0; i < BURST_COUNT; i++) {
      if (this.burstLife[i] <= 0) continue;
      const o = i * 3;
      this.burstLife[i] -= step;
      this.burstVel[o + 1] -= 0.25 * step;
      this.burstPos[o] += this.burstVel[o] * step;
      this.burstPos[o + 1] += this.burstVel[o + 1] * step;
      this.burstPos[o + 2] += this.burstVel[o + 2] * step;
      if (this.burstLife[i] <= 0) this.burstPos[o + 1] = -10;
    }
    (this.burst.geometry.attributes.position as BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose();
      const mat = m.material as { dispose?: () => void } | undefined;
      mat?.dispose?.();
    });
    this.root.removeFromParent();
  }

  private currentAmbient: Particles = 'none';

  private setAmbient(kind: Particles, persist = true) {
    if (persist) this.ambientKind = kind;
    this.currentAmbient = kind;
    const colours: Record<Particles, number> = {
      none: 0xffffff, fireflies: 0xfff07a, snow: 0xffffff, rain: 0x9fd4ff, bubbles: 0xbff3ff, leaves: 0xffa24a, stars: 0xe6ecff,
    };
    this.ambientMat.color.set(colours[kind]);
    this.ambientMat.blending = kind === 'leaves' ? NormalBlending : AdditiveBlending;
    this.applyAmbientSize();
    this.ambientMat.needsUpdate = true;
    for (let i = 0; i < AMBIENT_COUNT; i++) this.respawn(i, kind, true);
  }

  private applyAmbientSize() {
    const k = this.currentAmbient;
    // Grow points sub-linearly with the world so snow reads as snow, not boulders.
    const base = k === 'rain' ? 0.004 : k === 'leaves' ? 0.009 : 0.006;
    this.ambientMat.size = base * (this.pointScale > 1 ? Math.sqrt(this.pointScale) * 1.5 : 1);
  }

  private respawn(i: number, kind: Particles, anywhere = false) {
    const R = this.spread;
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R * 0.95;
    const o = i * 3;
    const top = WORLD_BASE_Y + 0.38, bottom = WORLD_BASE_Y + this.terrain.height * 0.5;
    let y = anywhere ? bottom + Math.random() * (top - bottom) : top;
    let vx = 0, vy = 0, vz = 0;
    switch (kind) {
      case 'none': y = -10; break;
      case 'fireflies': vx = (Math.random() - 0.5) * 0.02; vy = (Math.random() - 0.5) * 0.01; vz = (Math.random() - 0.5) * 0.02; if (!anywhere) y = bottom + Math.random() * 0.15; break;
      case 'snow': vy = -0.03 - Math.random() * 0.02; vx = (Math.random() - 0.5) * 0.01; break;
      case 'rain': vy = -0.6 - Math.random() * 0.3; break;
      case 'bubbles': vy = 0.04 + Math.random() * 0.03; if (!anywhere) y = bottom; break;
      case 'leaves': vy = -0.025; vx = (Math.random() - 0.5) * 0.02; break;
      case 'stars': y = top - Math.random() * 0.08; break;
    }
    this.ambientPos.set([this.focusX + Math.sin(a) * r, y, this.focusZ + Math.cos(a) * r], o);
    this.ambientVel.set([vx, vy, vz], o);
  }
}
