/**
 * Router: decides create / edit / chat. Rules handle the obvious cases for free;
 * the LLM is only asked when the request is ambiguous.
 */
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { isFixture, structuredModel } from '../llm/models.js';
import { ROUTER_SYSTEM, routerUser } from '../prompts/router.js';
import { emit, type Intent, type NodeConfig, type State, type Update } from '../graph/state.js';

const CREATE = /\b(build|create|conjure|summon|make me|give me|i want|new|surprise me)\b/i;
const EDIT = /\b(bigger|smaller|larger|louder|quieter|softer|brighter|darker|add|remove|delete|change|turn|move|colou?r|glow|swap|replace|more|less|make (it|that|this|the|them|everything|all))\b/i;

const RouterOut = z.object({
  intent: z.enum(['create', 'edit', 'chat']),
  targetPartId: z.string().nullable(),
  reply: z.string().max(160).nullable(),
});

/** "an erupting volcano", "a snowy village": a new thing, not a change to this one. */
const NEW_THING = /^\s*(a|an|some|another)\s+\S/i;
const REFERS_BACK = /\b(it|its|that|this|them|these|those)\b/i;

export function routeByRules(text: string, hasCreation: boolean): Intent | null {
  if (!hasCreation) return 'create';
  const c = CREATE.test(text), e = EDIT.test(text);
  if (c && !e) return 'create';
  if (e && !c) return 'edit';
  if (!e && NEW_THING.test(text) && !REFERS_BACK.test(text)) return 'create';
  return null;
}

export async function router(state: State, config: NodeConfig): Promise<Update> {
  emit(config, { type: 'stage', stage: 'routing' });
  const { text, spec, focusPartId } = state.request;
  const ruled = routeByRules(text, Boolean(spec?.parts?.length));
  if (ruled) return { intent: ruled, targetPartId: focusPartId ?? null };

  if (isFixture('router')) {
    return { intent: /\b(build|make|create)\b/i.test(text) ? 'create' : 'edit', targetPartId: focusPartId ?? null, source: 'fixture' };
  }
  const t0 = Date.now();
  try {
    // Routing must be quick: if the model is slow or failing, guess instead of making the user wait.
    const signal = AbortSignal.any([config.signal ?? new AbortController().signal, AbortSignal.timeout(12_000)]);
    const out = await structuredModel('router', RouterOut, 'route_request').invoke(
      [new SystemMessage(ROUTER_SYSTEM), new HumanMessage(routerUser(text, spec?.parts.map((p) => p.id) ?? []))],
      { signal },
    );
    console.info(`[router] LLM routed to ${out.intent} in ${Date.now() - t0}ms`);
    return { intent: out.intent, targetPartId: out.targetPartId ?? focusPartId ?? null, reply: out.reply };
  } catch (err) {
    if (config.signal?.aborted) throw err;
    const intent: Intent = EDIT.test(text) || REFERS_BACK.test(text) ? 'edit' : 'create';
    console.warn(`[router] LLM failed after ${Date.now() - t0}ms (${err instanceof Error ? err.message.slice(0, 100) : err}); guessing ${intent}`);
    return { intent, targetPartId: focusPartId ?? null };
  }
}
