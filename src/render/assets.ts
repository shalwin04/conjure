/**
 * Realistic assets, built procedurally on the headset (no downloads, no 3D
 * model API). The AI only says WHAT and HOW BIG ({kind:'asset', type, size});
 * this file owns how a pine tree, a volcano or a lighthouse actually looks.
 * Trees come from ez-tree (MIT, procedural, by Dan Greenheck); the rest is
 * built from three.js primitives with noise, vertex colours and particles.
 *
 * Every builder makes the asset at unit height (base at y = 0) and the root is
 * scaled to `size`. Assets may animate (smoke, fire, beams) and react
 * (a volcano erupts, a campfire flares).
 */
import {
  AdditiveBlending, Box3, BoxGeometry, BufferGeometry, CanvasTexture, Color, ConeGeometry, CylinderGeometry, DoubleSide,
  ExtrudeGeometry, Float32BufferAttribute, Group, IcosahedronGeometry, LatheGeometry, Material, Mesh, MeshStandardMaterial,
  OctahedronGeometry, Shape, ShapeGeometry, SphereGeometry, Sprite, SpriteMaterial, SRGBColorSpace, TorusGeometry, Vector2, Vector3,
} from '@iwsdk/core';
import { Tree } from '@dgreenheck/ez-tree';
import { valueNoise } from '../engine/terrain.js';
import type { AssetType } from '../spec/schema.js';

export interface PaletteColors { base: number; accent: number; glow: number; accentRed: number; accentBlue: number }

export interface AssetInstance {
  root: Group;
  /** Per-instance materials that flash on hits. */
  mats: { m: MeshStandardMaterial; base: number }[];
  update?(dt: number, t: number): void;
  trigger?(kind: string): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Shared resources

let softTex: CanvasTexture | null = null;
function soft() {
  if (softTex) return softTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  softTex = new CanvasTexture(c);
  return softTex;
}

let swirlTex: CanvasTexture | null = null;
function swirl() {
  if (swirlTex) return swirlTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.translate(64, 64);
  for (let i = 0; i < 220; i++) {
    const a = i * 0.21, r = i * 0.27;
    g.fillStyle = `rgba(255,255,255,${0.9 - i / 260})`;
    g.beginPath();
    g.arc(Math.cos(a) * r, Math.sin(a) * r, 3 + i * 0.02, 0, Math.PI * 2);
    g.fill();
  }
  swirlTex = new CanvasTexture(c);
  return swirlTex;
}

/** ez-tree templates: generating a tree is costly, so each preset+seed is built once and shared. */
const TREE_PRESETS: Record<string, string[]> = {
  oak: ['Oak Small', 'Oak Medium'],
  pine: ['Pine Small', 'Pine Medium'],
  aspen: ['Aspen Small', 'Aspen Medium'],
  ash: ['Ash Small', 'Ash Medium'],
  bush: ['Bush 1', 'Bush 2', 'Bush 3'],
  maple: ['Oak Small', 'Oak Medium', 'Ash Small'],
  snowpine: ['Pine Small', 'Pine Medium'],
};
/** Leaf tints for the seasonal variants (autumn maples, frosted pines). */
const TREE_TINT: Record<string, number[]> = {
  maple: [0xff8a3a, 0xf2b53a, 0xe0553a],
};
const treeCache = new Map<string, { tree: Tree; height: number }>();
let treeTime = 0;

function treeTemplate(type: string, variant: number) {
  const names = TREE_PRESETS[type];
  const v = Math.abs(Math.round(variant));
  const name = names[v % names.length];
  const seed = 1000 + (v % 2) * 777;
  const tints = TREE_TINT[type];
  const tint = tints ? tints[v % tints.length] : type === 'snowpine' ? 0xdfe9ee : 0;
  const key = `${name}:${seed}:${tint}`;
  let t = treeCache.get(key);
  if (!t) {
    const tree = new Tree();
    tree.loadPreset(name);
    tree.options.seed = seed;
    if (tint) tree.options.leaves.tint = tint;
    tree.generate();
    const box = new Box3().setFromObject(tree);
    t = { tree, height: Math.max(0.01, box.max.y - box.min.y) };
    treeCache.set(key, t);
  }
  return t;
}

/** Wind on every tree (shared materials): call once per frame. */
export function updateSharedAssets(time: number) {
  treeTime = time;
  for (const { tree } of treeCache.values()) tree.update(time);
}

// ---------------------------------------------------------------------------

class Builder {
  readonly root = new Group();
  readonly mats: { m: MeshStandardMaterial; base: number }[] = [];
  private owned: (BufferGeometry | Material)[] = [];
  updaters: ((dt: number, t: number) => void)[] = [];
  triggers: ((kind: string) => void)[] = [];
  constructor(readonly pal: PaletteColors, readonly seed: number) {}

  mat(color: number | Color, o: Partial<{ rough: number; metal: number; flat: boolean; emissive: number; glow: number; vc: boolean; opacity: number; side: boolean }> = {}) {
    const m = new MeshStandardMaterial({
      color: o.vc ? 0xffffff : color, roughness: o.rough ?? 0.85, metalness: o.metal ?? 0, flatShading: o.flat ?? false,
      vertexColors: o.vc ?? false,
    });
    if (o.emissive != null) { m.emissive = new Color(o.emissive); m.emissiveIntensity = o.glow ?? 1; }
    if (o.opacity != null && o.opacity < 1) { m.transparent = true; m.opacity = o.opacity; }
    if (o.side) m.side = DoubleSide;
    this.owned.push(m);
    this.mats.push({ m, base: m.emissiveIntensity });
    return m;
  }

