import { describe, expect, it } from 'vitest';
import { NdjsonParser } from '../server/agents/util.js';
import { routeByRules } from '../server/agents/router.js';
import { autofix } from '../server/agents/repairer.js';
import { fixtureEdit } from '../server/agents/editor.js';
import { afterPlaytest } from '../server/graph/graph.js';
import { parseChoice } from '../server/llm/models.js';
import { playtest, playtestPassed } from '../src/engine/playtest.js';
import { validateCreation } from '../src/spec/schema.js';
import { PRESETS } from '../src/spec/presets.js';

describe('NDJSON parser', () => {
  it('yields objects as lines complete, across chunk boundaries', () => {
    const p = new NdjsonParser();
    expect(p.push('```json\n{"type":"header","ti')).toEqual([]);
    expect(p.push('tle":"X"}\n{"type":"part","id":"a"}\n{"type"')).toEqual([{ type: 'header', title: 'X' }, { type: 'part', id: 'a' }]);
    expect(p.push(':"part","id":"b"}')).toEqual([]);
    expect(p.end()).toEqual([{ type: 'part', id: 'b' }]);
  });
  it('skips prose and records broken lines', () => {
    const p = new NdjsonParser();
    expect(p.push('Here you go!\n{"broken": \n')).toEqual([]);
    expect(p.bad.length).toBe(1);
  });
});

describe('router rules', () => {
  it('creates when nothing is on the table', () => expect(routeByRules('bigger', false)).toBe('create'));
  it('edits on change words', () => expect(routeByRules('make the snare red', true)).toBe('edit'));
  it('creates on build words', () => expect(routeByRules('build a harp', true)).toBe('create'));
  it('defers to the LLM when ambiguous', () => expect(routeByRules('what is this', true)).toBeNull());
});

describe('model config', () => {
  it('parses provider:model', () => {
    expect(parseChoice('meta:muse-spark-1.3')).toEqual({ provider: 'meta', model: 'muse-spark-1.3' });
    expect(parseChoice('meta')).toEqual({ provider: 'meta', model: 'muse-spark-1.2' });
    expect(parseChoice('gemini')?.provider).toBe('gemini');
    expect(() => parseChoice('openai:gpt')).toThrow();
  });
});

describe('repair routing and autofix', () => {
  const stacked = () => validateCreation({
    id: 't', title: 'Stack', palette: 'mono', style: 'clay',
    parts: [
      { id: 'low', shape: { kind: 'cylinder', radius: 0.08, height: 0.04 }, transform: { pos: [0, 0, 0] }, verb: 'strike', sound: { voice: 'membrane' } },
      { id: 'lid', shape: { kind: 'cylinder', radius: 0.1, height: 0.01 }, transform: { pos: [0, 0.05, 0] }, verb: 'strike', sound: { voice: 'metal' } },
    ],
  }).creation!;

  it('autofix separates covered parts', () => {
    const spec = stacked();
    expect(playtestPassed(playtest(spec))).toBe(false);
    expect(playtestPassed(playtest(autofix(spec)))).toBe(true);
  });

  it('goes to autofix in replay mode, commit when passing', () => {
    const base = { issues: [], repairRounds: 0 } as unknown as Parameters<typeof afterPlaytest>[0];
    expect(afterPlaytest(base)).toBe('commit');
    expect(afterPlaytest({ ...base, issues: ['x'] })).toBe('autofix');
  });
});

describe('fixture editor', () => {
  it('turns "bigger" into scale edits on the focus part', () => {
    const spec = validateCreation(structuredClone(PRESETS.drums)).creation!;
    const { ops } = fixtureEdit('make it bigger', spec, 'snare');
    expect(ops).toEqual([{ op: 'update', id: 'snare', patch: { transform: { scale: 1.25 } } }]);
  });
});

