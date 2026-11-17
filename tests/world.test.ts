import { describe, expect, it } from 'vitest';
import { CHUNK, chunkOf, extractKit, placeArea, ringKeys, scatterChunk } from '../src/engine/chunks.js';
import { fieldHeight, groundY, isDry, terrainHeight, waterLevel, type TerrainT } from '../src/engine/terrain.js';
import { PRESETS } from '../src/spec/presets.js';
import { validateCreation } from '../src/spec/schema.js';
import { areaUser } from '../server/prompts/area.js';

const isle = validateCreation(PRESETS.volcanoIsle).creation!;
const terrain: TerrainT = { ...isle.terrain!, field: true };

describe('endless terrain', () => {
  it('leaves the conjured island untouched and extends land beyond it', () => {
    for (const [x, z] of [[0, 0], [0.1, -0.05], [-0.15, 0.1]]) {
      expect(terrainHeight(terrain, x, z)).toBeCloseTo(terrainHeight(isle.terrain!, x, z), 10);
    }
    // Far away there is some land and some sea, and it is deterministic.
    let land = 0, sea = 0;
    for (let i = 0; i < 400; i++) {
      const x = 1 + (i % 20) * 0.11, z = -1 - Math.floor(i / 20) * 0.11;
      if (isDry(terrain, x, z)) land++; else sea++;
      expect(terrainHeight(terrain, x, z)).toBe(terrainHeight({ ...terrain }, x, z));
    }
    expect(land).toBeGreaterThan(80);
    expect(sea).toBeGreaterThan(40);
  });

  it('is continuous (no cliffs at chunk edges)', () => {
    const edge = CHUNK / 2;
    for (let z = -2; z < 2; z += 0.05) {
      const a = terrainHeight(terrain, edge - 1e-4, z), b = terrainHeight(terrain, edge + 1e-4, z);
      expect(Math.abs(a - b)).toBeLessThan(0.002);
    }
    expect(fieldHeight(terrain, 3, 3)).toBeGreaterThanOrEqual(0);
    expect(groundY(terrain, 5, 5)).toBeGreaterThanOrEqual(groundY(terrain, 5, 5) - waterLevel(terrain));
  });
});

describe('chunks', () => {
  it('maps positions to chunks and orders rings nearest first', () => {
    expect(chunkOf(0, 0)).toEqual([0, 0]);
    expect(chunkOf(CHUNK * 0.6, -CHUNK * 1.4)).toEqual([1, -1]);
    const ring = ringKeys(0, 0, 1);
    expect(ring).toHaveLength(9);
    expect(ring[0].key).toBe('0,0');
  });

  it('extracts the world kit: palm trees and turtles, not the volcano, sun or cloud', () => {
    const kit = extractKit(isle);
    const names = kit.map((k) => k.name);
    expect(names.some((n) => /palm/i.test(n))).toBe(true);
    expect(names.some((n) => /turtle/i.test(n))).toBe(true);
    expect(names.some((n) => /volcano|sun|cloud/i.test(n))).toBe(false);
    const palm = kit.find((k) => /palm/i.test(k.name))!;
    expect(palm.parts[0].shape.kind).toBe('asset'); // realistic palm asset
  });

  it('scatters deterministically on dry land, away from the island', () => {
    const kit = extractKit(isle);
    const filled: [number, number][] = [];
    for (let ix = -3; ix <= 3; ix++) for (let iz = -3; iz <= 3; iz++) if (scatterChunk(kit, terrain, ix, iz, 'seed').length) filled.push([ix, iz]);
    expect(filled.length).toBeGreaterThan(20); // most of the land gets props (some chunks are open sea)
    const [[ax, az], [cx, cz]] = filled;
    const a = scatterChunk(kit, terrain, ax, az, 'seed');
    expect(a).toEqual(scatterChunk(kit, terrain, ax, az, 'seed'));
    const c = scatterChunk(kit, terrain, cx, cz, 'seed');
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
    for (const p of [...a, ...c]) {
      const [x, , z] = p.transform.pos;
      expect(Math.hypot(x, z)).toBeGreaterThan(terrain.radius);
      expect(p.react?.every((r) => !r.target) ?? true).toBe(true);
    }
    expect(new Set(a.map((p) => p.id)).size).toBe(a.length);
  });

  it('places a designed area at a spot and keeps reaction links inside it', () => {
    const parts = placeArea([
      { id: 'tower', shape: { kind: 'box', size: [0.05, 0.1, 0.05] }, transform: { pos: [0, 0, -0.06] }, verb: 'strike', react: [{ do: 'glow', target: 'bell' }] },
    ], [1.28, -0.64], 'a2_-1');
    expect(parts[0].id).toBe('a2_-1-tower');
    expect(parts[0].transform.pos[0]).toBeCloseTo(1.28);
    expect(parts[0].transform.pos[2]).toBeCloseTo(-0.64);
    expect(parts[0].react?.[0].target).toBe('a2_-1-bell');
  });

  it('describes the area to the model by direction, or by the wish', () => {
    const base = { world: { title: 'Volcano Isle', palette: isle.palette, style: isle.style, terrain: isle.terrain, ambient: isle.ambient }, kit: ['Palm crown'], neighbors: ['Tide Pools'] };
    expect(areaUser({ ...base, chunk: { x: 1, z: -2 } })).toMatch(/2 north, 1 east/);
    expect(areaUser({ ...base, chunk: { x: 0, z: 0 }, wish: 'a lighthouse' })).toMatch(/a lighthouse/);
  });
});