  mesh(geo: BufferGeometry, m: Material, x = 0, y = 0, z = 0, parent: Group = this.root) {
    this.owned.push(geo);
    const mesh = new Mesh(geo, m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  /** Puffs of smoke (or fire) rising from a point. */
  plume(origin: Vector3, o: { count: number; color: number; rise: number; spread: number; size: number; life: number; additive?: boolean; opacity?: number }) {
    const m = new SpriteMaterial({ map: soft(), color: o.color, transparent: true, depthWrite: false, opacity: o.opacity ?? 0.5, blending: o.additive ? AdditiveBlending : undefined });
    this.owned.push(m);
    const puffs: { s: Sprite; age: number; vx: number; vz: number }[] = [];
    for (let i = 0; i < o.count; i++) {
      const s = new Sprite(m.clone());
      this.owned.push(s.material);
      this.root.add(s);
      puffs.push({ s, age: (i / o.count) * o.life, vx: 0, vz: 0 });
    }
    let boost = 0;
    this.updaters.push((dt) => {
      boost = Math.max(0, boost - dt * 0.6);
      for (const p of puffs) {
        p.age += dt * (1 + boost * 1.5);
        if (p.age > o.life) { p.age -= o.life; p.vx = (Math.random() - 0.5) * o.spread; p.vz = (Math.random() - 0.5) * o.spread; }
        const k = p.age / o.life;
        p.s.position.set(origin.x + p.vx * k, origin.y + o.rise * k * (1 + boost), origin.z + p.vz * k);
        const sz = o.size * (0.4 + k * 1.6) * (1 + boost * 0.8);
        p.s.scale.set(sz, sz, sz);
        (p.s.material as SpriteMaterial).opacity = (o.opacity ?? 0.5) * Math.sin(Math.PI * k) * (1 + boost * 0.5);
      }
    });
    return { surge: (v = 1) => { boost = Math.min(2.5, boost + v); } };
  }

  finish(size: number): AssetInstance {
    this.root.scale.setScalar(size);
    this.root.traverse((o) => { o.castShadow = false; o.receiveShadow = true; });
    const ups = this.updaters, trig = this.triggers, owned = this.owned;
    return {
      root: this.root,
      mats: this.mats,
      update: ups.length ? (dt, t) => { for (const u of ups) u(dt, t); } : undefined,
      trigger: trig.length ? (k) => { for (const f of trig) f(k); } : undefined,
      dispose: () => { for (const r of owned) r.dispose(); this.root.removeFromParent(); },
    };
  }

  rand(i: number) { return (valueNoise(this.seed * 0.37 + i * 1.7, i * 0.91, 3) + 1) / 2; }
}

/** Displace a geometry's vertices outward with noise, and colour it. */
function roughen(geo: BufferGeometry, amount: number, seed: number, colour: (x: number, y: number, z: number, n: number) => Color) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = valueNoise(v.x * 3.1 + seed, v.z * 3.1 + v.y * 2.3, seed) * 0.6 + valueNoise(v.x * 9 + seed, v.y * 9 + v.z * 7, seed + 3) * 0.4;
    const r = Math.hypot(v.x, v.z);
    if (r > 1e-4) { v.x += (v.x / r) * n * amount; v.z += (v.z / r) * n * amount; }
    v.y += n * amount * 0.3;
    pos.setXYZ(i, v.x, v.y, v.z);
    const c = colour(v.x, v.y, v.z, n);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// Builders (unit height, base at y = 0)

function tree(b: Builder, type: string, variant: number) {
  const t = treeTemplate(type, variant);
  const g = new Group();
  const k = 1 / t.height;
  g.scale.setScalar(k);
  g.rotation.y = b.rand(1) * Math.PI * 2;
  g.add(new Mesh(t.tree.branchesMesh.geometry, t.tree.branchesMesh.material));
  g.add(new Mesh(t.tree.leavesMesh.geometry, t.tree.leavesMesh.material));
  b.root.add(g);
  // Shared geometry: not owned, not disposed per instance.
}

function palm(b: Builder) {
  const bark = b.mat(0xffffff, { rough: 0.95, vc: true });
  const barkCol = new Color(0x8a6a48);
  const pts: Vector3[] = [];
  const lean = 0.15 + b.rand(2) * 0.2;
  for (let i = 0; i <= 10; i++) { const k = i / 10; pts.push(new Vector3(lean * k * k, k * 0.92, 0)); }
  const segs = 10, radial = 8;
  const pos: number[] = [], idx: number[] = [], col: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const p = pts[i], r = 0.045 * (1 - i / segs * 0.45) * (1 + 0.15 * Math.abs(Math.sin(i * 2.2)));
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      pos.push(p.x + Math.cos(a) * r, p.y, Math.sin(a) * r);
      const shade = i % 2 ? 0.8 : 1;
      col.push(barkCol.r * shade, barkCol.g * shade, barkCol.b * shade);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, c = a + radial + 1;
    idx.push(a, c, a + 1, a + 1, c, c + 1);
  }
  const trunk = new BufferGeometry();
  trunk.setAttribute('position', new Float32BufferAttribute(pos, 3));
  trunk.setAttribute('color', new Float32BufferAttribute(col, 3));
  trunk.setIndex(idx);
  trunk.computeVertexNormals();
  b.mesh(trunk, bark);
  const top = pts[pts.length - 1];
  const leaf = b.mat(0x3f8a3a, { rough: 0.7, side: true });
  const crown = new Group();
  crown.position.copy(top);
  b.root.add(crown);
  const fronds = 8;
  for (let f = 0; f < fronds; f++) {
    // A frond: a long narrow leaf that arches out and down.
    const shape = new Shape();
    shape.moveTo(0, 0);
    for (let i = 0; i <= 8; i++) shape.lineTo(i * 0.06, 0.035 * Math.sin((i / 8) * Math.PI) + 0.004);
    for (let i = 8; i >= 0; i--) shape.lineTo(i * 0.06, -0.035 * Math.sin((i / 8) * Math.PI) - 0.004);
    const geo = new ShapeGeometry(shape, 1);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      p.setXYZ(i, x, p.getY(i), -0.9 * x * x);
    }
    geo.rotateX(-Math.PI / 2);
    geo.computeVertexNormals();
    const m = b.mesh(geo, leaf, 0, 0, 0, crown);
    m.rotation.y = (f / fronds) * Math.PI * 2 + b.rand(f) * 0.3;
    m.rotation.z = 0.25 + b.rand(f + 9) * 0.25;
  }
  const nut = b.mat(0x5a3d22, { rough: 0.6 });
  for (let i = 0; i < 3; i++) b.mesh(new SphereGeometry(0.025, 10, 8), nut, top.x + Math.cos(i * 2.1) * 0.03, top.y - 0.03, Math.sin(i * 2.1) * 0.03);
  b.updaters.push((_dt, t) => { crown.rotation.z = 0.05 * Math.sin(t * 0.9 + b.seed); crown.rotation.x = 0.04 * Math.cos(t * 0.7 + b.seed); });
}

function rock(b: Builder, mossy = true) {
  const grey = new Color(0x7d7a74), dark = new Color(0x55524d), moss = new Color(0x5f7d3e), c = new Color();
  const geo = roughen(new IcosahedronGeometry(0.5, 3), 0.18, b.seed % 97, (_x, y, _z, n) => {
    c.copy(grey).lerp(dark, 0.5 + n * 0.5);
    if (mossy && y > 0.15) c.lerp(moss, Math.min(0.6, (y - 0.15) * 2 + n * 0.3));
    return c;
  });
  geo.scale(1.5, 1, 1.25 + b.rand(4) * 0.3);
  geo.translate(0, 0.42, 0);
  b.mesh(geo, b.mat(0xffffff, { vc: true, rough: 0.95, flat: true }));
}

function peak(b: Builder, volcano: boolean) {
  // Lathe profile: wide base rising to a peak (or a crater rim).
  const prof: Vector2[] = [];
  const steps = 18;
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const r = volcano ? 1.05 * (1 - k) ** 1.35 + 0.22 : 0.95 * (1 - k) ** 1.6 + 0.01;
    prof.push(new Vector2(r, k * (volcano ? 0.92 : 1)));
  }
  if (volcano) { prof.push(new Vector2(0.16, 0.85)); prof.push(new Vector2(0.001, 0.8)); }
  const geo = new LatheGeometry(prof, 48);
  const c = new Color();
  const base = new Color(volcano ? 0x6a5546 : 0x6b6a5d), mid = new Color(volcano ? 0x4a3f38 : 0x7c7b77);
  const top = new Color(volcano ? 0x8a3a22 : 0xf4f7ff), green = new Color(0x4f6b35);
  roughen(geo, 0.12, b.seed % 53, (_x, y, _z, n) => {
    if (volcano) {
      c.copy(base).lerp(mid, Math.min(1, y * 1.6));
      if (y > 0.7) c.lerp(top, (y - 0.7) * 3 * (0.6 + n));
      if (y < 0.15) c.lerp(green, (0.15 - y) * 5 * (0.5 + n * 0.5));
    } else {
      c.copy(green).lerp(base, Math.min(1, y * 3));
      c.lerp(mid, Math.min(1, Math.max(0, y - 0.3) * 2));
      if (y > 0.62 + n * 0.08) c.copy(top);
    }
    return c;
  });
  b.mesh(geo, b.mat(0xffffff, { vc: true, rough: 0.97 }));
  if (!volcano) return;
  const lava = b.mat(0xff5a1f, { emissive: 0xff4a10, glow: 1.6, rough: 0.4 });
  const pool = b.mesh(new CylinderGeometry(0.15, 0.15, 0.01, 24), lava, 0, 0.84, 0);
  const smoke = b.plume(new Vector3(0, 0.95, 0), { count: 14, color: 0x6e6a66, rise: 0.9, spread: 0.5, size: 0.35, life: 5, opacity: 0.45 });
  const sparks = b.plume(new Vector3(0, 0.9, 0), { count: 10, color: 0xff7a2a, rise: 0.35, spread: 0.3, size: 0.06, life: 1.2, additive: true, opacity: 0.9 });
  let flare = 0;
  b.updaters.push((dt, t) => {
    flare = Math.max(0, flare - dt * 0.5);
    lava.emissiveIntensity = 1.3 + 0.4 * Math.sin(t * 3.1) + flare * 3;
    pool.position.y = 0.84 + flare * 0.03;
  });
  b.triggers.push((k) => { if (k === 'erupt') { flare = 1.5; smoke.surge(2.5); sparks.surge(2.5); } });
}