import { FakeListChatModel } from '@langchain/core/utils/testing';
import { HumanMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { invokeStructured, isUnsupportedFeatureError, parseJsonFromText, textStructured } from '../server/llm/structured.js';

describe('structured output fallback', () => {
  const Out = z.object({ intent: z.enum(['create', 'edit', 'chat']), reply: z.string().nullable() });

  it('parses JSON from fenced or chatty text', () => {
    expect(parseJsonFromText('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonFromText('here {"a":{"b":2}} done')).toEqual({ a: { b: 2 } });
  });

  it('recognises Meta\'s tool_choice rejection', () => {
    const err = Object.assign(new Error('400 only `"auto"` is supported for `tool_choice`.'), { status: 400 });
    expect(isUnsupportedFeatureError(err)).toBe(true);
    expect(isUnsupportedFeatureError(Object.assign(new Error('rate limited'), { status: 429 }))).toBe(false);
  });

  it('text mode validates and retries once on bad output', async () => {
    const model = new FakeListChatModel({ responses: ['{"intent":"maybe"}', '{"intent":"edit","reply":null}'] });
    const out = await textStructured(model, Out, 'route', [new HumanMessage('make it red')]);
    expect(out).toEqual({ intent: 'edit', reply: null });
  });

  it('downgrades to text mode when the provider rejects the structured mode', async () => {
    const model = new FakeListChatModel({ responses: ['{"intent":"create","reply":null}'] });
    // FakeListChatModel has no native structured output, so force a rejection.
    (model as unknown as { withStructuredOutput: () => unknown }).withStructuredOutput = () => ({
      invoke: async () => { throw Object.assign(new Error('only "auto" is supported for tool_choice'), { status: 400 }); },
    });
    const out = await invokeStructured('test:model', model, 'jsonSchema', Out, 'route', [new HumanMessage('build a harp')]);
    expect(out.intent).toBe('create');
  });
});

import { layoutGroups } from '../server/agents/planner.js';
import { isSimpleEdit } from '../server/agents/editor.js';

describe('planner layout', () => {
  const g = (id: string, x: string, y: string, z: string) => ({ id, label: id, idea: '', count: 1, verb: 'strike', voice: 'bell', x, y, z }) as Parameters<typeof layoutGroups>[0][number];
  it('maps coarse words to boxes inside the play zone', () => {
    const [a] = layoutGroups([g('Bell Dome', 'center', 'high', 'back')]);
    expect(a.id).toBe('bell-dome');
    expect(a.min[1]).toBeGreaterThan(0.1);
    expect(a.max[2]).toBeLessThan(0);
  });
  it('splits groups that asked for the same box', () => {
    const [a, b] = layoutGroups([g('a', 'full', 'low', 'front'), g('b', 'full', 'low', 'front')]);
    expect(a.max[0]).toBeCloseTo(b.min[0]);
    expect(a.max[0]).toBeLessThan(b.max[0]);
  });
});

describe('fast edits', () => {
  it('takes simple restyles, leaves structural edits to the model', () => {
    expect(isSimpleEdit('make the snare bigger and red')).toBe(true);
    expect(isSimpleEdit('glass style please')).toBe(true);
    expect(isSimpleEdit('add a cowbell')).toBe(false);
    expect(isSimpleEdit('make it sound higher')).toBe(false);
  });
});

import { blueprintFor } from '../src/spec/presets.js';
import { customisationOf } from '../server/agents/editor.js';

describe('blueprint fast path', () => {
  it('matches known subjects and extracts extra wishes', () => {
    expect(blueprintFor('a singing jellyfish')).toBe('jellyfish');
    expect(blueprintFor('build me a drum kit')).toBe('drums');
    expect(blueprintFor('a dragon')).toBeNull();
    expect(customisationOf('a singing jellyfish')).toBeNull();
    expect(customisationOf('a pink glowing jellyfish with 14 tentacles')).toBe('pink 14 tentacles');
  });
});

import { resolveRole, fallbackChoice } from '../server/llm/models.js';

describe('hybrid profile', () => {
  it('puts waiting-path roles on Gemini, judgment roles on Meta, each backing up the other', () => {
    const saved = { ...process.env };
    process.env.MODEL_API_KEY = 'x'; process.env.GOOGLE_API_KEY = 'y';
    delete process.env.LLM_PROFILE; delete process.env.LLM_DESIGNER; delete process.env.LLM_CRITIC; delete process.env.LLM_FALLBACK;
    expect(resolveRole('designer').provider).toBe('gemini');
    expect(resolveRole('researcher').provider).toBe('gemini');
    expect(resolveRole('critic').provider).toBe('meta');
    expect(resolveRole('editor').provider).toBe('gemini');
    expect(resolveRole('router').provider).toBe('gemini');
    expect(resolveRole('repairer').provider).toBe('meta');
    expect(fallbackChoice('designer')?.provider).toBe('meta');
    expect(fallbackChoice('critic')?.provider).toBe('gemini');
    process.env.LLM_DESIGNER = 'meta:muse-spark-1.2';
    expect(resolveRole('designer').provider).toBe('meta');
    process.env = saved;
  });
});
