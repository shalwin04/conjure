import { describe, expect, it } from 'vitest';
import { createZone, setZonePose, VerbEngine, TUNING, velocityCurve } from '../src/engine/verbs.js';
import type { Tip } from '../src/engine/tip.js';
import type { PartT } from '../src/spec/schema.js';
import { PRESETS } from '../src/spec/presets.js';
import { validateCreation } from '../src/spec/schema.js';

/** Column-major translation matrix and its inverse. */
const translate = (x: number, y: number, z: number) => [1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1];

const drum: PartT = {
  id: 'drum', shape: { kind: 'cylinder', radius: 0.1, height: 0.05 },
  transform: { pos: [0, 0, 0] }, verb: 'strike', sound: { voice: 'membrane' },
};

function tip(x: number, y: number, z: number, vx = 0, vy = 0, vz = 0): Tip {
  return { hand: 'right', joint: 'index-finger-tip', active: true, x, y, z, vx, vy, vz, radius: 0.009 };
}

function setup(part = drum, at: [number, number, number] = [0, 1, -0.4]) {
  const zone = createZone(part, 0);
  setZonePose(zone, translate(...at), translate(-at[0], -at[1], -at[2]));
  return { zone, engine: new VerbEngine() };
}

describe('strike', () => {
  it('fires when a fingertip comes down onto the drum', () => {
    const { zone, engine } = setup();
    engine.update([tip(0, 1.1, -0.4, 0, -1.5, 0)], [zone], 0);   // above: outside
    expect(engine.eventCount).toBe(0);
    engine.update([tip(0, 1.03, -0.4, 0, -1.5, 0)], [zone], 0.016); // enters approach margin
    expect(engine.eventCount).toBe(1);
    expect(engine.events[0].kind).toBe('hit');
    expect(engine.events[0].velocity).toBeGreaterThan(0.5);
  });

  it('ignores a slow touch and sideways swipes', () => {
    const { zone, engine } = setup();
    engine.update([tip(0, 1.1, -0.4, 0, -0.05, 0)], [zone], 0);
    engine.update([tip(0, 1.02, -0.4, 0, -0.05, 0)], [zone], 0.016);
    expect(engine.eventCount).toBe(0);

    const s = setup();
    s.engine.update([tip(0.3, 1.01, -0.4, -2, 0, 0)], [s.zone], 0);
    s.engine.update([tip(0.1, 1.01, -0.4, -2, 0, 0)], [s.zone], 0.016);
    expect(s.engine.eventCount).toBe(0);
  });

  it('does not re-trigger while the finger rests on the drum', () => {
    const { zone, engine } = setup();
    engine.update([tip(0, 1.1, -0.4, 0, -1.5, 0)], [zone], 0);
    engine.update([tip(0, 1.02, -0.4, 0, -1.5, 0)], [zone], 0.016);
    engine.update([tip(0, 1.02, -0.4, 0, -1.5, 0)], [zone], 0.2);
    expect(engine.eventCount).toBe(0);
  });

  it('respects the cooldown for two fingers landing together', () => {
    const { zone, engine } = setup();
    engine.update([tip(0, 1.1, -0.4), tip(0.02, 1.1, -0.4)], [zone], 0);
    engine.update([tip(0, 1.02, -0.4, 0, -2, 0), tip(0.02, 1.02, -0.4, 0, -2, 0)], [zone], 0.016);
    expect(engine.eventCount).toBe(1);
  });

  it('hits a sphere from any side', () => {
    const ball: PartT = { ...drum, id: 'ball', shape: { kind: 'sphere', radius: 0.05 } };
    const { zone, engine } = setup(ball);
    engine.update([tip(0.2, 1, -0.4)], [zone], 0);
    engine.update([tip(0.06, 1, -0.4, -1.5, 0, 0)], [zone], 0.016);
    expect(engine.eventCount).toBe(1);
  });
});

describe('press', () => {
  it('emits down then up', () => {
    const key: PartT = { ...drum, id: 'key', verb: 'press', shape: { kind: 'box', size: [0.02, 0.01, 0.08] } };
    const { zone, engine } = setup(key);
    engine.update([tip(0, 1.1, -0.4)], [zone], 0);
    engine.update([tip(0, 1.01, -0.4, 0, -0.1, 0)], [zone], 0.1);
    expect(engine.eventCount).toBe(1);
    expect(engine.events[0].kind).toBe('down');
    engine.update([tip(0, 1.2, -0.4)], [zone], 0.3);
    expect(engine.events[0].kind).toBe('up');
  });
});