function cottage(b: Builder) {
  const wall = b.mat(0xe8dcc6, { rough: 0.95 });
  const wood = b.mat(0x6b4a2f, { rough: 0.8 });
  const roof = b.mat(b.pal.accentRed, { rough: 0.8, flat: true });
  b.mesh(new BoxGeometry(1, 0.52, 0.78), wall, 0, 0.26, 0);
  const tri = new Shape();
  tri.moveTo(-0.58, 0); tri.lineTo(0, 0.44); tri.lineTo(0.58, 0); tri.lineTo(-0.58, 0);
  const rg = new ExtrudeGeometry(tri, { depth: 0.9, bevelEnabled: false });
  rg.translate(0, 0, -0.45);
  b.mesh(rg, roof, 0, 0.52, 0);
  b.mesh(new BoxGeometry(0.18, 0.3, 0.02), wood, 0.12, 0.15, 0.4);
  const win = b.mat(0xffd27a, { emissive: 0xffb84a, glow: 0.9 });
  b.mesh(new BoxGeometry(0.16, 0.13, 0.02), win, -0.25, 0.3, 0.4);
  b.mesh(new BoxGeometry(0.02, 0.13, 0.16), win, 0.51, 0.3, 0);
  b.mesh(new BoxGeometry(0.12, 0.3, 0.12), b.mat(0x8c8580, { rough: 1 }), 0.28, 0.82, -0.15);
  b.plume(new Vector3(0.28, 1.0, -0.15), { count: 8, color: 0xd8d8d8, rise: 0.6, spread: 0.25, size: 0.16, life: 4, opacity: 0.35 });
}

function tower(b: Builder, lighthouse: boolean) {
  if (lighthouse) {
    const geo = new CylinderGeometry(0.15, 0.22, 0.72, 24, 8);
    const pos = geo.attributes.position, col: number[] = [];
    const red = new Color(b.pal.accentRed), white = new Color(0xf4f1ea);
    for (let i = 0; i < pos.count; i++) { const band = Math.floor((pos.getY(i) + 0.36) / 0.18); const c = band % 2 ? red : white; col.push(c.r, c.g, c.b); }
    geo.setAttribute('color', new Float32BufferAttribute(col, 3));
    b.mesh(geo, b.mat(0xffffff, { vc: true, rough: 0.6 }), 0, 0.36, 0);
    b.mesh(new CylinderGeometry(0.2, 0.2, 0.03, 24), b.mat(0x2b2b30, { metal: 0.6, rough: 0.4 }), 0, 0.735, 0);
    const lamp = b.mat(0xfff1b0, { emissive: 0xffe08a, glow: 2, opacity: 0.85 });
    b.mesh(new CylinderGeometry(0.11, 0.11, 0.13, 16), lamp, 0, 0.815, 0);
    b.mesh(new ConeGeometry(0.15, 0.12, 16), b.mat(b.pal.accentRed, { rough: 0.5 }), 0, 0.94, 0);
    const beamMat = new MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xfff0b0, emissiveIntensity: 1.5, transparent: true, opacity: 0.18, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
    const beamGeo = new ConeGeometry(0.25, 1.6, 16, 1, true);
    beamGeo.rotateZ(Math.PI / 2);
    beamGeo.translate(0.8, 0, 0);
    const beam = b.mesh(beamGeo, beamMat, 0, 0.815, 0);
    b.updaters.push((_dt, t) => { beam.rotation.y = t * 0.8; });
    return;
  }
  const stone = new Color(0x9c958a), c = new Color();
  const geo = roughen(new CylinderGeometry(0.28, 0.32, 0.78, 16, 6), 0.02, b.seed % 31, (_x, _y, _z, n) => c.copy(stone).multiplyScalar(0.85 + n * 0.3));
  b.mesh(geo, b.mat(0xffffff, { vc: true, rough: 0.95, flat: true }), 0, 0.39, 0);
  b.mesh(new ConeGeometry(0.36, 0.28, 16), b.mat(b.pal.base, { rough: 0.7, flat: true }), 0, 0.92, 0);
  const win = b.mat(0xffd27a, { emissive: 0xffb84a, glow: 1 });
  for (let i = 0; i < 3; i++) b.mesh(new BoxGeometry(0.05, 0.1, 0.02), win, Math.sin(i * 2.1) * 0.3, 0.3 + i * 0.18, Math.cos(i * 2.1) * 0.3).rotation.y = i * 2.1;
}

function castle(b: Builder) {
  const stone = b.mat(0xa39c90, { rough: 0.95, flat: true });
  const roof = b.mat(b.pal.base, { rough: 0.7, flat: true });
  for (const [x, z] of [[-0.55, -0.45], [0.55, -0.45], [-0.55, 0.45], [0.55, 0.45]]) {
    b.mesh(new CylinderGeometry(0.13, 0.15, 0.62, 12), stone, x, 0.31, z);
    b.mesh(new ConeGeometry(0.17, 0.25, 12), roof, x, 0.745, z);
  }
  b.mesh(new BoxGeometry(1.1, 0.4, 0.06), stone, 0, 0.2, -0.45);
  b.mesh(new BoxGeometry(1.1, 0.4, 0.06), stone, 0, 0.2, 0.45);
  b.mesh(new BoxGeometry(0.06, 0.4, 0.9), stone, -0.55, 0.2, 0);
  b.mesh(new BoxGeometry(0.06, 0.4, 0.9), stone, 0.55, 0.2, 0);
  b.mesh(new BoxGeometry(0.42, 0.75, 0.42), stone, 0, 0.375, 0);
  b.mesh(new ConeGeometry(0.34, 0.25, 4), roof, 0, 0.875, 0).rotation.y = Math.PI / 4;
  b.mesh(new BoxGeometry(0.16, 0.22, 0.02), b.mat(0x4a3424), 0, 0.11, 0.47);
}

function campfire(b: Builder) {
  const stone = b.mat(0x77736c, { rough: 1, flat: true });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    b.mesh(new IcosahedronGeometry(0.07, 0), stone, Math.cos(a) * 0.36, 0.04, Math.sin(a) * 0.36);
  }
  const log = b.mat(0x5a3b22, { rough: 0.9 });
  for (let i = 0; i < 3; i++) {
    const m = b.mesh(new CylinderGeometry(0.035, 0.04, 0.5, 8), log, 0, 0.06, 0);
    m.rotation.z = Math.PI / 2;
    m.rotation.y = (i / 3) * Math.PI;
  }
  const fire = b.plume(new Vector3(0, 0.1, 0), { count: 12, color: 0xff8a2a, rise: 0.55, spread: 0.12, size: 0.22, life: 0.9, additive: true, opacity: 0.85 });
  b.plume(new Vector3(0, 0.15, 0), { count: 6, color: 0xffd45a, rise: 0.3, spread: 0.06, size: 0.14, life: 0.6, additive: true, opacity: 0.9 });
  b.plume(new Vector3(0, 0.55, 0), { count: 6, color: 0x5d5a57, rise: 0.8, spread: 0.3, size: 0.2, life: 3.5, opacity: 0.25 });
  b.triggers.push(() => fire.surge(2));
}

function lantern(b: Builder) {
  const iron = b.mat(0x2d2b2a, { metal: 0.7, rough: 0.4 });
  b.mesh(new CylinderGeometry(0.02, 0.03, 0.8, 8), iron, 0, 0.4, 0);
  const glass = b.mat(0xffe6a0, { emissive: 0xffc860, glow: 1.8 });
  b.mesh(new BoxGeometry(0.11, 0.14, 0.11), glass, 0, 0.87, 0);
  b.mesh(new ConeGeometry(0.1, 0.07, 4), iron, 0, 0.975, 0).rotation.y = Math.PI / 4;
  b.plume(new Vector3(0, 0.87, 0), { count: 3, color: 0xffc860, rise: 0.02, spread: 0.01, size: 0.35, life: 2, additive: true, opacity: 0.35 });
}

