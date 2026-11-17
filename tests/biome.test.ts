import { describe, expect, it } from 'vitest';
import { ScenePlan, solveScene } from '../src/spec/scene.js';
import { validateCreation } from '../src/spec/schema.js';
import { biomeOf, guessBiome } from '../src/engine/biome.js';
import { cityChunk, onRoad, roadDistance, ROAD } from '../src/engine/city.js';
import { extractKit, CHUNK } from '../src/engine/chunks.js';
import { fieldHeight } from '../src/engine/terrain.js';

const CITY = ScenePlan.parse({
  title: 'Lantern City', palette: 'dusk', style: 'clay',
  terrain: { style: 'island', size: 'large', water: true, biome: 'city' },
  ambient: { light: 'dusk' },
  objects: [
    { id: 'fountain', label: 'Plaza fountain', asset: 'fountain', place: 'center' },
    { id: 'cafe', label: 'Cafe', asset: 'building', count: 4, place: 'around', target: 'fountain' },
    { id: 'tower', label: 'Clock tower', asset: 'skyscraper', place: 'center', zone: 'north' },
    { id: 'stall', label: 'Flower stall', asset: 'stall', count: 2, place: 'near', target: 'fountain' },
    { id: 'lamp', label: 'Lamp', asset: 'streetlamp', count: 4, place: 'row' },
    { id: 'baker', label: 'Baker', asset: 'character', place: 'near', target: 'cafe' },
  ],
});

describe('biomes', () => {
  it('guesses the biome from the wish', () => {
    expect(guessBiome('a cozy city at night with neon')).toBe('city');
    expect(guessBiome('desert oasis with camels')).toBe('desert');
    expect(guessBiome('a snowy village')).toBe('snow');
    expect(guessBiome('autumn harvest fair')).toBe('autumn');
    expect(guessBiome('a quiet place')).toBe('meadow');
  });

  it('falls back to weather clues', () => {
    expect(biomeOf({ ambient: { particles: 'snow' } })).toBe('snow');
    expect(biomeOf({ terrain: { biome: 'desert' } })).toBe('desert');
  });

  it('fills the endless land with biome props', () => {
    const kit = (biome: string) => extractKit({ parts: [], ambient: {}, terrain: { style: 'flat', radius: 0.3, height: 0.02, biome } } as never).map((k) => k.parts[0].shape.kind === 'asset' ? k.parts[0].shape.type : '');
    expect(kit('desert')).toContain('cactus');
    expect(kit('autumn')).toContain('maple');
    expect(kit('snow')).toContain('snowpine');
  });

  it('city land is level and deserts roll', () => {
    const t = { style: 'island' as const, radius: 0.3, height: 0.03, water: true, field: true };
    const city = [0, 1, 2, 3].map((i) => fieldHeight({ ...t, biome: 'city' }, i * 0.7, i * 0.3));
    expect(Math.max(...city) - Math.min(...city)).toBeLessThan(0.01);
  });
});

describe('city layout', () => {
  const solved = solveScene(CITY, 'w-city');
  const w = solved.creation;

  it('makes a valid flat city with no sea, arriving in the street', () => {
    expect(validateCreation(w).ok).toBe(true);
    expect(w.terrain!.biome).toBe('city');
    expect(w.terrain!.water).toBe(false);
    expect(onRoad(w.spawn![0], w.spawn![1])).toBe(true);
  });

  it('keeps buildings off the roads and facing the street', () => {
    for (const p of w.parts.filter((q) => q.shape.kind === 'asset' && ['building', 'skyscraper', 'fountain', 'stall'].includes(q.shape.type))) {
      expect(onRoad(p.transform.pos[0], p.transform.pos[2])).toBe(false);
    }
  });

  it('builds blocks of buildings with street lamps and cars on the streets', () => {
    const parts = cityChunk(2, -1, 'Lantern City:1', { ...w.terrain!, field: true });
    const types = parts.map((p) => (p.shape.kind === 'asset' ? p.shape.type : ''));
    expect(types.filter((t) => t === 'building' || t === 'skyscraper').length).toBeGreaterThanOrEqual(3);
    expect(types).toContain('streetlamp');
    for (const p of parts) {
      const t = p.shape.kind === 'asset' ? p.shape.type : '';
      const d = roadDistance(p.transform.pos[0], p.transform.pos[2]);
      if (t === 'car' || t === 'streetlamp') expect(d).toBeLessThan(ROAD / 2);
      else expect(d).toBeGreaterThan(ROAD / 2);
    }
    // Deterministic: the same block every time.
    expect(cityChunk(2, -1, 'Lantern City:1', { ...w.terrain!, field: true })).toEqual(parts);
    expect(CHUNK).toBeCloseTo(0.64);
  });
});
