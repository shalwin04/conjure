/** Engine catalogue rendered for prompts. Generated from the schema so prompts never drift. */
import { ASSET_INFO, FX, LIGHTS, LIMITS, MOTIONS, PALETTES, PALETTE_SLOTS, PARTICLES, PLAY_ZONE, REACTIONS, STYLES, SUPPORTED_VERBS, TERRAINS, VOICES } from '../../src/spec/schema.js';

export const CATALOGUE = `
COORDINATES: metres, relative to the play zone centre in front of a SEATED user.
  x = right (${PLAY_ZONE.x[0]} to ${PLAY_ZONE.x[1]}), y = up (${PLAY_ZONE.y[0]} to ${PLAY_ZONE.y[1]}), z = toward the user (${PLAY_ZONE.z[0]} to ${PLAY_ZONE.z[1]}).
  y = 0 is roughly lap/desk height. Keep things the user hits most closest (z near 0..0.1, y near 0..0.2).
SHAPES (sizes in metres, ${LIMITS.minSize}..${LIMITS.maxSize}):
  {"kind":"cylinder","radius":r,"height":h}  axis is +y; its TOP face is the playing surface
  {"kind":"box","size":[w,h,d]}               TOP face (+y) is the playing surface
  {"kind":"sphere","radius":r}                 playable from any side
  {"kind":"torus","radius":r,"tube":t}         lies flat, playable from any side
  {"kind":"cone","radius":r,"height":h}
  {"kind":"capsule","radius":r,"length":l}     playable from any side
  ORGANIC SHAPES (prefer these for anything natural or curvy):
  {"kind":"lathe","profile":[[r,y],...]}       3-12 [radius,height] points from bottom to top, spun around y:
                                               bells, jellyfish domes, gongs, vases, cups, mushroom caps
  {"kind":"tube","length":l,"radius":r,"taper":0..0.95,"curl":0..1,"wave":0..1}
                                               hangs DOWN from its position: tentacles, strings, vines, horns
  {"kind":"blob","radius":r,"lumps":0..1,"squash":0.3..2}   soft lumpy bodies, rocks, clouds, oral arms
  {"kind":"frustum","top":r1,"bottom":r2,"height":h}        flat-topped cone: drum shells, lamps, pedestals
  REALISTIC ASSETS (the engine builds the real-looking thing; size = its height; its base stands at pos):
  {"kind":"asset","type":T,"size":h,"variant":0..3}
${Object.entries(ASSET_INFO).map(([k, v]) => `    ${k.padEnd(10)} ${v.desc}`).join('\n')}
  Assets come with a sound and a reaction already (a volcano erupts, a campfire flares, trees shower leaves).
  ALWAYS use an asset for anything that exists in real life; use primitives only for magical or abstract bits.
ROTATION: "rot":[x,y,z] in degrees. Tilt a drum toward the user with a POSITIVE x rotation (10..30).
VERBS (only these): ${SUPPORTED_VERBS.join(', ')}
  strike = hit it with a fingertip or palm (drums, bars, bells, gongs, bubbles)
  press  = push down like a key or button (piano keys, pads, buttons)
  none   = decoration or a stand/body that is not played
VOICES: ${VOICES.join(', ')}
  membrane=drums/toms/bongos, noise=snare/claps/shakers, metal=hats/cymbals/gongs, pluck=strings/kalimba,
  bell=bells/marimba/glass/chimes, pad=soft glowing tones, bass=bass notes, theremin=eerie sine, fx=zaps/bubbles/magic
SOUND: {"voice":v,"pitch":Hz number or note like "C4"/"F#3","decay":seconds 0.05..4,"tone":0 dark..1 bright}
  Pitched sets (keys, bars, tines, bells) should follow a musical scale, e.g. C major pentatonic.
REPEAT (use it for any set of similar parts):
  row:  "repeat":{"count":n,"step":[dx,dy,dz],"scale":"major|minor|pentatonic|minorPentatonic|blues|chromatic","root":"C4","shrink":0.95}
  ring: "repeat":{"count":n,"mode":"radial","radius":r,"scale":...,"root":...}  copies in a ring around the part, facing out
        (tentacles around a bell, petals, drums in a circle)
  Add it to ONE part; the engine places, tunes and phases the copies.
  Do not write those parts out one by one and do not compute their pitches yourself.
FX: ${FX.join(', ')}  (squash + flash are good defaults)
MOTION (idle animation that makes it feel alive): "motion":{"type": ${MOTIONS.join('|')},"amp":0..1,"freq":Hz}
  pulse = breathing (bells, hearts), sway = bending from the top (tentacles, plants, strings),
  bob = floating, spin = slow turning, flutter = wings/leaves. Living things should always move.
STYLES: ${STYLES.join(', ')}  (jelly = translucent iridescent; organic = soft skin; crystal; pearl)
PALETTES: ${PALETTES.join(', ')}
MATERIAL: {"color": one of ${PALETTE_SLOTS.join('|')}, "glow": 0..1}
`.trim();

export const WORLD_CATALOGUE = `
WORLDS (when the wish is a place or scene: island, garden, forest, village, planet, aquarium, "a world"):
  header adds "kind":"world","terrain":{"style": ${TERRAINS.join('|')},"radius":0.15..0.25,"height":0..0.1,"roughness":0..1,"water":true|false},
               "ambient":{"particles": ${PARTICLES.join('|')},"light": ${LIGHTS.join('|')}}
  In a world, a part's pos y is its height ABOVE THE GROUND (0 = standing on it); keep x,z within the terrain radius.
  Things are miniature (a tree 6-12 cm, a house 6-8 cm, a person 3-4 cm, a volcano 15-22 cm, a creature 2-4 cm).
  Build worlds mostly from ASSETS (trees, rocks, houses, volcano, characters...) so they look real.
  A world tells a small story: include at least one character (asset "character") and one wonder to discover. Give creatures "motion":{"type":"wander","radius":r},
  clouds/birds/moons "motion":{"type":"orbit","radius":r}. Make many things playable, each with a sound and a reaction:
  "react":[{"do": ${REACTIONS.join('|')},"target":optional other part id}]
  erupt = volcano/fountain, rain = clouds, daynight = sun/moon, jump = creatures, burst/bloom = trees/flowers.
`.trim();

/** Wishes for something you play like an instrument stay instruments; everything else becomes a world. */
export const INSTRUMENT_WISH = /\b(drums?|drum ?kit|piano|keyboard|xylophone|marimba|kalimba|guitar|harp|instrument|synth|flute|violin|cello|gong|chimes|bells?|music box|theremin|bongos?|beat ?pad|jellyfish)\b/i;
export const isWorldWish = (wish: string) => WORLD_WISH.test(wish) || !INSTRUMENT_WISH.test(wish);

/** Wishes that describe a place or scene become worlds. */
export const WORLD_WISH = /\b(world|island|isle|garden|forest|village|planet|aquarium|city|town|ocean|sea|scene|landscape|park|farm|desert|mountains?|pond|reef|castle|jungle|meadow|beach|valley|diorama|terrarium|snow ?globe|volcano|river|lake|cave|temple|ruins|kingdom|story|tale|adventure|quest|camp)\b/i;