function mushroom(b: Builder) {
  const stem = new LatheGeometry([new Vector2(0.14, 0), new Vector2(0.12, 0.25), new Vector2(0.1, 0.5), new Vector2(0.12, 0.58)], 20);
  b.mesh(stem, b.mat(0xf1eadb, { rough: 0.8 }));
  const capProf: Vector2[] = [];
  for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI / 2; capProf.push(new Vector2(Math.cos(a) * 0.5 + 0.001, Math.sin(a) * 0.42)); }
  capProf.unshift(new Vector2(0.12, 0.02));
  const cap = b.mesh(new LatheGeometry(capProf, 32), b.mat(b.pal.accentRed, { rough: 0.5 }), 0, 0.55, 0);
  const dot = b.mat(0xffffff, { rough: 0.6 });
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4, el = 0.35 + (i % 3) * 0.35;
    b.mesh(new SphereGeometry(0.045, 8, 6), dot, Math.cos(a) * Math.cos(el) * 0.48, Math.sin(el) * 0.42, Math.sin(a) * Math.cos(el) * 0.48, cap as unknown as Group);
  }
}

function crystal(b: Builder) {
  const m = b.mat(b.pal.glow, { emissive: b.pal.glow, glow: 0.8, rough: 0.05, metal: 0.2, opacity: 0.82, flat: true });
  for (let i = 0; i < 6; i++) {
    const h = i === 0 ? 1 : 0.4 + b.rand(i) * 0.4;
    const geo = new OctahedronGeometry(0.5, 0);
    geo.scale(0.22, h, 0.22);
    const c = b.mesh(geo, m, i === 0 ? 0 : Math.cos(i * 1.3) * 0.18, h * 0.5, i === 0 ? 0 : Math.sin(i * 1.3) * 0.18);
    if (i) { c.rotation.z = Math.cos(i * 1.3) * 0.5; c.rotation.x = -Math.sin(i * 1.3) * 0.5; }
  }
}

function flower(b: Builder) {
  b.mesh(new CylinderGeometry(0.02, 0.025, 0.7, 6), b.mat(0x4c8a3a), 0, 0.35, 0);
  const head = new Group();
  head.position.y = 0.72;
  b.root.add(head);
  const petal = b.mat(b.pal.accent, { rough: 0.6 });
  for (let i = 0; i < 7; i++) {
    const p = b.mesh(new SphereGeometry(0.12, 10, 6), petal, Math.cos((i / 7) * Math.PI * 2) * 0.13, 0, Math.sin((i / 7) * Math.PI * 2) * 0.13, head);
    p.scale.set(1, 0.3, 0.6);
    p.rotation.y = -(i / 7) * Math.PI * 2;
  }
  b.mesh(new SphereGeometry(0.08, 10, 8), b.mat(b.pal.glow, { emissive: b.pal.glow, glow: 0.4 }), 0, 0.02, 0, head);
  b.updaters.push((_dt, t) => { head.rotation.z = 0.12 * Math.sin(t * 1.3 + b.seed); });
}

function character(b: Builder, stone = false) {
  const v = Math.abs(b.seed) % 3;
  const cloak = b.mat(stone ? 0xa8a39a : [b.pal.base, b.pal.accentBlue, b.pal.accentRed][v], { rough: stone ? 1 : 0.85, flat: stone });
  const skin = b.mat(stone ? 0xa8a39a : [0xf1c7a0, 0xc68b5e, 0x8d5a3b][(b.seed >> 2) % 3], { rough: stone ? 1 : 0.6 });
  const body = new Group();
  b.root.add(body);
  const robe = new LatheGeometry([new Vector2(0.24, 0), new Vector2(0.22, 0.2), new Vector2(0.15, 0.45), new Vector2(0.12, 0.6), new Vector2(0.001, 0.64)], 20);
  b.mesh(robe, cloak, 0, 0, 0, body);
  b.mesh(new SphereGeometry(0.12, 16, 12), skin, 0, 0.72, 0, body);
  if (!stone) {
    const eye = b.mat(0x1d1d22, { rough: 0.3 });
    b.mesh(new SphereGeometry(0.018, 6, 4), eye, -0.045, 0.74, 0.105, body);
    b.mesh(new SphereGeometry(0.018, 6, 4), eye, 0.045, 0.74, 0.105, body);
  }
  for (const s of [-1, 1]) {
    const arm = b.mesh(new CylinderGeometry(0.035, 0.045, 0.32, 8), cloak, s * 0.17, 0.45, 0.02, body);
    arm.rotation.z = s * 0.35;
  }
  if (v === 1) b.mesh(new ConeGeometry(0.15, 0.32, 16), b.mat(stone ? 0xa8a39a : b.pal.accent), 0, 0.92, 0, body);
  else if (v === 2) b.mesh(new SphereGeometry(0.135, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), cloak, 0, 0.74, -0.01, body);
  if (stone) return;
  let hop = 0;
  b.updaters.push((dt, t) => {
    hop = Math.max(0, hop - dt * 2);
    body.position.y = 0.01 * Math.sin(t * 2 + b.seed) + Math.sin(hop * Math.PI) * 0.15;
    body.rotation.y = 0.25 * Math.sin(t * 0.4 + b.seed);
  });
  b.triggers.push((k) => { if (k === 'jump' || k === 'speak') hop = 1; });
}

function portal(b: Builder) {
  const stone = new Color(0x8f8a82), c = new Color();
  const ring = roughen(new TorusGeometry(0.4, 0.08, 10, 32), 0.015, b.seed % 17, (_x, _y, _z, n) => c.copy(stone).multiplyScalar(0.8 + n * 0.3));
  b.mesh(ring, b.mat(0xffffff, { vc: true, rough: 1, flat: true }), 0, 0.5, 0);
  const swirlMat = new MeshStandardMaterial({ map: swirl(), color: b.pal.glow, emissive: b.pal.glow, emissiveMap: swirl(), emissiveIntensity: 1.6, transparent: true, opacity: 0.85, side: DoubleSide, depthWrite: false, blending: AdditiveBlending });
  const disc = b.mesh(new CircleGeometryCompat(0.36), swirlMat, 0, 0.5, 0);
  b.mesh(new BoxGeometry(0.9, 0.06, 0.3), b.mat(0x77726b, { rough: 1, flat: true }), 0, 0.03, 0);
  b.updaters.push((_dt, t) => { disc.rotation.z = -t * 1.2; });
}

/** Circle geometry without importing CircleGeometry twice. */
class CircleGeometryCompat extends ShapeGeometry {
  constructor(r: number) {
    const s = new Shape();
    s.absarc(0, 0, r, 0, Math.PI * 2, false);
    super(s, 32);
    // Map UVs to 0..1 for the swirl texture.
    const p = this.attributes.position, uv = this.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / (2 * r) + 0.5, p.getY(i) / (2 * r) + 0.5);
  }
}

function well(b: Builder) {
  const stone = b.mat(0x9a948b, { rough: 1, flat: true });
  b.mesh(new CylinderGeometry(0.42, 0.45, 0.35, 16, 1, true), stone, 0, 0.175, 0).material = stone;
  b.mesh(new TorusGeometry(0.42, 0.05, 6, 16), stone, 0, 0.35, 0).rotation.x = Math.PI / 2;
  b.mesh(new CylinderGeometry(0.4, 0.4, 0.02, 16), b.mat(0x1f4a63, { rough: 0.1, metal: 0.3 }), 0, 0.25, 0);
  const wood = b.mat(0x6b4a2f);
  b.mesh(new BoxGeometry(0.05, 0.6, 0.05), wood, -0.4, 0.6, 0);
  b.mesh(new BoxGeometry(0.05, 0.6, 0.05), wood, 0.4, 0.6, 0);
  const tri = new Shape();
  tri.moveTo(-0.55, 0); tri.lineTo(0, 0.25); tri.lineTo(0.55, 0);
  const rg = new ExtrudeGeometry(tri, { depth: 0.5, bevelEnabled: false });
  rg.translate(0, 0, -0.25);
  b.mesh(rg, b.mat(b.pal.accentRed, { flat: true }), 0, 0.88, 0);
}

