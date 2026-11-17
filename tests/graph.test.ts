/** Runs the real agent graph with scripted models: planner -> 2 parallel builders -> assemble -> playtest -> commit. */
import { describe, expect, it, vi } from 'vitest';
import { RunnableLambda } from '@langchain/core/runnables';
import { AIMessageChunk } from '@langchain/core/messages';

const plan = {
  title: 'Singing Jellyfish', palette: 'lagoon', style: 'glass',
  groups: [
    { id: 'bell', label: 'Glowing bell', idea: 'a dome', count: 1, verb: 'strike', voice: 'pad', x: 'center', y: 'high', z: 'back' },
    { id: 'tentacles', label: 'Tentacles', idea: 'hanging capsules', count: 6, verb: 'strike', voice: 'bell', x: 'full', y: 'low', z: 'front' },
  ],
};
const builderOutput: Record<string, string> = {
  bell: '{"type":"part","id":"dome","shape":{"kind":"sphere","radius":0.09},"transform":{"pos":[0,0.28,-0.18]},"verb":"strike","sound":{"voice":"pad","pitch":"C4"}}\n',
  tentacles: '{"type":"part","id":"t","shape":{"kind":"capsule","radius":0.015,"length":0.06},"transform":{"pos":[-0.2,0,0.06]},"verb":"strike","sound":{"voice":"bell"},"repeat":{"count":6,"step":[0.08,0,0],"scale":"pentatonic","root":"C5"}}\n',
};

vi.mock('../server/llm/models.js', () => ({
  isFixture: () => false,
  describeModels: () => ({}),
  structuredModel: () => RunnableLambda.from(async () => plan),
  toolModel: () => { throw new Error('repairer should not run'); },
  chatModel: () => ({
    stream: async (messages: { content: unknown }[]) => {
      const user = String(messages[1].content);
      const id = /YOUR GROUP: id "([^"]+)"/.exec(user)![1];
      const text = builderOutput[id];
      return (async function* () {
        // stream in two pieces to exercise the NDJSON parser
        yield new AIMessageChunk(text.slice(0, 40));
        await new Promise((r) => setTimeout(r, id === 'bell' ? 30 : 5));
        yield new AIMessageChunk(text.slice(40));
      })();
    },
  }),
}));

describe('agent graph (split design)', () => {
  it('plans, builds groups in parallel, and commits a playable creation', async () => {
    process.env.DESIGN_MODE = 'split';
    const { conjureGraph } = await import('../server/graph/graph.js');
    const events: { type: string; [k: string]: unknown }[] = [];
    for await (const e of await conjureGraph.stream(
      { request: { text: 'a jellyfish that sings when I touch its tentacles' }, startedAt: Date.now() },
      { streamMode: 'custom' },
    )) events.push(e as { type: string });

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('stage');
    const planEvent = events.find((e) => e.type === 'plan') as { groups: { id: string }[] };
    expect(planEvent.groups.map((g) => g.id)).toEqual(['bell', 'tentacles']);
    expect(events.filter((e) => e.type === 'part').length).toBe(7);
    const commit = events.find((e) => e.type === 'commit') as { spec: { parts: { id: string }[] }; repairs: number };
    expect(commit).toBeDefined();
    // assembled in plan order even though tentacles finished first
    expect(commit.spec.parts[0].id).toBe('bell-dome');
    expect(commit.spec.parts.slice(1).every((p) => p.id.startsWith('tentacles-'))).toBe(true);
    expect(types.at(-1)).toBe('stage');
    delete process.env.DESIGN_MODE;
  });
});
