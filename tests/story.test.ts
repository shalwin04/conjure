import { describe, expect, it } from 'vitest';
import { objectToWorld } from '../src/engine/chunks.js';
import { PRESETS } from '../src/spec/presets.js';
import { parsePartLine, validateCreation } from '../src/spec/schema.js';
import { coerceStory, fixStory, Story, storyRequestFor, templateStory } from '../src/spec/story.js';
import { isWorldWish } from '../server/prompts/catalogue.js';

const isle = validateCreation(PRESETS.volcanoIsle).creation!;

describe('worlds by default', () => {
  it('turns places and stories into worlds, keeps instruments as instruments', () => {
    expect(isWorldWish('an erupting volcano')).toBe(true);
    expect(isWorldWish('a sleepy fox village story')).toBe(true);
    expect(isWorldWish('a dragon')).toBe(true);
    expect(isWorldWish('a glass xylophone')).toBe(false);
    expect(isWorldWish('a drum kit')).toBe(false);
  });

  it('sets any object on a meadow so it can be entered', () => {
    const drums = validateCreation(PRESETS.drums).creation!;
    const w = objectToWorld(drums);
    expect(w.kind).toBe('world');
    expect(w.terrain).toBeDefined();
    expect(Math.min(...w.parts.map((p) => p.transform.pos[1]))).toBeGreaterThanOrEqual(0);
    expect(validateCreation(w).ok).toBe(true);
  });
});

describe('assets', () => {
  it('fills a sound, verb and reaction from the catalogue', () => {
    const { parts } = parsePartLine({ id: 'v', shape: { kind: 'asset', type: 'volcano', size: 0.18 }, transform: { pos: [0, 0, 0] }, verb: 'none' });
    expect(parts[0].verb).toBe('strike');
    expect(parts[0].sound?.voice).toBe('bass');
    expect(parts[0].react?.[0].do).toBe('erupt');
  });
});

describe('stories', () => {
  it('makes a playable template story whose first goal is a real part', () => {
    const req = storyRequestFor(isle);
    const story = templateStory(req);
    expect(Story.safeParse(story).success).toBe(true);
    expect(story.chapters[0].target).toBe('volcano');
    expect(story.chapters).toHaveLength(5);
    expect(story.chapters[0].kind).toBe('wake'); expect(story.chapters[4].kind).toBe('talk'); expect(new Set(story.chapters.slice(1, 4).map((c) => c.kind)).size).toBe(3);
    expect(story.chapters.slice(1, 4).every((c) => c.place && c.direction)).toBe(true);
    expect(story.chapters[4].place).toBeUndefined(); // the finale is back home
    expect(story.chapters[4].target).toBe('keeper');
  });

  it('repairs a model story that names a label instead of an id', () => {
    const req = storyRequestFor(isle);
    const raw = templateStory(req);
    raw.chapters[0].target = 'Island keeper';
    raw.chapters[1].direction = undefined;
    const fixed = fixStory(raw, req);
    expect(fixed.chapters[0].target).toBe('keeper');
    expect(fixed.chapters[1].direction).toBeDefined();
  });
});

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { withSystemInstruction } from '../server/llm/structured.js';
import { routeByRules } from '../server/agents/router.js';

describe('game scripts', () => {
  it('coerces a model game: kinds lower-cased, choose without options becomes wake, counts clamped', () => {
    const raw = {
      title: 'T', intro: 'i', ending: 'e',
      chapters: [
        { title: 'a', kind: 'WAKE', goal: 'g', hint: 'h', target: 'Island keeper', payoff: 'p' },
        { title: 'b', kind: 'collect', goal: 'g', hint: 'h', target: 'Star', count: 9, place: 'x', direction: 'East', payoff: 'p' },
        { title: 'c', kind: 'choose', goal: 'g', hint: 'h', target: 'x', place: 'y', payoff: 'p' },
        { title: 'd', kind: 'melody', goal: 'g', hint: 'h', target: 'Bells', place: 'z', payoff: 'p' },
        { title: 'e', kind: 'talk', goal: 'g', hint: 'h', target: 'keeper', payoff: 'p' },
      ],
    };
    const story = fixStory(coerceStory(raw)!, storyRequestFor(isle));
    expect(story.chapters.map((c) => c.kind)).toEqual(['wake', 'collect', 'wake', 'melody', 'talk']);
    expect(story.chapters[1].count).toBe(5);
    expect(story.chapters[1].direction).toBe('east');
    expect(story.chapters[0].target).toBe('keeper');
  });
});

describe('gemini-safe structured prompts', () => {
  it('folds the JSON instruction into the one leading system message', () => {
    const out = withSystemInstruction([new SystemMessage('You route.'), new HumanMessage('hi')], 'Reply in JSON.');
    expect(out).toHaveLength(2);
    expect(out[0].getType()).toBe('system');
    expect(String(out[0].content)).toMatch(/You route\.[\s\S]*Reply in JSON\./);
    expect(out.filter((m) => m.getType() === 'system')).toHaveLength(1);
  });

  it('routes a new noun phrase to create without asking the model', () => {
    expect(routeByRules('an erupting volcano', true)).toBe('create');
    expect(routeByRules('a snowy village with a frozen lake', true)).toBe('create');
    expect(routeByRules('make it red', true)).toBe('edit');
  });
});
