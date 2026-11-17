/**
 * Builder: fills in ONE planned group inside its box, streaming NDJSON part
 * lines. Builders for different groups run in parallel (LangGraph Send), so a
 * creation takes about as long as its slowest group, not the sum of them.
 */
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { parsePartLine, type PartT } from '../../src/spec/schema.js';
import { chatModel } from '../llm/models.js';
import { BUILDER_SYSTEM, builderUser } from '../prompts/builder.js';
import { emit, type NodeConfig, type State, type Update } from '../graph/state.js';
import type { PlanGroupT } from './planner.js';
import { chunkText, NdjsonParser } from './util.js';

export async function builder(state: State & { group: PlanGroupT }, config: NodeConfig): Promise<Update> {
  const g = state.group;
  const plan = state.plan!;
  const t0 = Date.now();
  const parts: PartT[] = [];
  const parser = new NdjsonParser();
  let first = -1;

  const accept = (obj: unknown) => {
    if (!obj || typeof obj !== 'object') return;
    const { type: _t, ...raw } = obj as Record<string, unknown>;
    if (_t === 'header') return;
    const { parts: expanded } = parsePartLine(raw);
    for (const part of expanded) {
      if (parts.length >= 16) return;
      if (!part.id.startsWith(`${g.id}-`) && part.id !== g.id) part.id = `${g.id}-${part.id}`;
      if (parts.some((p) => p.id === part.id)) part.id = `${part.id}-${parts.length}`;
      parts.push(part);
      emit(config, { type: 'part', part, index: parts.length - 1 });
    }
  };

  const others = plan.groups.filter((o) => o.id !== g.id);
  const stream = await chatModel('builder').stream(
    [new SystemMessage(BUILDER_SYSTEM), new HumanMessage(builderUser(state.request.text, plan, g, others))],
    { signal: config.signal },
  );
  for await (const chunk of stream) {
    const text = chunkText(chunk);
    if (text && first < 0) first = Date.now() - t0;
    for (const obj of parser.push(text)) accept(obj);
  }
  for (const obj of parser.end()) accept(obj);
  console.info(`[builder:${g.id}] ${parts.length} parts, first text ${first}ms, done ${Date.now() - t0}ms`);
  return { builtParts: parts };
}

/** Join point after all builders: order parts by plan group and make the draft. */
export async function assemble(state: State, _config: NodeConfig): Promise<Update> {
  const plan = state.plan!;
  const order = new Map(plan.groups.map((g) => [g.id, g.order]));
  const groupOf = (id: string) => plan.groups.find((g) => id === g.id || id.startsWith(`${g.id}-`))?.id ?? '';
  const parts = [...state.builtParts].sort((a, b) => (order.get(groupOf(a.id)) ?? 99) - (order.get(groupOf(b.id)) ?? 99));
  if (!parts.length) throw new Error('The builders did not produce any playable parts. Try describing it differently.');
  return {
    draft: {
      id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      version: 1, title: plan.title, palette: plan.palette, style: plan.style,
      narration: plan.groups.map((g) => g.label), parts,
    },
  };
}