describe('velocity curve', () => {
  it('never goes below the audible floor or above 1', () => {
    expect(velocityCurve(TUNING.minStrikeSpeed)).toBeCloseTo(TUNING.velocityFloor);
    expect(velocityCurve(100)).toBe(1);
  });
});

describe('spec validation', () => {
  it('accepts every preset unchanged', () => {
    for (const [name, preset] of Object.entries(PRESETS)) {
      const r = validateCreation(structuredClone(preset));
      expect(r.ok, name).toBe(true);
      expect(r.fixes, name).toEqual([]);
    }
  });

  it('clamps parts into the play zone and adds missing sounds', () => {
    const r = validateCreation({
      id: 'x', title: 'Test', palette: 'mono', style: 'clay',
      parts: [{ id: 'far', shape: { kind: 'sphere', radius: 2 }, transform: { pos: [5, 0, 0] }, verb: 'strike' }],
    });
    expect(r.ok).toBe(true);
    const p = r.creation!.parts[0];
    expect(p.transform.pos[0]).toBeLessThanOrEqual(0.32);
    expect(p.shape.kind === 'sphere' && p.shape.radius).toBeLessThanOrEqual(0.64);
    expect(p.sound).toBeDefined();
    expect(r.fixes.length).toBe(3);
  });

  it('rejects malformed specs with readable errors', () => {
    const r = validateCreation({ id: 'x', title: 'Bad', palette: 'neon-pink', style: 'clay', parts: [] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/palette/);
  });
});

import { playtest, playtestPassed } from '../src/engine/playtest.js';
import { applyEdits } from '../src/spec/edits.js';

describe('playtest', () => {
  it('passes every preset', () => {
    for (const [name, preset] of Object.entries(PRESETS)) {
      const results = playtest(validateCreation(structuredClone(preset)).creation!);
      const failures = results.filter((r) => !r.ok);
      expect(failures, `${name}: ${JSON.stringify(failures)}`).toEqual([]);
    }
  });

  it('flags a part hidden under another', () => {
    const spec = validateCreation({
      id: 't', title: 'Stack', palette: 'mono', style: 'clay',
      parts: [
        { id: 'low', shape: { kind: 'cylinder', radius: 0.08, height: 0.04 }, transform: { pos: [0, 0, 0] }, verb: 'strike', sound: { voice: 'membrane' } },
        { id: 'lid', shape: { kind: 'cylinder', radius: 0.1, height: 0.01 }, transform: { pos: [0, 0.05, 0] }, verb: 'strike', sound: { voice: 'metal' } },
      ],
    }).creation!;
    const results = playtest(spec);
    expect(playtestPassed(results)).toBe(false);
    expect(results[0].issues.join(' ')).toMatch(/lid/);
  });
});

describe('edits', () => {
  const base = () => validateCreation(structuredClone(PRESETS.drums)).creation!;
  it('updates, adds and removes parts', () => {
    const { spec, applied, issues } = applyEdits(base(), [
      { op: 'update', id: 'snare', patch: { material: { color: 'accentRed', glow: 0.8 } } },
      { op: 'add', part: { id: 'cowbell', shape: { kind: 'cone', radius: 0.04, height: 0.08 }, transform: { pos: [0.12, 0.06, 0.1] }, verb: 'strike', sound: { voice: 'bell', pitch: 800 } } },
      { op: 'remove', id: 'crash' },
      { op: 'set', field: 'palette', value: 'ember' },
    ]);
    expect(applied).toBe(4);
    expect(issues).toEqual([]);
    expect(spec.parts.find((p) => p.id === 'snare')!.material!.color).toBe('accentRed');
    expect(spec.parts.find((p) => p.id === 'snare')!.transform.pos).toEqual(base().parts[1].transform.pos);
    expect(spec.parts.some((p) => p.id === 'crash')).toBe(false);
    expect(spec.palette).toBe('ember');
  });
  it('refuses to delete everything', () => {
    const b = base();
    const r = applyEdits(b, b.parts.map((p) => ({ op: 'remove' as const, id: p.id })));
    expect(r.spec.parts.length).toBe(b.parts.length);
  });
});

import { expandParts, parsePartLine } from '../src/spec/schema.js';
import { scaleNote } from '../src/spec/music.js';

describe('repeat shortcut', () => {
  it('expands a row of bars tuned up the scale', () => {
    const { parts, errors } = parsePartLine({
      id: 'bar', shape: { kind: 'box', size: [0.055, 0.02, 0.16] }, transform: { pos: [-0.245, 0, 0] },
      verb: 'strike', sound: { voice: 'bell' }, repeat: { count: 8, step: [0.07, 0, 0], scale: 'major', root: 'C5', shrink: 0.96 },
    });
    expect(errors).toEqual([]);
    expect(parts.map((p) => p.sound?.pitch)).toEqual(['C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5', 'C6']);
    expect(parts[7].transform.pos[0]).toBeCloseTo(0.245);
    expect(parts[1].id).toBe('bar-2');
    // and the expanded row passes the playtest
    const spec = validateCreation({ id: 'x', title: 'X', palette: 'mono', style: 'glass', parts }).creation!;
    expect(playtestPassed(playtest(spec))).toBe(true);
  });
  it('wraps octaves and caps at the part limit', () => {
    expect(scaleNote('C4', 'pentatonic', 5)).toBe('C5');
    const many = expandParts([{ id: 'k', shape: { kind: 'sphere', radius: 0.02 }, transform: { pos: [0, 0, 0] }, verb: 'strike', repeat: { count: 16, step: [0.01, 0, 0] } },
      { id: 'j', shape: { kind: 'sphere', radius: 0.02 }, transform: { pos: [0, 0.1, 0] }, verb: 'strike', repeat: { count: 16, step: [0.01, 0, 0] } }]);
    expect(many.length).toBe(32); // under the 48-part limit (worlds need more parts)
  });
});

describe('organic shapes', () => {
  it('the jellyfish blueprint expands and every part is playable from some side', () => {
    const r = validateCreation(structuredClone(PRESETS.jellyfish));
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(r.creation!.parts.length).toBe(15); // bell + 4 arms + 10 tentacles
    const failures = playtest(r.creation!).filter((x) => !x.ok);
    expect(failures, JSON.stringify(failures)).toEqual([]);
  });
  it('radial repeat rings copies around the centre, tuned and phased', () => {
    const { parts } = parsePartLine({
      id: 't', shape: { kind: 'tube', length: 0.2, radius: 0.006 }, transform: { pos: [0, 0.2, 0] }, verb: 'strike',
      sound: { voice: 'bell' }, motion: { type: 'sway' },
      repeat: { mode: 'radial', count: 4, radius: 0.1, scale: 'major', root: 'C5' },
    });
    const want = [[0, 0.2, 0.1], [0.1, 0.2, 0], [0, 0.2, -0.1], [-0.1, 0.2, 0]];
    parts.forEach((p, i) => p.transform.pos.forEach((v, j) => expect(v).toBeCloseTo(want[i][j], 5)));
    expect(parts[1].motion!.phase).toBeCloseTo(0.7);
  });
  it('clamps organic shape parameters', () => {
    const { parts } = parsePartLine({ id: 'b', shape: { kind: 'blob', radius: 0.05, lumps: 5, squash: 9 }, transform: { pos: [0, 0, 0] }, verb: 'none' });
    expect(parts[0].shape).toMatchObject({ lumps: 1, squash: 2 });
  });
});

import { groundY, terrainHeight } from '../src/engine/terrain.js';
import { resolvePos } from '../src/engine/transform.js';

describe('worlds', () => {
  it('the volcano isle blueprint validates as a world and every part is playable', () => {
    const r = validateCreation(structuredClone(PRESETS.volcanoIsle));
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    const w = r.creation!;
    expect(w.kind).toBe('world');
    expect(w.parts.find((p) => p.id === 'palm-2')).toBeDefined();
    const failures = playtest(w).filter((x) => !x.ok);
    expect(failures, JSON.stringify(failures)).toEqual([]);
  });
  it('places world parts relative to the ground', () => {
    const w = validateCreation(structuredClone(PRESETS.volcanoIsle)).creation!;
    const volcano = w.parts.find((p) => p.id === 'volcano')!;
    const [, y] = resolvePos(w, volcano);
    expect(y).toBeCloseTo(groundY(w.terrain!, 0.03, -0.07), 5);
    expect(terrainHeight(w.terrain!, 0, 0)).toBeGreaterThan(terrainHeight(w.terrain!, 0.18, 0));
    expect(terrainHeight(w.terrain!, 0.3, 0)).toBe(0);
  });
  it('a world without terrain gets an island', () => {
    const r = validateCreation({ id: 'w', kind: 'world', title: 'W', palette: 'forest', style: 'organic', parts: [{ id: 'a', shape: { kind: 'sphere', radius: 0.03 }, transform: { pos: [0, 0.05, 0] }, verb: 'strike', sound: { voice: 'bell' } }] });
    expect(r.creation!.terrain?.style).toBe('island');
  });
});
