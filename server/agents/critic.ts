/**
 * Critic: looks at a snapshot of the finished creation (multimodal), compares
 * it with the wish and the researched reference, and proposes edits that make
 * it more realistic. Runs after the user can already play, as a refinement.
 */
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { applyEdits } from '../../src/spec/edits.js';
import { Edit } from '../../src/spec/schema.js';
import { structuredModel } from '../llm/models.js';
import { CRITIC_SYSTEM } from '../prompts/critic.js';
import { formatCard } from '../research/reference.js';
import { emit, type NodeConfig, type State, type Update } from '../graph/state.js';

export const CriticOut = z.object({
  score: z.number().min(0).max(10),
  verdict: z.string().max(200),
  ops: z.array(Edit).max(10),
});

export async function critic(state: State, config: NodeConfig): Promise<Update> {
  emit(config, { type: 'stage', stage: 'critiquing', message: 'comparing with the real thing' });
  const spec = state.request.spec!;
  const t0 = Date.now();
  const text = [
    `Wish: "${state.request.text.slice(0, 300)}"`,
    state.reference ? `REFERENCE:\n${formatCard(state.reference)}` : 'No reference available: use your own knowledge of the real object.',
    `SPEC (sounds omitted):\n${JSON.stringify({ ...spec, parts: spec.parts.map(({ sound: _s, fx: _f, label: _l, ...p }) => p) })}`,
  ].join('\n\n');
  const content = state.image
    ? [{ type: 'text', text }, { type: 'image_url', image_url: { url: state.image } }]
    : text;

  const out = await structuredModel('critic', CriticOut, 'critique').invoke(
    [new SystemMessage(CRITIC_SYSTEM), new HumanMessage({ content } as ConstructorParameters<typeof HumanMessage>[0])],
    { signal: config.signal },
  );
  const ops = out.score >= 8 ? [] : out.ops;
  console.info(`[critic] score ${out.score}/10, ${ops.length} op(s) in ${Date.now() - t0}ms: ${out.verdict}`);
  emit(config, { type: 'critique', score: out.score, verdict: out.verdict, changes: ops.length });
  emit(config, { type: 'say', text: out.verdict });
  if (!ops.length) return { draft: null };
  const result = applyEdits(spec, ops);
  emit(config, { type: 'edit', ops });
  return { draft: result.spec };
}
