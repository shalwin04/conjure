import { Annotation, type LangGraphRunnableConfig } from '@langchain/langgraph';
import type { ConjureEvent, ConjureRequest, Source } from '../../src/spec/protocol.js';
import type { CreationT, PartT } from '../../src/spec/schema.js';
import type { PlanGroupT, PlanT } from '../agents/planner.js';
import type { ReferenceCardT, ReferenceSource } from '../research/reference.js';

export type Intent = 'create' | 'edit' | 'chat';

/** Graph state. The server is stateless between requests: the headset sends the spec. */
export const ConjureState = Annotation.Root({
  request: Annotation<ConjureRequest>,
  startedAt: Annotation<number>,
  intent: Annotation<Intent>,
  targetPartId: Annotation<string | null>,
  /** Short line to say back to the user (chat replies, edit confirmations). */
  reply: Annotation<string | null>,
  /** Verified reference card for the object (null = design from model knowledge). */
  reference: Annotation<ReferenceCardT | null>,
  referenceOrigin: Annotation<ReferenceSource | 'none'>,
  /** Set when the Designer used a blueprint instead of a model call. */
  blueprint: Annotation<string | null>,
  /** Critique mode only: snapshot of the built creation. */
  image: Annotation<string | null>,
  /** Planner output (split design mode). Null = use the single Designer. */
  plan: Annotation<(Omit<PlanT, 'groups'> & { groups: PlanGroupT[] }) | null>,
  /** Set only in a Builder's Send payload: the group it builds. */
  group: Annotation<PlanGroupT | null>,
  /** Parts from all parallel Builders, concatenated. */
  builtParts: Annotation<PartT[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  /** The creation being built or edited. */
  draft: Annotation<CreationT | null>,
  /** Playtest failures, formatted for the Repairer. Empty = passing. */
  issues: Annotation<string[]>({ reducer: (_, next) => next, default: () => [] }),
  repairRounds: Annotation<number>({ reducer: (_, next) => next, default: () => 0 }),
  /** 'fixture' when any step ran in replay mode. */
  source: Annotation<Source>({ reducer: (a, b) => (a === 'fixture' || b === 'fixture' ? 'fixture' : 'live'), default: () => 'live' }),
});

export type State = typeof ConjureState.State;
export type Update = typeof ConjureState.Update;
export type NodeConfig = LangGraphRunnableConfig;

/** Send an event to the headset (LangGraph custom stream -> server-sent events). */
export function emit(config: NodeConfig, event: ConjureEvent) {
  config.writer?.(event);
}
