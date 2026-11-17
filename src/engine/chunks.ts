/**
 * The endless world, as pure data: chunk grid maths, the "kit" of props a
 * world is made of, and deterministic scattering of that kit across chunks.
 * Pure TypeScript so it is unit-tested and identical on every run: walk away
 * and come back, and the same trees stand in the same places.
 */
import { assetDims, type CreationT, type PartT } from '../spec/schema.js';
import { midiToNote, noteToMidi } from '../spec/music.js';
import { isDry, type TerrainT } from './terrain.js';
import { biomeOf } from './biome.js';

/** Chunk edge in world units (the width of the play zone). */
export const CHUNK = 0.64;

export const chunkOf = (x: number, z: number): [number, number] => [Math.floor(x / CHUNK + 0.5), Math.floor(z / CHUNK + 0.5)];
export const chunkKey = (ix: number, iz: number) => `${ix},${iz}`;
export const chunkCenter = (ix: number, iz: number): [number, number] => [ix * CHUNK, iz * CHUNK];

/** Chunks within `radius` rings of (ix, iz), nearest first. */
export function ringKeys(ix: number, iz: number, radius: number): { ix: number; iz: number; key: string; d: number }[] {
  const out: { ix: number; iz: number; key: string; d: number }[] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      out.push({ ix: ix + dx, iz: iz + dz, key: chunkKey(ix + dx, iz + dz), d: Math.max(Math.abs(dx), Math.abs(dz)) + Math.hypot(dx, dz) * 0.01 });
    }
  }
  return out.sort((a, b) => a.d - b.d);
}

/** Human direction from the start, for prompts: "2 north, 1 east". -z is away from the user (north). */
export function directionWords(ix: number, iz: number) {
  const parts: string[] = [];
  if (iz) parts.push(`${Math.abs(iz)} ${iz < 0 ? 'north' : 'south'}`);
  if (ix) parts.push(`${Math.abs(ix)} ${ix > 0 ? 'east' : 'west'}`);
  return parts.length ? parts.join(', ') : 'the start';
}

/** Small seeded RNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Rough horizontal radius of a part. */
export function partRadius(p: PartT): number {
  const s = p.shape;
  const k = p.transform.scale ?? 1;
  let r: number;
  switch (s.kind) {
    case 'cylinder': case 'cone': case 'capsule': case 'sphere': r = s.radius; break;
    case 'box': r = Math.max(s.size[0], s.size[2]) / 2; break;
    case 'torus': r = s.radius + s.tube; break;
    case 'lathe': r = Math.max(...s.profile.map((q) => q[0])); break;
    case 'tube': r = s.radius * 2; break;
    case 'blob': r = s.radius * (1 + (s.lumps ?? 0.5) * 0.3); break;
    case 'frustum': r = Math.max(s.top, s.bottom); break;
    case 'asset': r = assetDims(s.type, s.size).radius; break;
  }
  return r * k;
}

/** One reusable prop of a world: a tree (trunk + crown), a creature, a rock. */
export interface KitItem {
  name: string;
  /** Parts relative to the prop's footprint centre (x, z), y unchanged (height above ground). */
  parts: PartT[];
  radius: number;
  creature: boolean;
  weight: number;
}

const GLOBAL_REACTIONS = new Set(['daynight', 'rain', 'erupt']);
/** Unique story things are never copied across the land. */
const UNIQUE_ASSETS = new Set(['character', 'portal', 'statue', 'volcano', 'mountain', 'castle', 'lighthouse', 'well', 'boat', 'campfire', 'tower', 'cloud', 'building', 'skyscraper', 'windmill', 'fountain', 'balloon', 'stall', 'car', 'streetlamp']);

