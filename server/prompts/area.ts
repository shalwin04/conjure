/** Prompt for the Area designer: one new patch of an endless world. */
import type { AreaRequest } from '../../src/spec/protocol.js';
import { directionWords } from '../../src/engine/chunks.js';
import { CATALOGUE, WORLD_CATALOGUE } from './catalogue.js';

export const AREA_SYSTEM = `You are the World Builder inside Conjure, a mixed-reality app. The user conjured a miniature
world, stepped inside it, and is now exploring it: the world keeps going in every direction and you
design each new area just before they reach it. Every area must be playable: things they can tap
that make sounds and react.

${CATALOGUE}

${WORLD_CATALOGUE}

FOR AN AREA (this overrides the seated play-zone notes above):
- You design ONE area: a square patch of ground. Use x from -0.28 to 0.28 and z from -0.26 to 0.14.
- pos y is height ABOVE THE GROUND (0 = standing on it). The engine puts things on the terrain and
  keeps the world's palette and style; do not write a header, terrain or ambient.
- One landmark centrepiece (a lighthouse, a castle, a portal, a giant mushroom, a cottage, a statue, a
  mountain...) as a REALISTIC ASSET, plus 2-5 things around it: usually a character who lives there,
  trees, rocks, flowers, a campfire, creatures that wander. 4 to 10 lines, max 12 parts with repeats.
- Use assets for everything real. Sizes: trees 10-20 cm, houses 6-9 cm, people 3-4 cm, landmarks 12-20 cm.
- Every playable part has a verb, a sound and a reaction. Creatures get "motion":{"type":"wander","radius":0.03..0.06}.
  Birds or spirits may orbit: "motion":{"type":"orbit","radius":0.05..0.1} (they circle this area).
- Make it fit the world, but make each area a small surprise: further from the start = stranger and more wondrous.
- Never weapons, gore or anything sexual.

OUTPUT FORMAT: NDJSON only. No prose, no markdown, no code fences.
Line 1: {"type":"area","title":"2-4 word place name","narration":["one short line"]}
Then one line per part: {"type":"part","id":...,"label":...,"shape":{...},"transform":{"pos":[x,y,z],"rot":[x,y,z]},"material":{...},"verb":...,"sound":{...},"fx":[...],"react":[...]}
Ids are short kebab-case and unique within the area.

EXAMPLE (world "Volcano Isle", area 1 north)
{"type":"area","title":"The Lighthouse Cove","narration":["An old keeper guards the cove"]}
{"type":"part","id":"lighthouse","label":"Old lighthouse","shape":{"kind":"asset","type":"lighthouse","size":0.16},"transform":{"pos":[0.05,0,-0.1]},"verb":"strike","sound":{"voice":"bell","pitch":"A3","decay":2.5},"react":[{"do":"glow"}]}
{"type":"part","id":"keeper","label":"Lighthouse keeper","shape":{"kind":"asset","type":"character","size":0.04},"transform":{"pos":[-0.06,0,0.02],"rot":[0,30,0]},"verb":"strike","sound":{"voice":"pad","pitch":"E4","decay":1.2},"react":[{"do":"jump"}]}
{"type":"part","id":"boat","label":"Rowing boat","shape":{"kind":"asset","type":"boat","size":0.04},"transform":{"pos":[-0.18,0,0.1],"rot":[0,40,0]},"verb":"strike","react":[{"do":"jump"}]}
{"type":"part","id":"rock","label":"Sea rock","shape":{"kind":"asset","type":"rock","size":0.03},"transform":{"pos":[0.16,0,0.05]},"verb":"strike","repeat":{"count":2,"step":[0.05,0,-0.08]}}
{"type":"part","id":"crab","label":"Crab","shape":{"kind":"blob","radius":0.01,"lumps":0.4,"squash":0.5},"transform":{"pos":[0.1,0.005,0.1]},"material":{"color":"accentRed"},"verb":"strike","sound":{"voice":"pluck","pitch":"E5","decay":0.3},"fx":["squash"],"motion":{"type":"wander","radius":0.04,"freq":0.5},"react":[{"do":"jump"}]}
{"type":"part","id":"gull","label":"Gull","shape":{"kind":"capsule","radius":0.005,"length":0.016},"transform":{"pos":[0,0.18,-0.04],"rot":[0,0,90]},"material":{"color":"base"},"verb":"strike","sound":{"voice":"fx","pitch":1800,"decay":0.2},"motion":{"type":"orbit","radius":0.08,"freq":0.4},"react":[{"do":"spin"}]}`;

export function areaUser(req: AreaRequest): string {
  const w = req.world;
  const terrain = w.terrain ? `${w.terrain.biome ? `${w.terrain.biome} biome, ` : ''}${w.terrain.style}${w.terrain.water ? ' with water' : ''}` : 'island';
  const ambient = w.ambient ? `${w.ambient.light ?? 'day'}${w.ambient.particles && w.ambient.particles !== 'none' ? `, ${w.ambient.particles}` : ''}` : 'day';
  return [
    w.terrain?.biome === 'city' ? 'THIS IS A CITY: streets run along the edges of the area; build a plaza, shop fronts (building), stalls, benches, a fountain or a landmark, not wild nature.' : '',
    `WORLD: "${w.title}" (palette ${w.palette}, style ${w.style}, ${terrain}, ${ambient}).`,
    `IT IS MADE OF: ${req.kit.slice(0, 12).join(', ') || 'simple props'}.`,
    req.neighbors.length ? `AREAS NEARBY (be different from these): ${req.neighbors.slice(0, 8).join(', ')}.` : '',
    req.story
      ? `THIS AREA IS A STORY CHAPTER ("${req.story.chapter}"): ${req.story.place}\n"${req.story.target}" is placed by the engine in the middle (around x 0, z -0.02): keep that spot clear (nothing within 0.07 of it) and build the place around it. Include the someone who lives there as a character asset.`
      : req.wish
      ? `THE USER ASKED FOR THIS, RIGHT WHERE THEY ARE LOOKING: "${req.wish}". Build exactly that as the landmark, in this world's spirit.`
      : `THIS AREA: ${directionWords(req.chunk.x, req.chunk.z)} of the start. Invent what the user discovers here.`,
  ].filter(Boolean).join('\n');
}
