import { describe, expect, it } from 'vitest';
import { ScenePlan, solveScene, objectSize } from '../src/spec/scene.js';
import { validateCreation, assetDims } from '../src/spec/schema.js';
import { isDry } from '../src/engine/terrain.js';
import { coerceStory } from '../src/spec/story.js';

export const VILLAGE = ScenePlan.parse({
  title: 'Snowy Lake Village', palette: 'mono', style: 'clay',
  terrain: { style: 'island', size: 'medium', water: true },
  ambient: { particles: 'snow', light: 'dusk' },
  objects: [
    { id: 'well', label: 'Old well', asset: 'well', place: 'center' },
    { id: 'house', label: 'Cottage', asset: 'cottage', count: 4, place: 'around', target: 'well' },
    { id: 'elder', label: 'Village elder', asset: 'character', place: 'near', target: 'well' },
    { id: 'pines', label: 'Pine', asset: 'pine', count: 8, place: 'scattered', zone: 'north' },
    { id: 'mtn', label: 'Frost peak', asset: 'mountain', place: 'center', zone: 'north', size: 'large' },
    { id: 'boat', label: 'Boat', asset: 'boat', place: 'water' },
    { id: 'fox', label: 'Snow fox', asset: 'creature', count: 2, place: 'scattered' },
    { id: 'fire', label: 'Campfire', asset: 'campfire', place: 'in_front', target: 'well' },
  ],
  story: {
    title: 'The Frozen Bell', intro: 'Snow has fallen on the village for a hundred years.',
    chapters: [
      { title: 'The Well', goal: 'Wake the old well', hint: 'The well in the square remembers.', target: 'well', payoff: 'Water sings below. Something answers in the north.' },
      { title: 'The Peak', goal: 'Ring the ice bell', hint: 'Climb north.', target: 'Ice Bell', direction: 'NORTH', place: 'A frozen shrine with an ice bell', arrive: 'Wind howls around the shrine.', payoff: 'The bell rings and the snow sparkles.' },
    ],
    ending: 'Spring will come again. Keep exploring.',
  },
});

describe('layout solver (Holodeck-style)', () => {
  const solved = solveScene(VILLAGE, 'w-test');
  const w = solved.creation;
  const radius = (id: string) => {
    const p = w.parts.find((q) => q.id === id)!;
    return p.shape.kind === 'asset' ? assetDims(p.shape.type, p.shape.size).radius : 0.01;
  };

  it('produces a valid world with a spawn and real-world sizes', () => {
    expect(validateCreation(w).ok).toBe(true);
    expect(w.kind).toBe('world');
    expect(w.spawn).toBeDefined();
    expect(isDry(w.terrain!, w.spawn![0], w.spawn![1])).toBe(true);
    const elder = w.parts.find((p) => p.id === 'elder')!;
    expect(elder.shape.kind === 'asset' && elder.shape.size * 40).toBeCloseTo(1.75, 1); // a person is a person
    expect(w.parts.length).toBeGreaterThan(14);
  });

  it('is deterministic and keeps buildings from overlapping', () => {
    expect(solveScene(VILLAGE, 'w-test').creation).toEqual(w);
    const houses = w.parts.filter((p) => p.id.startsWith('house-'));
    expect(houses.length).toBeGreaterThanOrEqual(3);
    for (const a of houses) for (const b of houses) {
      if (a === b) continue;
      const d = Math.hypot(a.transform.pos[0] - b.transform.pos[0], a.transform.pos[2] - b.transform.pos[2]);
      expect(d).toBeGreaterThan(radius(a.id) * 0.9);
    }
  });

  it('honours relations: houses ring the well, the boat floats, land things stand on land', () => {
    const well = w.parts.find((p) => p.id === 'well')!;
    const near = w.parts.filter((p) => p.id.startsWith('house-'))
      .filter((h) => Math.hypot(h.transform.pos[0] - well.transform.pos[0], h.transform.pos[2] - well.transform.pos[2]) < 0.2);
    expect(near.length).toBeGreaterThanOrEqual(3);
    const boat = w.parts.find((p) => p.id === 'boat');
    if (boat) expect(isDry(w.terrain!, boat.transform.pos[0], boat.transform.pos[2], 0.002)).toBe(false);
    for (const p of w.parts.filter((q) => q.shape.kind === 'asset' && ['cottage', 'pine', 'character', 'well'].includes((q.shape as { type: string }).type))) {
      expect(isDry(w.terrain!, p.transform.pos[0], p.transform.pos[2], 0.004)).toBe(true);
    }
  });

  it('keeps the story that came with the plan, leniently', () => {
    expect(solved.story?.chapters[1].direction).toBe('north');
    expect(coerceStory({ title: 'x'.repeat(200), intro: 'hi', chapters: [], ending: 'e' })).toBeNull();
  });

  it('sizes landmarks to the world', () => {
    expect(objectSize({ asset: 'volcano', size: 'giant' }, 0.3).h).toBeLessThanOrEqual(0.3 * 0.75 + 1e-9);
  });
});
