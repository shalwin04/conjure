import { describe, expect, it } from 'vitest';
import { ScenePlan, solveScene } from '../src/spec/scene.js';
import { validateCreation } from '../src/spec/schema.js';
import { coerceStory, templateStory } from '../src/spec/story.js';
import { guessTrack, trackDistance, trackLoop, TRACK_WIDTH } from '../src/engine/track.js';

const RACE = ScenePlan.parse({
  title: 'Silverstone Under the Stars', palette: 'dusk', style: 'clay',
  terrain: { style: 'island', size: 'large', water: true, biome: 'meadow', track: 'circuit' },
  ambient: { light: 'night' },
  objects: [
    { id: 'grid', label: 'Race car', asset: 'racecar', count: 6, place: 'on_track' },
    { id: 'lights', label: 'Start lights', asset: 'gantry', place: 'on_track' },
    { id: 'stands', label: 'Grandstand', asset: 'grandstand', count: 3, place: 'trackside' },
    { id: 'flood', label: 'Floodlight', asset: 'floodlight', count: 6, place: 'trackside' },
    { id: 'pits', label: 'Pit garage', asset: 'garage', count: 2, place: 'trackside' },
    { id: 'podium', label: 'Podium', asset: 'statue', place: 'center' },
    { id: 'chief', label: 'Race marshal', asset: 'character', place: 'near', target: 'podium' },
  ],
});

describe('race tracks', () => {
  it('guesses racing wishes', () => {
    expect(guessTrack('silverstone circuit formula 1 at night')).toBe('circuit');
    expect(guessTrack('a nascar speedway')).toBe('oval');
    expect(guessTrack('a quiet village')).toBeNull();
  });

  const { creation: w } = solveScene(RACE, 'w-race');
  const loop = trackLoop(w.terrain!)!;

  it('builds a valid world with a track and lands you on the grid', () => {
    expect(validateCreation(w).ok).toBe(true);
    expect(w.terrain!.track).toBe('circuit');
    expect(trackDistance(loop, w.spawn![0], w.spawn![1])).toBeLessThan(TRACK_WIDTH / 2);
  });

  it('puts cars on the track and stands beside it', () => {
    const of = (t: string) => w.parts.filter((p) => p.shape.kind === 'asset' && p.shape.type === t);
    expect(of('racecar').length).toBeGreaterThanOrEqual(4);
    for (const p of of('racecar')) expect(trackDistance(loop, p.transform.pos[0], p.transform.pos[2])).toBeLessThan(TRACK_WIDTH / 2);
    for (const p of [...of('grandstand'), ...of('floodlight'), ...of('statue')]) expect(trackDistance(loop, p.transform.pos[0], p.transform.pos[2])).toBeGreaterThan(TRACK_WIDTH / 2);
  });
});

describe('stories', () => {
  it('repairs a model story with nulls and missing lines', () => {
    const s = coerceStory({
      title: 'Lights Out at Silverstone', intro: null, ending: 'The engines purr goodnight.',
      chapters: [
        { title: 'Wake the marshal', kind: 'talk', goal: 'Say hello', hint: null, target: 'chief', payoff: 'Off you go!', speaker: null, place: null },
        { title: 'Lap of Honour', kind: 'Race', goal: 'Drive through the gates', target: 'Checkpoint', count: 4, place: null, payoff: null },
        { title: 'Lost Wheel Nuts', kind: 'collect', goal: 'Find them', target: 'Wheel nut', count: 3, item: 'tyres', direction: 'North', place: 'The pit lane', arrive: null },
        { title: 'Hide and seek', kind: 'seek', goal: 'Find Pip', target: 'Pip', place: 'The paddock', direction: 'west' },
        { title: 'Podium', kind: 'wake', goal: 'Ring the podium bell', target: 'podium', payoff: 'Hooray!' },
      ],
    });
    expect(s).not.toBeNull();
    expect(s!.chapters.map((c) => c.kind)).toEqual(['talk', 'gates', 'collect', 'seek', 'wake']);
    expect(s!.chapters[2].item).toBe('tyres');
  });

  it('template stories vary from world to world', () => {
    const req = (title: string) => ({ world: { title, palette: 'dusk' as const, style: 'clay' as const }, parts: [{ id: 'well', label: 'Well', kind: 'well' }] });
    const kinds = new Set(['A', 'Bee Town', 'Crystal Bay', 'Duneholm', 'Ember Isle'].map((t) => templateStory(req(t)).chapters.slice(1, 4).map((c) => c.kind).join(',')));
    expect(kinds.size).toBeGreaterThan(1);
  });
});
