import { CATALOGUE } from './catalogue.js';
import type { PlanT, PlanGroupT } from '../agents/planner.js';

export const BUILDER_SYSTEM = `You build ONE group of parts for a creation in Conjure (mixed reality, seated user,
bare hands). Work fast: pick sensible numbers, two decimals, no deliberation.

${CATALOGUE}

RULES
- Every part must sit inside the group's BOX. Stay clear of the other groups' boxes.
- Interactive parts at least 4 cm across and spaced at least their own radius apart; never stack them.
- For rows of similar parts use ONE part with "repeat" (the engine places and tunes the copies).
- Output NDJSON part lines only: {"type":"part","id":...,"shape":...,"transform":...,"verb":...,"sound":...,"fx":[...]}
  No header, no prose, no code fences.

EXAMPLE (group "8 glass bars", box x -0.3..0.3, y -0.05..0.1, z -0.1..0.1)
{"type":"part","id":"bar","shape":{"kind":"box","size":[0.055,0.02,0.16]},"transform":{"pos":[-0.245,0,0]},"material":{"color":"glow","glow":0.2},"verb":"strike","sound":{"voice":"bell","decay":1.2,"tone":0.5},"fx":["squash","flash"],"repeat":{"count":8,"step":[0.07,0,0],"scale":"major","root":"C5","shrink":0.96}}`;

const box = (g: { min: number[]; max: number[] }) =>
  `x ${g.min[0].toFixed(2)}..${g.max[0].toFixed(2)}, y ${g.min[1].toFixed(2)}..${g.max[1].toFixed(2)}, z ${g.min[2].toFixed(2)}..${g.max[2].toFixed(2)}`;

export function builderUser(wish: string, plan: PlanT, g: PlanGroupT, others: PlanGroupT[]) {
  return [
    `Creation: "${plan.title}" (wish: "${wish.slice(0, 300)}"), style ${plan.style}, palette ${plan.palette}.`,
    `YOUR GROUP: id "${g.id}", "${g.label}" x${g.count}: ${g.idea}`,
    `verb ${g.verb}, voice ${g.voice}. BOX: ${box(g)}`,
    others.length ? `Other groups (keep out of their boxes): ${others.map((o) => `"${o.label}" ${box(o)}`).join('; ')}` : '',
  ].filter(Boolean).join('\n');
}