function boat(b: Builder) {
  const hull = new Shape();
  hull.moveTo(-0.5, 0.18); hull.quadraticCurveTo(-0.45, 0, 0, 0); hull.quadraticCurveTo(0.45, 0, 0.6, 0.2); hull.lineTo(-0.5, 0.18);
  const hg = new ExtrudeGeometry(hull, { depth: 0.36, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 2 });
  hg.translate(0, 0, -0.18);
  b.mesh(hg, b.mat(0x8a5a35, { rough: 0.8 }));
  b.mesh(new CylinderGeometry(0.02, 0.02, 0.8, 6), b.mat(0x5a3b22), 0, 0.55, 0);
  const sail = new Shape();
  sail.moveTo(0, 0); sail.lineTo(0, 0.6); sail.lineTo(0.35, 0.05); sail.lineTo(0, 0);
  b.mesh(new ShapeGeometry(sail), b.mat(0xf3eee2, { side: true }), 0.02, 0.25, 0);
  const g = b.root;
  b.updaters.push((_dt, t) => { g.children.forEach((m) => { m.rotation.x = 0.04 * Math.sin(t * 1.2 + b.seed); }); });
}

function statue(b: Builder) {
  b.mesh(new BoxGeometry(0.42, 0.28, 0.42), b.mat(0x8f8a82, { rough: 1 }), 0, 0.14, 0);
  const fig = new Builder(b.pal, b.seed);
  character(fig, true);
  fig.root.scale.setScalar(0.72);
  fig.root.position.y = 0.28;
  b.root.add(fig.root);
  b.mats.push(...fig.mats);
}

function cloud(b: Builder) {
  const m = b.mat(0xffffff, { rough: 1, emissive: 0xffffff, glow: 0.25 });
  for (let i = 0; i < 8; i++) {
    const r = 0.22 + b.rand(i) * 0.18;
    b.mesh(new SphereGeometry(r, 14, 10), m, (i - 3.5) * 0.17, 0.35 + Math.sin(i * 1.7) * 0.08 + (i % 3 === 1 ? 0.12 : 0), Math.cos(i * 2.3) * 0.12);
  }
}

// ---------------------------------------------------------------------------
// Town, city, desert and camp assets (procedural textures, no downloads)

const facadeCache = new Map<string, CanvasTexture>();
/**
 * A facade texture: rows of windows, some lit. Used as both colour and
 * emissive map, so the lit windows glow at dusk and night.
 */
