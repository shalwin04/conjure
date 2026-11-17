/** Deterministic (code-only) nodes: validate, playtest, autofix, commit, reply. */
import { playtest } from '../../src/engine/playtest.js';
import { validateCreation } from '../../src/spec/schema.js';
import { autofix } from '../agents/repairer.js';
import { emit, type NodeConfig, type State, type Update } from './state.js';

export async function validate(state: State, _config: NodeConfig): Promise<Update> {
  const result = validateCreation(state.draft);
  if (!result.ok || !result.creation) throw new Error(`Generated creation is invalid: ${result.errors.slice(0, 3).join('; ')}`);
  return { draft: result.creation };
}

export async function playtestNode(state: State, config: NodeConfig): Promise<Update> {
  emit(config, { type: 'stage', stage: 'testing' });
  const results = playtest(state.draft!);
  emit(config, { type: 'playtest', results, round: state.repairRounds });
  const issues = results.filter((r) => !r.ok).flatMap((r) => r.issues.map((i) => `${r.partId}: ${i}`));
  return { issues };
}

export async function autofixNode(state: State, config: NodeConfig): Promise<Update> {
  emit(config, { type: 'stage', stage: 'fixing', message: 'engine auto-fix' });
  const draft = autofix(state.draft!);
  emit(config, { type: 'playtest', results: playtest(draft), round: state.repairRounds + 1 });
  return { draft };
}

export async function commit(state: State, config: NodeConfig): Promise<Update> {
  const prev = state.request.spec;
  const draft = state.draft!;
  const spec = state.intent === 'edit' && prev ? { ...draft, id: prev.id, version: (prev.version ?? 1) + 1 } : { ...draft, version: 1 };
  emit(config, { type: 'commit', spec, source: state.source, ms: Date.now() - state.startedAt, repairs: state.repairRounds, reference: state.reference ?? null });
  emit(config, { type: 'stage', stage: 'ready' });
  return { draft: spec };
}

export async function reply(state: State, config: NodeConfig): Promise<Update> {
  emit(config, { type: 'say', text: state.reply ?? 'Tell me something to build, like "a drum kit made of crystal".' });
  emit(config, { type: 'stage', stage: 'ready' });
  return {};
}
