import { describe, expect, it, vi } from 'vitest';
import { RunnableLambda } from '@langchain/core/runnables';

vi.mock('../server/research/search.js', () => ({
  groundedSearch: vi.fn(async () => ({
    text: 'Here you go: {"subject":"axolotl","summary":"A pink salamander with feathery external gills.","parts":[{"name":"gills","count":"6","shape":"feathery fronds"}],"proportions":["head is a third of the body"]}',
    sources: [{ url: 'https://en.wikipedia.org/wiki/Axolotl', title: 'Axolotl' }],
    grounded: true,
  })),
}));

vi.mock('../server/llm/models.js', () => ({
  isFixture: () => false,
  resolveRole: () => ({ provider: 'meta', model: 'muse-spark-1.2' }),
  describeModels: () => ({}),
  chatModel: () => { throw new Error('not used'); },
  toolModel: () => { throw new Error('not used'); },
  structuredModel: () => RunnableLambda.from(async () => ({
    score: 5,
    verdict: 'The bell is too small next to the tentacles.',
    ops: [{ op: 'update', id: 'bell', patch: { transform: { scale: 1.3 } } }],
  })),
}));

import { researcher, verify } from '../server/agents/researcher.js';
import { verifyCard, fromLibrary } from '../server/research/reference.js';
import { critiqueGraph } from '../server/graph/graph.js';
import { validateCreation } from '../src/spec/schema.js';
import { PRESETS } from '../src/spec/presets.js';

const collect = () => {
  const events: { type: string; [k: string]: unknown }[] = [];
  return { events, config: { writer: (e: unknown) => events.push(e as { type: string }) } as never };
};

describe('research', () => {
  it('uses the verified library for hero objects without a network call', async () => {
    const { config } = collect();
    const out = await researcher({ request: { text: 'a glowing jellyfish' } } as never, config);
    expect(out.referenceOrigin).toBe('library');
    expect(out.reference!.parts.some((p) => p.name === 'bell')).toBe(true);
  });

  it('parses a web-grounded answer into a card with sources, then verifies it', async () => {
    const { events, config } = collect();
    const state = { request: { text: 'a singing axolotl' } } as never;
    const out = await researcher(state, config);
    expect(out.referenceOrigin).toBe('web');
    expect(out.reference!.sources[0].url).toContain('Axolotl');
    const v = await verify({ ...(state as object), ...out } as never, config);
    expect(v.reference!.subject).toBe('axolotl');
    expect(events.find((e) => e.type === 'reference')).toMatchObject({ verified: true, origin: 'web' });
  });

  it('rejects a reference about something else', () => {
    const card = fromLibrary('drum kit')!;
    expect(verifyCard(card, 'a singing axolotl').ok).toBe(false);
    expect(verifyCard(card, 'a crystal drum kit').ok).toBe(true);
  });
});

describe('critic round', () => {
  it('applies realism edits, re-tests, and commits the next version', async () => {
    const spec = validateCreation(structuredClone(PRESETS.jellyfish)).creation!;
    const events: { type: string; [k: string]: unknown }[] = [];
    for await (const e of await critiqueGraph.stream(
      { request: { text: 'a jellyfish', spec }, startedAt: Date.now(), intent: 'edit', image: 'data:image/jpeg;base64,AAAA', reference: null, draft: null },
      { streamMode: 'custom' },
    )) events.push(e as { type: string });
    expect(events.find((e) => e.type === 'critique')).toMatchObject({ score: 5, changes: 1 });
    const commit = events.find((e) => e.type === 'commit') as { spec: { version: number; parts: { id: string; transform: { scale?: number } }[] } };
    expect(commit.spec.version).toBe(2);
    expect(commit.spec.parts.find((p) => p.id === 'bell')!.transform.scale).toBe(1.3);
  });
});
