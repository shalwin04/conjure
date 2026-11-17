/**
 * Repairer: a tool-using agent that fixes parts the playtest flagged.
 * Bounded: a few tool rounds per call, and the graph allows two calls.
 * autofix() is the no-LLM fallback used in replay mode or after the budget.
 */
import { HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { playtest } from '../../src/engine/playtest.js';
import { applyEdits } from '../../src/spec/edits.js';
import { Edit, type CreationT, type EditT } from '../../src/spec/schema.js';
import { toolModel } from '../llm/models.js';
import { REPAIRER_SYSTEM } from '../prompts/repairer.js';
import { emit, type NodeConfig, type State, type Update } from '../graph/state.js';

const MAX_TOOL_ROUNDS = 4;

export async function repairer(state: State, config: NodeConfig): Promise<Update> {
  emit(config, { type: 'stage', stage: 'fixing', message: `${state.issues.length} issue(s)` });
  let spec = state.draft as CreationT;

  const getSpec = tool(async () => JSON.stringify(spec), {
    name: 'get_spec', description: 'Get the current creation as JSON.', schema: z.object({}),
  });
  const applyTool = tool(async ({ ops }: { ops: EditT[] }) => {
    const result = applyEdits(spec, ops);
    spec = result.spec;
    emit(config, { type: 'edit', ops });
    return JSON.stringify({ applied: result.applied, notes: result.issues });
  }, {
    name: 'apply_edits', description: 'Apply edit ops to the creation.', schema: z.object({ ops: z.array(Edit).min(1).max(20) }),
  });
  const playtestTool = tool(async () => JSON.stringify(playtest(spec).filter((r) => !r.ok)), {
    name: 'playtest', description: 'Re-run the playtest. Returns only failing parts; [] means everything passes.', schema: z.object({}),
  });
  const tools = [getSpec, applyTool, playtestTool];
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

  const t0 = Date.now();
  const model = toolModel('repairer', tools);
  const messages: BaseMessage[] = [
    new SystemMessage(REPAIRER_SYSTEM),
    new HumanMessage(`Playtest failures:\n${state.issues.map((i) => `- ${i}`).join('\n')}\n\nCreation:\n${JSON.stringify(spec)}`),
  ];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const ai = await model.invoke(messages, { signal: config.signal });
    messages.push(ai);
    const calls = ai.tool_calls ?? [];
    if (calls.length === 0) break;
    for (const call of calls) {
      const t = byName[call.name];
      const content = t ? String(await (t as { invoke: (a: unknown) => Promise<unknown> }).invoke(call.args)) : `unknown tool ${call.name}`;
      messages.push(new ToolMessage({ tool_call_id: call.id ?? call.name, content }));
    }
  }
  console.info(`[repairer] round ${state.repairRounds + 1} done in ${Date.now() - t0}ms`);
  return { draft: spec, repairRounds: state.repairRounds + 1 };
}

/** Deterministic fixes for common playtest failures (no LLM). */
export function autofix(spec: CreationT): CreationT {
  let current = spec;
  for (let pass = 0; pass < 2; pass++) {
    const failing = playtest(current).filter((r) => !r.ok);
    if (!failing.length) break;
    const ops: EditT[] = [];
    failing.forEach((r, n) => {
      const part = current.parts.find((p) => p.id === r.partId);
      if (!part) return;
      const text = r.issues.join(' ');
      if (/not playable yet/.test(text)) ops.push({ op: 'update', id: part.id, patch: { verb: 'strike' } });
      if (/in the way|covered|too close/.test(text)) {
        const [x, y, z] = part.transform.pos;
        const side = n % 2 === 0 ? 1 : -1;
        ops.push({ op: 'update', id: part.id, patch: { transform: { pos: [x + 0.05 * side, y, z + 0.06] } } });
      }
      if (/does not trigger/.test(text)) ops.push({ op: 'update', id: part.id, patch: { transform: { scale: (part.transform.scale ?? 1) * 1.3 } } });
    });
    if (!ops.length) break;
    current = applyEdits(current, ops).spec;
  }
  return current;
}
