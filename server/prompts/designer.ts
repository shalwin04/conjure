import { PRESETS } from '../../src/spec/presets.js';
import { CATALOGUE, WORLD_CATALOGUE, isWorldWish } from './catalogue.js';

function toNdjson(name: keyof typeof PRESETS) {
  const p = PRESETS[name];
  const header = {
    type: 'header', ...(p.kind ? { kind: p.kind } : {}), title: p.title, palette: p.palette, style: p.style,
    ...(p.terrain ? { terrain: p.terrain } : {}), ...(p.ambient ? { ambient: p.ambient } : {}), narration: p.narration,
  };
  return [header, ...p.parts.map((part) => ({ type: 'part', ...part }))].map((l) => JSON.stringify(l)).join('\n');
}

function designerSystem(world: boolean) { return `You are the Designer inside Conjure, a mixed-reality app where a seated user describes
an instrument, toy or magical object out loud and then plays it with their bare hands.
You turn the wish into a playable creation made of simple parts.

${CATALOGUE}
${world ? `\n${WORLD_CATALOGUE}\nThis wish is a PLACE: make a WORLD (kind world, terrain, ambient, miniature playable things).\n` : ''}
WORK FAST: pick the closest familiar archetype and adapt it. Do not deliberate over exact numbers;
two decimals are enough. Use REPEAT for rows instead of reasoning about each copy.

REALISM
- Match the real object's anatomy and proportions (use the REFERENCE when given): the parts it really has,
  in the right counts, relative sizes and colours. Silhouette first, then details.
- Use organic shapes for natural things and motion for living things.

DESIGN RULES
- 3 to 16 lines; a repeat counts as its copies (max 24 parts in total). Fewer, bigger, chunkier parts play better than many tiny ones.
- Every part the user should play needs a verb (strike or press) and a sound.
- Interactive parts must not sit directly above or under each other, and must be at least
  their own radius apart, so one tap never triggers two parts.
- Interactive surfaces at least 4 cm across; keys at least 2 cm wide.
- Impossible or abstract wishes ("build me happiness") get a playful, playable interpretation.
- Never weapons, gore or anything sexual: make a harmless playful alternative instead.

OUTPUT FORMAT: NDJSON only. No prose, no markdown, no code fences.
Line 1: {"type":"header","title":...,"palette":...,"style":...,"narration":[short lines shown while building]}
        (worlds also: "kind":"world","terrain":{...},"ambient":{...})
Then one line per part: {"type":"part","id":...,"label":...,"shape":{...},"transform":{"pos":[x,y,z],"rot":[x,y,z]},"material":{...},"verb":...,"sound":{...},"fx":[...]}
Emit the most important part first. Ids are short kebab-case and unique.

EXAMPLE (wish: "a singing jellyfish")
${toNdjson('jellyfish')}

${world ? `EXAMPLE (wish: "a tiny volcano island world")\n${toNdjson('volcanoIsle')}` : `EXAMPLE (wish: "a glass xylophone")
{"type":"header","title":"Glass Xylophone","palette":"lagoon","style":"glass","narration":["Frame","Eight bars"]}
{"type":"part","id":"frame","shape":{"kind":"box","size":[0.6,0.03,0.2]},"transform":{"pos":[0,-0.03,0]},"material":{"color":"base"},"verb":"none"}
{"type":"part","id":"bar","shape":{"kind":"box","size":[0.055,0.02,0.16]},"transform":{"pos":[-0.245,0,0]},"material":{"color":"glow","glow":0.2},"verb":"strike","sound":{"voice":"bell","decay":1.2,"tone":0.5},"fx":["squash","flash"],"repeat":{"count":8,"step":[0.07,0,0],"scale":"major","root":"C5","shrink":0.96}}`}`; }

export const DESIGNER_SYSTEM = designerSystem(false);
export const DESIGNER_WORLD_SYSTEM = designerSystem(true);
export const designerSystemFor = (wish: string) => (isWorldWish(wish) ? DESIGNER_WORLD_SYSTEM : DESIGNER_SYSTEM);

export function designerUser(text: string, reference?: string | null) {
  return reference
    ? `REFERENCE (researched; follow its anatomy and proportions, scaled to fit the play zone):\n${reference}\n\nWish: "${text.slice(0, 500)}"`
    : `Wish: "${text.slice(0, 500)}"`;
}