function facade(kind: 'brick' | 'plaster' | 'glass', floors: number, cols: number, seed: number) {
  const key = `${kind}:${floors}:${cols}:${seed % 7}`;
  const hit = facadeCache.get(key);
  if (hit) return hit;
  const W = 256, H = Math.min(1024, 64 * floors);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  let s = seed * 9301 + 49297;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  g.fillStyle = kind === 'glass' ? '#556a7c' : '#ffffff';
  g.fillRect(0, 0, W, H);
  if (kind === 'brick') {
    g.fillStyle = 'rgba(0,0,0,0.08)';
    for (let y = 0; y < H; y += 6) g.fillRect(0, y, W, 1);
    for (let y = 0; y < H; y += 6) for (let x = (y / 6) % 2 ? 0 : 7; x < W; x += 14) g.fillRect(x, y, 1, 6);
  }
  if (kind === 'plaster') {
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.04})`; g.fillRect(r() * W, r() * H, 3 + r() * 8, 3 + r() * 8); }
  }
  const fh = H / floors, cw = W / cols;
  for (let f = 0; f < floors; f++) {
    for (let k = 0; k < cols; k++) {
      const lit = r() < (kind === 'glass' ? 0.35 : 0.45);
      const x = k * cw, y = f * fh;
      if (kind === 'glass') {
        g.fillStyle = lit ? `hsl(${40 + r() * 15},80%,${62 + r() * 18}%)` : `hsl(205,${20 + r() * 15}%,${18 + r() * 14}%)`;
        g.fillRect(x + 2, y + 3, cw - 4, fh - 6);
        g.fillStyle = 'rgba(255,255,255,0.08)';
        g.fillRect(x + 2, y + 3, (cw - 4) * 0.4, fh - 6);
      } else {
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(x + cw * 0.2 - 1, y + fh * 0.22 - 1, cw * 0.6 + 2, fh * 0.56 + 2);
        g.fillStyle = lit ? `hsl(${38 + r() * 12},90%,${66 + r() * 14}%)` : `hsl(210,25%,${22 + r() * 12}%)`;
        g.fillRect(x + cw * 0.2, y + fh * 0.22, cw * 0.6, fh * 0.56);
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.fillRect(x + cw * 0.5 - 1, y + fh * 0.22, 2, fh * 0.56);
        g.fillStyle = 'rgba(255,255,255,0.5)';
        g.fillRect(x + cw * 0.15, y + fh * 0.78, cw * 0.7, 3);
      }
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  facadeCache.set(key, t);
  return t;
}

/** The night-glow mask: only lit windows are bright. */
function glowFrom(tex: CanvasTexture) {
  const key = `glow:${tex.uuid}`;
  const hit = facadeCache.get(key);
  if (hit) return hit;
  const src = tex.image as HTMLCanvasElement;
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d')!;
  g.drawImage(src, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const warm = d.data[i] > 170 && d.data[i] > d.data[i + 2] + 40;
    if (!warm) { d.data[i] = d.data[i + 1] = d.data[i + 2] = 0; }
  }
  g.putImageData(d, 0, 0);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  facadeCache.set(key, t);
  return t;
}

const WALLS = [0xc8735a, 0xe9dcc4, 0xd9b38c, 0x9fb7a8, 0xe4c8a8, 0xb5634b, 0xf1e6d2, 0x8fa3b8];

function facadeMat(b: Builder, kind: 'brick' | 'plaster' | 'glass', floors: number, cols: number, tint: number) {
  const tex = facade(kind, floors, cols, b.seed);
  const m = b.mat(tint, { rough: kind === 'glass' ? 0.25 : 0.9, metal: kind === 'glass' ? 0.4 : 0, emissive: 0xffffff, glow: 0.55 });
  m.map = tex;
  m.emissiveMap = glowFrom(tex);
  return m;
}

/** A town building: 2–5 floors, brick or plaster, flat or pitched roof, shop front. */
function building(b: Builder) {
  const floors = 2 + Math.floor(b.rand(1) * 4);
  const w = 0.5 + b.rand(2) * 0.2, d = 0.48 + b.rand(3) * 0.16;
  const brick = b.rand(4) < 0.45;
  const tint = WALLS[b.seed % WALLS.length];
  const body = facadeMat(b, brick ? 'brick' : 'plaster', floors, 3, tint);
  const trim = b.mat(0xf3eee4, { rough: 0.8 });
  const dark = b.mat(0x3b3836, { rough: 0.7 });
  const h = 0.92;
  b.mesh(new BoxGeometry(w, h, d), body, 0, h / 2, 0);
  b.mesh(new BoxGeometry(w + 0.04, 0.03, d + 0.04), trim, 0, h, 0);
  if (b.rand(5) < 0.5) {
    const tri = new Shape();
    tri.moveTo(-w / 2 - 0.04, 0); tri.lineTo(0, 0.22); tri.lineTo(w / 2 + 0.04, 0); tri.lineTo(-w / 2 - 0.04, 0);
    const rg = new ExtrudeGeometry(tri, { depth: d + 0.06, bevelEnabled: false });
    rg.translate(0, 0, -(d + 0.06) / 2);
    b.mesh(rg, b.mat([0x6e3b2c, 0x50525a, 0x8a4a36][b.seed % 3], { rough: 0.8, flat: true }), 0, h, 0);
  } else {
    b.mesh(new BoxGeometry(w + 0.02, 0.05, d + 0.02), trim, 0, h + 0.025, 0);
    b.mesh(new BoxGeometry(0.12, 0.08, 0.12), dark, w * 0.25, h + 0.08, -d * 0.2);
  }
  // shop front with a striped awning
  const shop = b.mat(0xffe7b0, { emissive: 0xffc875, glow: 0.7 });
  b.mesh(new BoxGeometry(w * 0.7, 0.16, 0.01), shop, 0, 0.1, d / 2 + 0.006);
  b.mesh(new BoxGeometry(0.12, 0.2, 0.012), dark, w * 0.38, 0.1, d / 2 + 0.006);
  const aw = new Color([b.pal.accentRed, 0x2f7d6b, 0x2d5b9a, 0xd9a13b][b.seed % 4]);
  const awning = b.mat(aw, { rough: 0.9, side: true });
  const ag = new BoxGeometry(w * 0.78, 0.012, 0.1);
  b.mesh(ag, awning, 0, 0.22, d / 2 + 0.05).rotation.x = 0.35;
}

/** A glass skyscraper with setbacks and a roof crown. */
function skyscraper(b: Builder) {
  const tiers = 2 + Math.floor(b.rand(1) * 2);
  const tint = [0xbcd4e6, 0xd6dde2, 0x9fb9c9, 0xe8e2d6][b.seed % 4];
  let y = 0, w = 0.2 + b.rand(2) * 0.04;
  for (let i = 0; i < tiers; i++) {
    const h = (i === 0 ? 0.55 : 0.4 / (tiers - 1)) * (i === tiers - 1 ? 0.95 : 1);
    const floors = Math.max(3, Math.round(h * 40));
    const m = facadeMat(b, 'glass', floors, 6, tint);
    b.mesh(new BoxGeometry(w, h, w * (0.9 + b.rand(i + 5) * 0.2)), m, 0, y + h / 2, 0);
    y += h;
    b.mesh(new BoxGeometry(w + 0.01, 0.008, w + 0.01), b.mat(0xdedad2, { rough: 0.6 }), 0, y, 0);
    w *= 0.78;
  }
  b.mesh(new CylinderGeometry(0.003, 0.003, 1 - y, 6), b.mat(0x9a9a9a, { metal: 0.8, rough: 0.3 }), 0, y + (1 - y) / 2, 0);
  const tip = b.mat(0xff5040, { emissive: 0xff3020, glow: 2 });
  const blink = b.mesh(new SphereGeometry(0.008, 8, 6), tip, 0, 1, 0);
  b.updaters.push((_dt, t) => { blink.visible = Math.sin(t * 3) > 0; });
}

/** A small rounded car in a random cosy colour. */
function car(b: Builder) {
  const paint = b.mat([0xd6453d, 0x2f6fb5, 0xf2c14e, 0x5aa37a, 0xf4f1ea, 0x3c3c44, 0x88c4d8][b.seed % 7], { rough: 0.35, metal: 0.35 });
  const glass = b.mat(0x2b3a48, { rough: 0.1, metal: 0.6 });
  const tyre = b.mat(0x1d1d1f, { rough: 0.9 });
  const chrome = b.mat(0xd8d8d8, { metal: 0.9, rough: 0.25 });
  // unit height ~ 1, length 2.2
  const body = new BoxGeometry(2.1, 0.5, 0.95, 4, 1, 2);
  b.mesh(body, paint, 0, 0.42, 0);
  b.mesh(new BoxGeometry(1.15, 0.38, 0.85), glass, -0.1, 0.84, 0);
  b.mesh(new BoxGeometry(1.05, 0.06, 0.88), paint, -0.1, 1.04, 0);
  for (const [x, z] of [[0.68, 0.46], [-0.68, 0.46], [0.68, -0.46], [-0.68, -0.46]] as const) {
    const w = b.mesh(new CylinderGeometry(0.22, 0.22, 0.14, 16), tyre, x, 0.22, z);
    w.rotation.x = Math.PI / 2;
    b.mesh(new CylinderGeometry(0.1, 0.1, 0.15, 10), chrome, x, 0.22, z).rotation.x = Math.PI / 2;
  }
  const head = b.mat(0xfff4d0, { emissive: 0xffe2a0, glow: 1.2 });
  b.mesh(new BoxGeometry(0.02, 0.08, 0.2), head, 1.06, 0.48, 0.3);
  b.mesh(new BoxGeometry(0.02, 0.08, 0.2), head, 1.06, 0.48, -0.3);
  const tail = b.mat(0xff4030, { emissive: 0xff2010, glow: 0.8 });
  b.mesh(new BoxGeometry(0.02, 0.07, 0.18), tail, -1.06, 0.5, 0.32);
  b.mesh(new BoxGeometry(0.02, 0.07, 0.18), tail, -1.06, 0.5, -0.32);
}

function streetlamp(b: Builder) {
  const iron = b.mat(0x2a2f33, { metal: 0.7, rough: 0.4 });
  b.mesh(new CylinderGeometry(0.035, 0.05, 0.06, 10), iron, 0, 0.03, 0);
  b.mesh(new CylinderGeometry(0.012, 0.016, 0.9, 8), iron, 0, 0.47, 0);
  b.mesh(new BoxGeometry(0.16, 0.012, 0.012), iron, 0.07, 0.92, 0);
  const glass = b.mat(0xfff0c0, { emissive: 0xffd27a, glow: 2.2 });
  b.mesh(new SphereGeometry(0.035, 12, 8), glass, 0.14, 0.89, 0);
  b.plume(new Vector3(0.14, 0.89, 0), { count: 2, color: 0xffd27a, rise: 0.0, spread: 0.0, size: 0.3, life: 3, additive: true, opacity: 0.3 });
}

function bench(b: Builder) {
  const wood = b.mat(0x9a6a40, { rough: 0.8 });
  const iron = b.mat(0x2a2a2a, { metal: 0.6, rough: 0.5 });
  for (let i = 0; i < 3; i++) b.mesh(new BoxGeometry(1.6, 0.06, 0.16), wood, 0, 0.42, -0.2 + i * 0.18);
  for (let i = 0; i < 2; i++) b.mesh(new BoxGeometry(1.6, 0.14, 0.04), wood, 0, 0.62 + i * 0.18, -0.32).rotation.x = -0.15;
  for (const x of [-0.7, 0.7]) { b.mesh(new BoxGeometry(0.06, 0.42, 0.55), iron, x, 0.21, -0.02); b.mesh(new BoxGeometry(0.06, 0.5, 0.06), iron, x, 0.72, -0.33); }
}

function cactus(b: Builder) {
  const green = b.mat(0x4f8a4a, { rough: 0.9 });
  const ribbed = (r: number, h: number) => { const g = new CylinderGeometry(r, r * 1.05, h, 12, 4); return g; };
  b.mesh(ribbed(0.11, 0.86), green, 0, 0.43, 0);
  b.mesh(new SphereGeometry(0.11, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), green, 0, 0.86, 0);
  const arms = 1 + Math.floor(b.rand(1) * 2);
  for (let i = 0; i < arms; i++) {
    const s = i === 0 ? 1 : -1, y = 0.35 + b.rand(i + 2) * 0.2;
    b.mesh(ribbed(0.06, 0.18), green, s * 0.16, y, 0).rotation.z = Math.PI / 2;
    b.mesh(ribbed(0.065, 0.28), green, s * 0.25, y + 0.14, 0);
    b.mesh(new SphereGeometry(0.065, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), green, s * 0.25, y + 0.28, 0);
  }
  if (b.rand(9) < 0.5) b.mesh(new SphereGeometry(0.04, 8, 6), b.mat(0xff7aa8, { rough: 0.6 }), 0, 0.93, 0);
}

function tent(b: Builder) {
  const canvas = b.mat([0xe9b44c, 0xd7684a, 0x5b8f7a, 0xf1e3c6][b.seed % 4], { rough: 0.95, flat: true, side: true });
  const g = new ConeGeometry(0.62, 1, 6, 1, true);
  b.mesh(g, canvas, 0, 0.5, 0);
  b.mesh(new CylinderGeometry(0.012, 0.012, 1.15, 6), b.mat(0x6b4a2f), 0, 0.57, 0);
  const door = b.mat(0x3b2a20, { rough: 1, side: true });
  const dm = b.mesh(new ConeGeometry(0.2, 0.42, 3, 1, true, -0.5, 1), door, 0, 0.21, 0.42);
  dm.rotation.y = Math.PI;
  const flag = b.mat(b.pal.accentRed, { side: true });
  b.mesh(new BoxGeometry(0.16, 0.08, 0.004), flag, 0.08, 1.1, 0);
  b.plume(new Vector3(0, 0.3, 0.5), { count: 2, color: 0xffb060, rise: 0, spread: 0, size: 0.5, life: 3, additive: true, opacity: 0.2 });
}

function windmill(b: Builder) {
  const wall = b.mat(0xece4d4, { rough: 0.95 });
  b.mesh(new CylinderGeometry(0.14, 0.22, 0.75, 16), wall, 0, 0.375, 0);
  b.mesh(new ConeGeometry(0.17, 0.2, 16), b.mat(0x6e3b2c, { flat: true }), 0, 0.85, 0);
  b.mesh(new BoxGeometry(0.08, 0.14, 0.02), b.mat(0x5a3d26), 0, 0.07, 0.21);
  const hub = new Group();
  hub.position.set(0, 0.72, 0.18);
  b.root.add(hub);
  const sail = b.mat(0xf5efe2, { rough: 0.9, side: true });
  const wood = b.mat(0x7a5232);
  for (let i = 0; i < 4; i++) {
    const arm = new Group();
    arm.rotation.z = (i * Math.PI) / 2;
    hub.add(arm);
    b.mesh(new BoxGeometry(0.02, 0.48, 0.02), wood, 0, 0.24, 0, arm);
    b.mesh(new BoxGeometry(0.1, 0.36, 0.006), sail, 0.055, 0.28, 0, arm);
  }
  let spin = 0.6;
  b.updaters.push((dt) => { hub.rotation.z -= dt * spin; spin += (0.6 - spin) * dt * 0.5; });
  b.triggers.push(() => { spin = 4; });
}

function stall(b: Builder) {
  const wood = b.mat(0x8a5d3b, { rough: 0.85 });
  b.mesh(new BoxGeometry(1, 0.42, 0.5), wood, 0, 0.21, 0);
  for (const x of [-0.46, 0.46]) for (const z of [-0.22, 0.22]) b.mesh(new BoxGeometry(0.04, 0.9, 0.04), wood, x, 0.45, z);
  // striped awning: alternating stripes
  const a = new Color([b.pal.accentRed, 0x2f7d6b, 0x2d5b9a][b.seed % 3]);
  const s1 = b.mat(a, { rough: 0.9, side: true }), s2 = b.mat(0xf6f1e6, { rough: 0.9, side: true });
  for (let i = 0; i < 6; i++) b.mesh(new BoxGeometry(1.1 / 6, 0.012, 0.66), i % 2 ? s1 : s2, -0.55 + (i + 0.5) * (1.1 / 6), 0.95, 0).rotation.x = 0.18;
  const fruit = [0xf26b3a, 0xf2c14e, 0x6db34f, 0xd94a5a];
  for (let i = 0; i < 14; i++) b.mesh(new SphereGeometry(0.045, 8, 6), b.mat(fruit[i % 4], { rough: 0.5 }), -0.42 + (i % 7) * 0.14, 0.46, -0.1 + Math.floor(i / 7) * 0.16);
}

function fountain(b: Builder) {
  const stone = b.mat(0xd6d0c4, { rough: 0.9 });
  const pts: Vector2[] = [new Vector2(0, 0), new Vector2(0.5, 0), new Vector2(0.5, 0.2), new Vector2(0.44, 0.2), new Vector2(0.44, 0.08), new Vector2(0, 0.08)];
  b.mesh(new LatheGeometry(pts, 32), stone, 0, 0, 0);
  b.mesh(new CylinderGeometry(0.44, 0.44, 0.02, 32), b.mat(0x4a9fc0, { rough: 0.05, metal: 0.3, opacity: 0.85 }), 0, 0.16, 0);
  b.mesh(new CylinderGeometry(0.05, 0.07, 0.55, 12), stone, 0, 0.35, 0);
  b.mesh(new CylinderGeometry(0.2, 0.06, 0.08, 20), stone, 0, 0.62, 0);
  const spray = b.plume(new Vector3(0, 0.66, 0), { count: 14, color: 0xcfeeff, rise: 0.3, spread: 0.5, size: 0.08, life: 1.4, opacity: 0.6 });
  b.triggers.push(() => spray.surge(2));
}

function balloon(b: Builder) {
  const cols = [0xe0503a, 0xf2c14e, 0x2d7fb8, 0xf4f1ea];
  const stripes = 8;
  for (let i = 0; i < stripes; i++) {
    const g = new SphereGeometry(0.36, 6, 16, (i / stripes) * Math.PI * 2, (Math.PI * 2) / stripes, 0, Math.PI * 0.78);
    b.mesh(g, b.mat(cols[(i + b.seed) % cols.length], { rough: 0.7, side: true }), 0, 0.62, 0);
  }
  const rope = b.mat(0x6b5a48);
  for (const [x, z] of [[0.08, 0.08], [-0.08, 0.08], [0.08, -0.08], [-0.08, -0.08]] as const) b.mesh(new CylinderGeometry(0.003, 0.003, 0.3, 4), rope, x * 1.6, 0.2, z * 1.6);
  b.mesh(new BoxGeometry(0.2, 0.14, 0.2), b.mat(0x8a5d3b, { rough: 0.9 }), 0, 0.07, 0);
  const flame = b.plume(new Vector3(0, 0.27, 0), { count: 4, color: 0xffa040, rise: 0.06, spread: 0.02, size: 0.1, life: 0.6, additive: true, opacity: 0.6 });
  b.triggers.push(() => flame.surge(2.5));
}

// ---------------------------------------------------------------------------
// Motorsport: race car, grandstand, floodlight, start gantry, tyre stack, pit garage

const LIVERY = [0xd8202a, 0xc0c4cc, 0xff8000, 0x1f3f9e, 0x0a6e4a, 0xf2f2f2, 0x15151a];

function racecar(b: Builder) {
  // Unit height ~1 (wheel top); length ~4.6 along x, nose at +x.
  const paint = b.mat(LIVERY[b.seed % LIVERY.length], { rough: 0.3, metal: 0.4 });
  const carbon = b.mat(0x1b1c20, { rough: 0.5, metal: 0.3 });
  const tyre = b.mat(0x141416, { rough: 0.95 });
  const accent = b.mat([0xffd23a, 0x00c2ff, 0xffffff][b.seed % 3], { rough: 0.4 });
  b.mesh(new BoxGeometry(2.6, 0.32, 0.62), paint, 0, 0.42, 0);                 // tub
  b.mesh(new ConeGeometry(0.22, 1.4, 4), paint, 1.95, 0.4, 0).rotation.z = -Math.PI / 2; // nose
  b.mesh(new BoxGeometry(1.3, 0.38, 1.05), paint, -0.35, 0.45, 0);             // sidepods
  b.mesh(new BoxGeometry(0.9, 0.42, 0.34), paint, -0.6, 0.78, 0);              // engine cover
  b.mesh(new BoxGeometry(0.5, 0.22, 0.4), carbon, 0.35, 0.7, 0);               // cockpit
  b.mesh(new TorusGeometry(0.2, 0.025, 6, 16, Math.PI), carbon, 0.35, 0.82, 0).rotation.y = Math.PI / 2; // halo
  b.mesh(new SphereGeometry(0.12, 12, 8), accent, 0.3, 0.84, 0);              // helmet
  b.mesh(new BoxGeometry(0.35, 0.04, 1.6), carbon, 2.45, 0.18, 0);             // front wing
  b.mesh(new BoxGeometry(0.06, 0.18, 1.6), accent, 2.6, 0.24, 0);
  b.mesh(new BoxGeometry(0.32, 0.06, 1.1), paint, -1.95, 0.98, 0);             // rear wing
  for (const z of [-0.5, 0.5]) b.mesh(new BoxGeometry(0.3, 0.55, 0.04), carbon, -1.95, 0.72, z);
  for (const [x, r, w] of [[1.45, 0.3, 0.32], [-1.3, 0.36, 0.42]] as const) {
    for (const z of [-0.72, 0.72]) b.mesh(new CylinderGeometry(r, r, w, 20), tyre, x, r, z).rotation.x = Math.PI / 2;
  }
  const rain = b.mat(0xff2a2a, { emissive: 0xff1010, glow: 1.5 });
  b.mesh(new BoxGeometry(0.03, 0.08, 0.12), rain, -2.12, 0.62, 0);
}

function grandstand(b: Builder) {
  const concrete = b.mat(0xb8b4ac, { rough: 0.95 });
  const roof = b.mat(0xe8e8ec, { rough: 0.5, metal: 0.3, side: true });
  const steel = b.mat(0x5c6066, { metal: 0.6, rough: 0.4 });
  const W = 3, rows = 7;
  const fans = [0xd8202a, 0xffd23a, 0x1f3f9e, 0xf2f2f2, 0xff8000, 0x0a6e4a].map((c) => b.mat(c, { rough: 0.8 }));
  for (let r = 0; r < rows; r++) {
    b.mesh(new BoxGeometry(W, 0.1, 0.18), concrete, 0, 0.08 + r * 0.1, -r * 0.18 + 0.55);
    // A crowd in team colours.
    const n = 22, seat = new BoxGeometry((W / n) * 0.7, 0.08, 0.07);
    for (let k = 0; k < n; k++) b.mesh(k ? seat.clone() : seat, fans[(k * 7 + r * 3 + b.seed) % fans.length], -W / 2 + (k + 0.5) * (W / n), 0.17 + r * 0.1, -r * 0.18 + 0.52);
  }
  b.mesh(new BoxGeometry(W, 0.86, 0.12), concrete, 0, 0.43, 0.6 - rows * 0.18);
  for (const x of [-W / 2 + 0.05, 0, W / 2 - 0.05]) b.mesh(new BoxGeometry(0.05, 1, 0.05), steel, x, 0.5, 0.62 - rows * 0.18);
  const r = b.mesh(new BoxGeometry(W + 0.2, 0.04, 1.5), roof, 0, 1.0, -0.05);
  r.rotation.x = -0.12;
  b.plume(new Vector3(0, 0.6, 0.2), { count: 3, color: 0xfff2c0, rise: 0, spread: 0, size: 1.2, life: 3, additive: true, opacity: 0.12 });
}

function floodlight(b: Builder) {
  const steel = b.mat(0x6a6e74, { metal: 0.7, rough: 0.35 });
  b.mesh(new CylinderGeometry(0.012, 0.022, 0.88, 8), steel, 0, 0.44, 0);
  b.mesh(new BoxGeometry(0.34, 0.16, 0.04), steel, 0, 0.92, 0);
  const lamp = b.mat(0xffffff, { emissive: 0xfff6e0, glow: 3 });
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) b.mesh(new BoxGeometry(0.06, 0.05, 0.02), lamp, -0.12 + i * 0.08, 0.89 + j * 0.06, 0.025);
  b.plume(new Vector3(0, 0.92, 0.05), { count: 3, color: 0xfff6e0, rise: 0, spread: 0, size: 0.7, life: 2.5, additive: true, opacity: 0.35 });
}

function gantry(b: Builder) {
  // Spans x (across the track): posts at ±1.5.
  const steel = b.mat(0x2b2e33, { metal: 0.6, rough: 0.4 });
  const board = b.mat(0x101114, { rough: 0.6 });
  for (const x of [-1.55, 1.55]) b.mesh(new BoxGeometry(0.05, 1, 0.05), steel, x, 0.5, 0);
  b.mesh(new BoxGeometry(3.2, 0.2, 0.12), board, 0, 0.92, 0);
  const lights: MeshStandardMaterial[] = [];
  for (let i = 0; i < 5; i++) {
    const m = b.mat(0x400000, { emissive: 0xff1a1a, glow: 0.1 });
    lights.push(m);
    b.mesh(new SphereGeometry(0.05, 10, 8), m, -0.5 + i * 0.25, 0.92, 0.07);
  }
  // Start sequence: lights on one by one, then out (lights out and away we go!).
  let seq = -1;
  b.updaters.push((dt) => {
    if (seq < 0) return;
    seq += dt;
    const on = Math.min(5, Math.floor(seq / 0.6));
    lights.forEach((m, i) => { m.emissiveIntensity = seq < 3.6 && i < on ? 2.5 : 0.1; });
    if (seq > 4.2) seq = -1;
  });
  b.triggers.push(() => { seq = 0; });
  // A chequered band on the beam.
  const chk = b.mat(0xffffff, { rough: 0.6 });
  for (let i = 0; i < 16; i++) if (i % 2) b.mesh(new BoxGeometry(0.2, 0.06, 0.125), chk, -1.5 + i * 0.2, 1.05, 0);
}

function tyres(b: Builder) {
  const rubber = b.mat(0x18181a, { rough: 0.95 });
  const band = b.mat([0xffffff, 0xd8202a][b.seed % 2], { rough: 0.8 });
  for (let i = 0; i < 4; i++) {
    b.mesh(new TorusGeometry(0.3, 0.12, 8, 20), rubber, 0, 0.12 + i * 0.24, 0).rotation.x = Math.PI / 2;
    if (i % 2) b.mesh(new TorusGeometry(0.3, 0.125, 4, 20, Math.PI * 2), band, 0, 0.12 + i * 0.24, 0).rotation.x = Math.PI / 2;
  }
}

function garage(b: Builder) {
  const wall = b.mat(0xe9e9ee, { rough: 0.6 });
  const team = new Color(LIVERY[b.seed % LIVERY.length]);
  const doorMat = b.mat(0x2a2c30, { metal: 0.4, rough: 0.5 });
  b.mesh(new BoxGeometry(3.2, 1, 1.2), wall, 0, 0.5, 0);
  b.mesh(new BoxGeometry(3.3, 0.08, 1.3), b.mat(0x9aa0a8, { metal: 0.5 }), 0, 1.02, 0);
  for (let i = 0; i < 4; i++) {
    b.mesh(new BoxGeometry(0.62, 0.62, 0.02), doorMat, -1.2 + i * 0.8, 0.33, 0.61);
    b.mesh(new BoxGeometry(0.62, 0.1, 0.03), b.mat(LIVERY[(b.seed + i) % LIVERY.length], { emissive: LIVERY[(b.seed + i) % LIVERY.length], glow: 0.4 }), -1.2 + i * 0.8, 0.75, 0.62);
  }
  b.mesh(new BoxGeometry(3.2, 0.06, 0.02), b.mat(team, { emissive: team.getHex(), glow: 0.6 }), 0, 0.92, 0.61);
}

// ---------------------------------------------------------------------------

export function buildAsset(type: AssetType, size: number, rawSeed: number, pal: PaletteColors, variant = 0): AssetInstance {
  // Integer seed: picks colours and variants by index.
  const seed = Math.abs(Math.floor(rawSeed * 1000)) | 0;
  const b = new Builder(pal, seed);
  switch (type) {
    case 'oak': case 'pine': case 'aspen': case 'ash': case 'bush': tree(b, type, Math.round(variant) + seed); break;
    case 'palm': palm(b); break;
    case 'rock': rock(b); break;
    case 'volcano': peak(b, true); break;
    case 'mountain': peak(b, false); break;
    case 'cottage': cottage(b); break;
    case 'tower': tower(b, false); break;
    case 'lighthouse': tower(b, true); break;
    case 'castle': castle(b); break;
    case 'campfire': campfire(b); break;
    case 'lantern': lantern(b); break;
    case 'mushroom': mushroom(b); break;
    case 'crystal': crystal(b); break;
    case 'flower': flower(b); break;
    case 'character': character(b); break;
    case 'portal': portal(b); break;
    case 'well': well(b); break;
    case 'boat': boat(b); break;
    case 'statue': statue(b); break;
    case 'cloud': cloud(b); break;
    case 'maple': case 'snowpine': tree(b, type, Math.round(variant) + seed); break;
    case 'building': building(b); break;
    case 'skyscraper': skyscraper(b); break;
    case 'car': car(b); break;
    case 'streetlamp': streetlamp(b); break;
    case 'bench': bench(b); break;
    case 'cactus': cactus(b); break;
    case 'tent': tent(b); break;
    case 'windmill': windmill(b); break;
    case 'stall': stall(b); break;
    case 'fountain': fountain(b); break;
    case 'balloon': balloon(b); break;
    case 'racecar': racecar(b); break;
    case 'grandstand': grandstand(b); break;
    case 'floodlight': floodlight(b); break;
    case 'gantry': gantry(b); break;
    case 'tyres': tyres(b); break;
    case 'garage': garage(b); break;
  }
  return b.finish(size);
}

export const treeClock = () => treeTime;
export const softTexture = soft;
