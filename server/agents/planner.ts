/**
 * Planner: a fast first pass that only decides WHAT to build (title, look,
 * and up to 5 groups of parts with a coarse location), no numbers. The plan
 * goes to the headset immediately as placeholder ghosts, and each group is
 * then filled in by a Builder in parallel.
 */
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { PALETTES, PLAY_ZONE, STYLES, SUPPORTED_VERBS, VOICES } from '../../src/spec/schema.js';
import type { PlanGroupView } from '../../src/spec/protocol.js';
import { structuredModel } from '../llm/models.js';
import { PLANNER_SYSTEM, plannerUser } from '../prompts/planner.js';
import { formatCard } from '../research/reference.js';
import { emit, type NodeConfig, type State, type Update } from '../graph/state.js';

const X = z.enum(['left', 'center', 'right', 'full']);
const Y = z.enum(['low', 'mid', 'high', 'full']);
const Zd = z.enum(['front', 'middle', 'back', 'full']);

export const PlanGroup = z.object({
  id: z.string().min(1).max(24),
  label: z.string().min(1).max(40),
  idea: z.string().max(200),
  count: z.number().int().min(1).max(16),
  verb: z.enum(SUPPORTED_VERBS as unknown as [string, ...string[]]),
  voice: z.enum(VOICES),
  x: X, y: Y, z: Zd,
});
export const Plan = z.object({
  title: z.string().min(1).max(60),
  palette: z.enum(PALETTES),
  style: z.enum(STYLES),
  groups: z.array(PlanGroup).min(1).max(5),
});
export type PlanT = z.infer<typeof Plan>;
export type PlanGroupT = z.infer<typeof PlanGroup> & { min: [number, number, number]; max: [number, number, number]; order: number };

const RANGES = {
  x: { left: [PLAY_ZONE.x[0], -0.1], center: [-0.13, 0.13], right: [0.1, PLAY_ZONE.x[1]], full: [PLAY_ZONE.x[0], PLAY_ZONE.x[1]] },
  y: { low: [PLAY_ZONE.y[0], 0.08], mid: [0.02, 0.24], high: [0.18, PLAY_ZONE.y[1]], full: [PLAY_ZONE.y[0], PLAY_ZONE.y[1]] },
  z: { front: [0, PLAY_ZONE.z[1]], middle: [-0.15, 0.05], back: [PLAY_ZONE.z[0], -0.1], full: [PLAY_ZONE.z[0], PLAY_ZONE.z[1]] },
} as const;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'group';

/** Turn coarse words into boxes; groups that landed in the same box split it left to right. */
export function layoutGroups(groups: z.infer<typeof PlanGroup>[]): PlanGroupT[] {
  const used = new Set<string>();
  const placed: PlanGroupT[] = groups.map((g, order) => {
    let id = slug(g.id || g.label);
    while (used.has(id)) id = `${id}-${order}`;
    used.add(id);
    return {
      ...g, id, order,
      min: [RANGES.x[g.x][0], RANGES.y[g.y][0], RANGES.z[g.z][0]],
      max: [RANGES.x[g.x][1], RANGES.y[g.y][1], RANGES.z[g.z][1]],
    };
  });
  const byBox = new Map<string, PlanGroupT[]>();
  for (const g of placed) {
    const key = `${g.x}|${g.y}|${g.z}`;
    byBox.set(key, [...(byBox.get(key) ?? []), g]);
  }
  for (const same of byBox.values()) {
    if (same.length < 2) continue;
    const [x0, x1] = [same[0].min[0], same[0].max[0]];
    const w = (x1 - x0) / same.length;
    same.forEach((g, i) => { g.min = [x0 + w * i, g.min[1], g.min[2]]; g.max = [x0 + w * (i + 1), g.max[1], g.max[2]]; });
  }
  return placed;
}

export const toView = (g: PlanGroupT): PlanGroupView => ({ id: g.id, label: g.label, count: g.count, min: g.min, max: g.max });

export async function planner(state: State, config: NodeConfig): Promise<Update> {
  emit(config, { type: 'stage', stage: 'designing', message: 'planning' });
  const t0 = Date.now();
  try {
    const plan = await structuredModel('planner', Plan, 'creation_plan').invoke(
      [new SystemMessage(PLANNER_SYSTEM), new HumanMessage(`${state.reference ? `REFERENCE:\n${formatCard(state.reference)}\n\n` : ''}${plannerUser(state.request.text)}`)],
      { signal: config.signal },
    );
    const groups = layoutGroups(plan.groups);
    console.info(`[planner] ${groups.length} groups in ${Date.now() - t0}ms: ${groups.map((g) => `${g.id}×${g.count}`).join(', ')}`);
    emit(config, {
      type: 'plan', source: 'live',
      header: { title: plan.title, palette: plan.palette, style: plan.style, narration: groups.map((g) => g.label) },
      groups: groups.map(toView),
    });
    return { plan: { ...plan, groups } };
  } catch (err) {
    if (config.signal?.aborted) throw err;
    console.warn(`[planner] failed after ${Date.now() - t0}ms, falling back to the single designer:`, err instanceof Error ? err.message : err);
    return { plan: null };
  }
}