/** Pick out the props of a world that can be scattered across new land. */
export function extractKit(spec: Pick<CreationT, 'parts' | 'ambient'>): KitItem[] {
  const candidates = spec.parts.filter((p) =>
    p.motion?.type !== 'orbit' &&
    !(p.shape.kind === 'asset' && UNIQUE_ASSETS.has(p.shape.type)) &&
    !(p.react ?? []).some((r) => GLOBAL_REACTIONS.has(r.do)) &&
    p.transform.pos[1] <= 0.14,
  );
  // Cluster parts that share a footprint (a crown on its trunk).
  const clusters: PartT[][] = [];
  for (const p of candidates) {
    const [x, , z] = p.transform.pos;
    // Creatures roam on their own; only static parts stack (a crown on its trunk).
    const roams = p.motion?.type === 'wander';
    const home = roams ? undefined : clusters.find((c) => c.every((q) => q.motion?.type !== 'wander') &&
      c.some((q) => Math.hypot(q.transform.pos[0] - x, q.transform.pos[2] - z) < 0.02));
    if (home) home.push(p); else clusters.push([p]);
  }
  const kit: KitItem[] = [];
  for (const c of clusters) {
    const cx = c.reduce((s, p) => s + p.transform.pos[0], 0) / c.length;
    const cz = c.reduce((s, p) => s + p.transform.pos[2], 0) / c.length;
    const radius = Math.max(...c.map((p) => partRadius(p) + Math.hypot(p.transform.pos[0] - cx, p.transform.pos[2] - cz)));
    if (radius > 0.12) continue;
    const creature = c.some((p) => p.motion?.type === 'wander');
    // Same-looking props (two palm trees) only need to be in the kit once.
    // Repeated parts are labelled with their note ("E5"), so prefer a real label, then the id.
    const isNote = (l: string) => /^[A-G][#b]?-?\d$/.test(l);
    const label = c.map((p) => p.label).find((l): l is string => !!l && !isNote(l));
    const name = (label ?? c[0].id).replace(/[-\s]?\d+$/, '');
    if (kit.some((k) => k.name === name)) continue;
    kit.push({
      name,
      parts: c.map((p) => ({ ...p, transform: { ...p.transform, pos: [p.transform.pos[0] - cx, p.transform.pos[1], p.transform.pos[2] - cz] } })),
      radius: Math.max(0.015, radius),
      creature,
      weight: creature ? 0.6 : 1,
    });
  }
  return [...kit, ...fillers(spec)];
}

const asset = (id: string, label: string, type: string, size: number, weight: number, radius: number, extra: Partial<PartT> = {}): KitItem => ({
  name: label, radius, creature: false, weight,
  parts: [{ id, label, shape: { kind: 'asset', type, size } as PartT['shape'], transform: { pos: [0, 0, 0] }, verb: 'strike', ...extra }],
});

/**
 * Realistic props every world gets, chosen by its climate, so new land becomes
 * forest, palm groves or snowy pines rather than empty ground.
 */
function fillers(spec: Pick<CreationT, 'ambient' | 'terrain'>): KitItem[] {
  const biome = biomeOf(spec);
  const rock = asset('rock', 'Boulder', 'rock', 0.035, 0.6, 0.026);
  switch (biome) {
    case 'snow': return [asset('snowpine', 'Snowy pine', 'snowpine', 0.19, 1.8, 0.05), asset('pine', 'Pine', 'pine', 0.17, 0.5, 0.05), rock, asset('crystal', 'Ice crystal', 'crystal', 0.04, 0.4, 0.016)];
    case 'desert': return [asset('cactus', 'Cactus', 'cactus', 0.07, 1.6, 0.025), rock, asset('rock2', 'Red rock', 'rock', 0.07, 0.6, 0.05), asset('palm', 'Palm', 'palm', 0.15, 0.25, 0.05), asset('tent', 'Tent', 'tent', 0.06, 0.15, 0.04)];
    case 'autumn': return [asset('maple', 'Maple', 'maple', 0.18, 1.6, 0.06), asset('oak', 'Oak', 'oak', 0.17, 0.5, 0.06), asset('bush', 'Bush', 'bush', 0.04, 0.8, 0.03), rock, asset('mushroom', 'Mushroom', 'mushroom', 0.02, 0.5, 0.01)];
    case 'fantasy': return [asset('aspen', 'Silver tree', 'aspen', 0.17, 1, 0.04), asset('mushroom', 'Giant mushroom', 'mushroom', 0.07, 1, 0.03), asset('crystal', 'Crystal', 'crystal', 0.05, 0.9, 0.02), asset('flower', 'Flower', 'flower', 0.025, 1, 0.01), asset('bush', 'Bush', 'bush', 0.04, 0.5, 0.03)];
    case 'village': return [asset('oak', 'Oak', 'oak', 0.17, 1.2, 0.06), asset('bush', 'Bush', 'bush', 0.04, 1, 0.03), asset('flower', 'Flower', 'flower', 0.025, 1, 0.01), asset('windmill', 'Windmill', 'windmill', 0.3, 0.12, 0.07), asset('cottage', 'Cottage', 'cottage', 0.15, 0.25, 0.07), rock];
    case 'city': return [asset('oak', 'Tree', 'oak', 0.16, 1, 0.05), asset('bench', 'Bench', 'bench', 0.024, 0.6, 0.02), asset('flower', 'Flower', 'flower', 0.025, 0.6, 0.01)];
    case 'forest': return [asset('pine', 'Pine', 'pine', 0.2, 1.4, 0.05), asset('oak', 'Oak', 'oak', 0.18, 1.2, 0.06), asset('ash', 'Ash', 'ash', 0.2, 0.8, 0.05), asset('bush', 'Bush', 'bush', 0.04, 1, 0.03), asset('mushroom', 'Mushroom', 'mushroom', 0.02, 0.5, 0.01), rock];
    default: break;
  }
  if (biome === 'tropical') return [asset('palm', 'Palm', 'palm', 0.13, 1.4, 0.05), asset('bush', 'Bush', 'bush', 0.04, 1, 0.03), rock, asset('flower', 'Flower', 'flower', 0.025, 0.7, 0.01)];
  return [
    asset('oak', 'Oak', 'oak', 0.17, 1.1, 0.06), asset('pine', 'Pine', 'pine', 0.19, 0.6, 0.05), asset('aspen', 'Aspen', 'aspen', 0.16, 0.5, 0.04),
    asset('bush', 'Bush', 'bush', 0.04, 1, 0.03), rock, asset('flower', 'Flower', 'flower', 0.025, 0.8, 0.01), asset('mushroom', 'Mushroom', 'mushroom', 0.02, 0.3, 0.01),
  ];
}

/** Pentatonic steps: each chunk plays in a slightly different key, so walking is musical. */
const KEY_SHIFT = [0, 2, 4, 7, 9, -3, -5];

function transpose(pitch: string | number | undefined, semis: number): string | number | undefined {
  if (semis === 0 || pitch == null) return pitch;
  if (typeof pitch === 'number') return Math.round(pitch * Math.pow(2, semis / 12));
  const midi = noteToMidi(pitch);
  return midi == null ? pitch : midiToNote(midi + semis);
}

/**
 * Scatter kit props over a chunk. Deterministic for (seed, ix, iz).
 * Positions are world units (absolute), y = height above the ground.
 */
export function scatterChunk(kit: readonly KitItem[], terrain: TerrainT, ix: number, iz: number, seed: string, density = 1): PartT[] {
  if (!kit.length) return [];
  const rand = rng(hashString(`${seed}:${ix},${iz}`));
  const [cx, cz] = chunkCenter(ix, iz);
  const key = `${ix}_${iz}`;
  const shift = KEY_SHIFT[Math.abs(ix * 3 + iz * 5) % KEY_SHIFT.length];
  const total = kit.reduce((s, k) => s + k.weight, 0);
  const count = Math.round((9 + rand() * 6) * density);
  const placed: { x: number; z: number; r: number }[] = [];
  const out: PartT[] = [];
  for (let n = 0; n < count; n++) {
    let pick = rand() * total;
    const item = kit.find((k) => (pick -= k.weight) <= 0) ?? kit[kit.length - 1];
    const scale = 0.8 + rand() * 0.5;
    const r = item.radius * scale;
    let spot: [number, number] | null = null;
    for (let tries = 0; tries < 4 && !spot; tries++) {
      const x = cx + (rand() - 0.5) * (CHUNK - 0.06);
      const z = cz + (rand() - 0.5) * (CHUNK - 0.06);
      // Keep clear of the conjured island (its own things live there) and of water.
      if (Math.hypot(x, z) < terrain.radius * 1.05) continue;
      if (!isDry(terrain, x, z, 0.006)) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 0.02)) continue;
      spot = [x, z];
    }
    if (!spot) continue;
    placed.push({ x: spot[0], z: spot[1], r });
    const yaw = rand() * Math.PI * 2;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const p of item.parts) {
      const [dx, y, dz] = p.transform.pos;
      const rot = p.transform.rot ?? [0, 0, 0];
      out.push({
        ...p,
        id: `${key}-${n}-${p.id}`,
        react: p.react?.filter((rc) => !rc.target),
        sound: p.sound ? { ...p.sound, pitch: transpose(p.sound.pitch, shift) } : undefined,
        motion: p.motion ? { ...p.motion, phase: rand() * Math.PI * 2 } : undefined,
        transform: {
          pos: [spot[0] + (dx * c + dz * s) * scale, y * scale, spot[1] + (-dx * s + dz * c) * scale],
          rot: [rot[0], rot[1] + (yaw * 180) / Math.PI, rot[2]],
          scale: (p.transform.scale ?? 1) * scale,
        },
      });
    }
  }
  return out;
}

