/**
 * The Conjure agent graph: code decides the order, agents do the judgment.
 *
 *   create: router -> researcher (library / cache / web search) -> verify -> designer ...
 *   critique (separate graph, after the user can already play):
 *     critic (sees a snapshot) -> validate -> playtest -> commit (version + 1)
 *
 *   create (DESIGN_MODE=split, opt-in):
 *     router ─> planner ─┬─ Send ─> builder (group 1) ─┐
 *                        ├─ Send ─> builder (group 2) ─┼─> assemble ─> validate ...
 *                        └─ ...in parallel            ─┘
 *     planner failure falls back to the single designer.
 *
 *   router ─┬─ create ─> designer ─┐
 *           ├─ edit ───> editor ───┼─> validate ─> playtest ─┬─ pass ─> commit
 *           └─ chat ───> respond    │                         ├─ fail ─> repairer ─> validate (max 2 rounds)
 *                                   │                         └─ fail, out of rounds / replay ─> autofix ─> commit
 */
import { END, START, Send, StateGraph } from '@langchain/langgraph';
import { assemble, builder } from '../agents/builder.js';
import { planner } from '../agents/planner.js';
import { researcher, verify } from '../agents/researcher.js';
import { critic } from '../agents/critic.js';
import { designer } from '../agents/designer.js';
import { customise, editor } from '../agents/editor.js';
import { repairer } from '../agents/repairer.js';
import { router } from '../agents/router.js';
import { worldPlanner } from '../agents/world.js';
import { isWorldWish } from '../prompts/catalogue.js';
import { isFixture } from '../llm/models.js';
import { autofixNode, commit, playtestNode, reply, validate } from './nodes.js';
import { ConjureState, type State } from './state.js';

/** Each repair round is another slow model call; one round, then deterministic autofix. */
export const MAX_REPAIR_ROUNDS = Number(process.env.MAX_REPAIR_ROUNDS ?? 1);

/**
 * 'single' (default) = one Designer call. 'split' = planner + parallel builders.
 * Measured Nov 13 on Muse Spark 1.2: split took ~39 s vs ~18 s single, because
 * each call pays the model's long hidden-reasoning start-up and the planner
 * and builders run one after the other. Revisit with a faster planner model.
 */
export const designMode = () => (process.env.DESIGN_MODE === 'split' ? 'split' : 'single');

function afterRouter(s: State) {
  if (s.intent === 'edit') return 'editor';
  if (s.intent === 'chat') return 'respond';
  // Places go to the World Planner (scene plan + layout solver); objects to research + design.
  if (isWorldWish(s.request.text) && process.env.WORLD_PLANNER !== 'off') return 'world';
  return 'researcher';
}

function afterVerify() {
  return designMode() === 'split' && !isFixture('planner') ? 'planner' : 'designer';
}

function fanOut(s: State) {
  if (!s.plan) return 'designer';
  return s.plan.groups.map((group) => new Send('builder', { ...s, group }));
}

export function afterPlaytest(state: State): 'commit' | 'repairer' | 'autofix' {
  if (state.issues.length === 0) return 'commit';
  if (state.repairRounds < MAX_REPAIR_ROUNDS && !isFixture('repairer')) return 'repairer';
  return 'autofix';
}

export const conjureGraph = new StateGraph(ConjureState)
  .addNode('router', router)
  .addNode('researcher', researcher)
  .addNode('verify', verify)
  .addNode('planner', planner)
  .addNode('builder', builder)
  .addNode('assemble', assemble)
  .addNode('designer', designer)
  .addNode('world', worldPlanner)
  .addNode('customise', customise)
  .addNode('editor', editor)
  .addNode('validate', validate)
  .addNode('playtest', playtestNode)
  .addNode('repairer', repairer)
  .addNode('autofix', autofixNode)
  .addNode('commit', commit)
  .addNode('respond', reply)
  .addEdge(START, 'router')
  .addConditionalEdges('router', afterRouter, ['researcher', 'editor', 'respond', 'world'])
  .addConditionalEdges('world', (s: State) => (s.blueprint && s.blueprint !== 'scene' ? 'customise' : 'validate'), ['customise', 'validate'])
  .addEdge('researcher', 'verify')
  .addConditionalEdges('verify', afterVerify, ['planner', 'designer'])
  .addConditionalEdges('planner', fanOut, ['builder', 'designer'])
  .addEdge('builder', 'assemble')
  .addEdge('assemble', 'validate')
  .addConditionalEdges('designer', (s: State) => (s.blueprint ? 'customise' : 'validate'), ['customise', 'validate'])
  .addEdge('customise', 'validate')
  .addEdge('editor', 'validate')
  // Solved worlds are placed by the solver: no playtest/repair round needed.
  .addConditionalEdges('validate', (s: State) => (s.blueprint === 'scene' ? 'commit' : 'playtest'), ['commit', 'playtest'])
  .addConditionalEdges('playtest', afterPlaytest, ['commit', 'repairer', 'autofix'])
  .addEdge('repairer', 'validate')
  .addEdge('autofix', 'commit')
  .addEdge('commit', END)
  .addEdge('respond', END)
  .compile();

/** Critique graph: Critic looks at a snapshot and proposes realism edits. */
export const critiqueGraph = new StateGraph(ConjureState)
  .addNode('critic', critic)
  .addNode('validate', validate)
  .addNode('playtest', playtestNode)
  .addNode('autofix', autofixNode)
  .addNode('commit', commit)
  .addEdge(START, 'critic')
  .addConditionalEdges('critic', (s: State) => (s.draft ? 'validate' : END), ['validate', END])
  .addEdge('validate', 'playtest')
  .addConditionalEdges('playtest', (s: State) => (s.issues.length ? 'autofix' : 'commit'), ['autofix', 'commit'])
  .addEdge('autofix', 'commit')
  .addEdge('commit', END)
  .compile();
