/**
 * World terrain, shared by the headset (mesh, wandering creatures, chunks)
 * and the server (playtest). Pure math: same inputs, same ground everywhere.
 *
 * Two shapes of ground:
 * - the island (or hill, crater...) the user conjured, inside `radius`;
 * - with `field: true` (the headset sets it when you step inside a world), an
 *   endless landscape around it made from seeded value noise, so the world
 *   keeps going in every direction. The island is unchanged inside its radius,
 *   so parts placed on it never move.
 */
import { TRACK_WIDTH, trackDistance, trackLoop } from './track.js';

export interface TerrainT {
  style: 'island' | 'hill' | 'crater' | 'flat' | 'floating';
  radius: number;
  height: number;
  roughness?: number;
  water?: boolean;
  seed?: number;
  /** meadow | forest | autumn | snow | desert | tropical | city | village | fantasy */
  /** A race track loops around the world. */
  track?: 'circuit' | 'oval';
  biome?: 'meadow' | 'forest' | 'autumn' | 'snow' | 'desert' | 'tropical' | 'city' | 'village' | 'fantasy';
  /** Endless landscape around the island (headset only). */
  field?: boolean;
}

/** World-space y offset of the terrain base inside the play zone. */
export const WORLD_BASE_Y = -0.08;

function noise(x: number, z: number, seed: number) {
  return (
    Math.sin(x * 23.1 + seed * 1.7) * Math.cos(z * 19.7 - seed) * 0.5 +
    Math.sin((x + z) * 41.3 + seed * 3.1) * 0.25 +
    Math.cos((x - z) * 67.9 + seed * 5.3) * 0.125
  );
}

/** Deterministic hash of a lattice point to [-1, 1]. */
function hash(ix: number, iz: number, seed: number) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(Math.round(seed * 1000) | 0, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** Smooth value noise in [-1, 1]. */
export function valueNoise(x: number, z: number, seed: number) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed), c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const FIELD_AMP: Record<TerrainT['style'], number> = { flat: 0.5, hill: 1.4, crater: 1.1, island: 1, floating: 1 };

/** The endless landscape (relative to the terrain base). With water, roughly a third is sea. */
export function fieldHeight(t: TerrainT, x: number, z: number): number {
  const s = t.seed ?? 1;
  // Cities are built on level ground (a gentle swell, never a hill).
  if (t.biome === 'city') return Math.max(0, 0.004 + valueNoise(x * 0.6, z * 0.6, s) * 0.003);
  // Deserts roll in long dunes.
  if (t.biome === 'desert') {
    const dune = Math.abs(Math.sin(x * 2.2 + valueNoise(x * 0.8, z * 0.8, s) * 2.5 + z * 0.9));
    return Math.max(0, (0.35 + 0.45 * dune + valueNoise(x * 1.1, z * 1.1, s + 3) * 0.25) * Math.max(0.04, t.height));
  }
  const H = Math.max(0.04, t.height) * FIELD_AMP[t.style];
  const n = valueNoise(x * 1.3, z * 1.3, s) * 0.6 +
    valueNoise(x * 3.1 + 17, z * 3.1, s + 7) * 0.3 +
    valueNoise(x * 7.7, z * 7.7 + 5, s + 13) * 0.2 * (t.roughness ?? 0.4);
  if (t.water) return Math.max(0, (n * 1.4 + 0.3) * H);
  return Math.max(0, (0.5 + 0.5 * n) * H);
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function islandHeight(t: TerrainT, x: number, z: number, r: number): number {
  if (r >= 1) return 0;
  const rough = (t.roughness ?? 0.4) * t.height * 0.35 * noise(x, z, t.seed ?? 1) * (1 - r);
  let h: number;
  switch (t.style) {
    case 'hill': h = t.height * Math.pow(1 - r * r, 1.4); break;
    case 'crater': h = t.height * Math.max(0, 1 - Math.abs(r - 0.6) / 0.4) * (r > 0.25 ? 1 : 0.4); break;
    case 'flat': h = t.height * 0.15 * (1 - r * r); break;
    case 'island':
    case 'floating':
    default: h = t.height * Math.pow(Math.max(0, 1 - r * r), 1.5); break;
  }
  return Math.max(0, h + rough);
}

/** Height of the ground (relative to the terrain base) at x,z. */
export function terrainHeight(t: TerrainT, x: number, z: number): number {
  const r = Math.hypot(x, z) / Math.max(0.01, t.radius);
  const island = islandHeight(t, x, z, r);
  if (!t.field) return island;
  // The landscape fades in beyond the island so the island itself never changes.
  let w = smoothstep(0.95, 1.6, r);
  // Level ground under and beside a race track.
  if (w > 0 && t.track) { const pts = trackLoop(t); if (pts) w *= smoothstep(TRACK_WIDTH * 0.6, TRACK_WIDTH * 2.2, trackDistance(pts, x, z)); }
  return w > 0 ? Math.max(island, fieldHeight(t, x, z) * w) : island;
}

/** Water surface height relative to the terrain base. */
export const waterLevel = (t: TerrainT) => t.height * 0.12;

/** World parts give y as height above the ground; turn it into play-zone y. */
export function groundY(t: TerrainT, x: number, z: number) {
  return WORLD_BASE_Y + Math.max(terrainHeight(t, x, z), t.water ? waterLevel(t) : 0);
}

/** True if (x, z) is dry land (not under water). */
export function isDry(t: TerrainT, x: number, z: number, margin = 0.004) {
  return !t.water || terrainHeight(t, x, z) > waterLevel(t) + margin;
}