/** Offset a designed area (play-zone coordinates) to a spot in the world. */
export function placeArea(parts: readonly PartT[], center: [number, number], prefix: string): PartT[] {
  // The designer uses the play zone (z -0.28..0.16): centre it on the spot.
  return parts.map((p) => ({
    ...p,
    id: `${prefix}-${p.id}`,
    react: p.react?.map((r) => (r.target ? { ...r, target: `${prefix}-${r.target}` } : r)),
    transform: { ...p.transform, pos: [center[0] + p.transform.pos[0], p.transform.pos[1], center[1] + p.transform.pos[2] + 0.06] },
  }));
}

/** Lowest point of a part below its position (for standing objects on the ground). */
function partBottom(p: PartT): number {
  const s = p.shape, k = p.transform.scale ?? 1;
  let below: number;
  switch (s.kind) {
    case 'cylinder': case 'cone': case 'frustum': below = s.height / 2; break;
    case 'box': below = s.size[1] / 2; break;
    case 'sphere': below = s.radius; break;
    case 'torus': below = s.tube; break;
    case 'capsule': below = s.radius + s.length / 2; break;
    case 'lathe': below = -Math.min(...s.profile.map((q) => q[1])); break;
    case 'tube': below = s.length; break;
    case 'blob': below = s.radius * (s.squash ?? 1); break;
    case 'asset': below = 0; break;
  }
  return p.transform.pos[1] - below * k;
}

/**
 * Any creation can be stepped into: an instrument or object is set on a gentle
 * meadow so it becomes the centre of an endless world.
 */
export function objectToWorld(spec: CreationT): CreationT {
  if (spec.kind === 'world' && spec.terrain) return spec;
  const floor = Math.min(...spec.parts.map(partBottom));
  return {
    ...spec,
    kind: 'world',
    terrain: { style: 'hill', radius: 0.3, height: 0.03, roughness: 0.3, water: false, seed: hashString(spec.title) % 97 },
    ambient: spec.ambient ?? { particles: 'none', light: 'day' },
    parts: spec.parts.map((p) => ({ ...p, transform: { ...p.transform, pos: [p.transform.pos[0], Math.max(0, p.transform.pos[1] - floor), p.transform.pos[2]] } })),
  };
}
