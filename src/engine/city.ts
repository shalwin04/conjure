/**
 * Procedural city blocks (roads → lots → buildings → street furniture), the
 * classic procedural-city pipeline, kept tiny: one block per chunk, streets
 * along the chunk edges, 3×3 lots per block with a little park in the middle.
 * Deterministic for (seed, chunk), like every other piece of the endless world.
 */
import type { PartT } from '../spec/schema.js';
import { valueNoise, type TerrainT } from './terrain.js';
import { CHUNK, chunkCenter, hashString, rng } from './chunks.js';

/** Street width in world units (≈ 5.6 m at the immersive scale), sidewalks included. */
export const ROAD = 0.14;
const LOT = (CHUNK - ROAD) / 3;

/** Distance from (x, z) to the nearest street centre line. */
export function roadDistance(x: number, z: number) {
  const dx = Math.abs(((x / CHUNK + 0.5) % 1 + 1) % 1 - 0) * CHUNK;
  const ex = Math.min(dx, CHUNK - dx);
  const dz = Math.abs(((z / CHUNK + 0.5) % 1 + 1) % 1) * CHUNK;
  const ez = Math.min(dz, CHUNK - dz);
  return Math.min(ex, ez);
}

export const onRoad = (x: number, z: number, margin = 0) => roadDistance(x, z) < ROAD / 2 + margin;

/** Yaw (degrees) that turns a front (+z) toward the nearest street. */
export function faceStreet(x: number, z: number) {
  const fx = ((x / CHUNK + 0.5) % 1 + 1) % 1 - 0.5; // -0.5..0.5 inside the block
  const fz = ((z / CHUNK + 0.5) % 1 + 1) % 1 - 0.5;
  if (Math.abs(fz) >= Math.abs(fx)) return fz > 0 ? 0 : 180;
  return fx > 0 ? 90 : -90;
}

const asset = (id: string, label: string, type: string, size: number, x: number, z: number, yaw: number, extra: Partial<PartT> = {}): PartT => ({
  id, label, shape: { kind: 'asset', type, size } as PartT['shape'], transform: { pos: [x, 0, z], rot: [0, yaw, 0] }, verb: 'strike', ...extra,
});

/** The parts of one city block (absolute world units; y = height above the ground). */
export function cityChunk(ix: number, iz: number, seed: string, terrain: TerrainT, density = 1): PartT[] {
  const rand = rng(hashString(`city:${seed}:${ix},${iz}`));
  const [cx, cz] = chunkCenter(ix, iz);
  const key = `${ix}_${iz}`;
  const out: PartT[] = [];
  const keepOut = terrain.radius * 1.05;
  // Downtown: tall towers cluster where this noise is high.
  const downtown = valueNoise(ix * 0.45 + 3, iz * 0.45 - 7, (terrain.seed ?? 1) + 11);
  const park = rand() < 0.18;

  for (let a = 0; a < 3; a++) {
    for (let b = 0; b < 3; b++) {
      const ox = (a - 1) * LOT, oz = (b - 1) * LOT;
      const x = cx + ox, z = cz + oz;
      if (Math.hypot(x, z) < keepOut) continue;
      const id = `${key}-lot${a}${b}`;
      if ((a === 1 && b === 1) || park) {
        // The middle of the block: a pocket park, a plaza or a market.
        const pick = rand();
        if (pick < 0.4) {
          out.push(asset(`${id}-tree`, 'Tree', rand() < 0.5 ? 'oak' : 'maple', 0.16 + rand() * 0.06, x + (rand() - 0.5) * 0.06, z + (rand() - 0.5) * 0.06, rand() * 360));
          out.push(asset(`${id}-bench`, 'Bench', 'bench', 0.024, x + 0.05, z + 0.05, rand() * 360));
        } else if (pick < 0.7) {
          out.push(asset(`${id}-fountain`, 'Fountain', 'fountain', 0.05, x, z, 0));
          out.push(asset(`${id}-bench`, 'Bench', 'bench', 0.024, x - 0.06, z, 90));
        } else {
          out.push(asset(`${id}-stall`, 'Market stall', 'stall', 0.06, x, z, faceStreet(x, z)));
          out.push(asset(`${id}-lamp`, 'Lantern', 'lantern', 0.08, x + 0.05, z - 0.04, 0));
        }
        continue;
      }
      if (rand() > 0.92 * Math.min(1, density + 0.1)) continue;
      const tall = downtown > 0.15 && rand() < 0.45 + downtown * 0.6;
      const yaw = faceStreet(x, z);
      if (tall) out.push(asset(`${id}-tower`, 'Tower', 'skyscraper', 0.5 + rand() * 0.14, x, z, yaw));
      else out.push(asset(`${id}-house`, 'Building', 'building', 0.24 + rand() * 0.12, x, z, yaw));
    }
  }

  // Street furniture along this chunk's west and north streets (each street is owned once).
  const wx = cx - CHUNK / 2, nz = cz - CHUNK / 2;
  const side = ROAD / 2 - 0.012;
  for (let k = 0; k < 3; k++) {
    const t = -CHUNK / 2 + (k + 0.5) * (CHUNK / 3);
    out.push(asset(`${key}-lw${k}`, 'Street lamp', 'streetlamp', 0.1, wx + side, cz + t, 90));
    out.push(asset(`${key}-ln${k}`, 'Street lamp', 'streetlamp', 0.1, cx + t, nz - side, 180));
  }
  for (let k = 0; k < 4; k++) {
    if (rand() < 0.45) continue;
    const along = -CHUNK / 2 + 0.1 + rand() * (CHUNK - 0.2);
    const lane = (rand() < 0.5 ? -1 : 1) * (ROAD / 2 - 0.04);
    if (k % 2) out.push(asset(`${key}-car${k}`, 'Car', 'car', 0.038, wx + lane, cz + along, lane > 0 ? 90 : -90));
    else out.push(asset(`${key}-car${k}`, 'Car', 'car', 0.038, cx + along, nz + lane, lane > 0 ? 0 : 180));
  }
  return out;
}
