/**
 * Biomes: what a world is made of beyond the things the AI placed. Each one
 * sets the ground colours, the grass, the sky haze and the props that fill
 * the endless land, so "a city at night" and "a desert oasis" no longer look
 * like the same green island. Pure data (shared by headset, server and tests).
 */
import { BIOMES, type Biome } from '../spec/schema.js';

export interface BiomeLook {
  /** Ground colours by height band. */
  sand: number; grass: number; rock: number; snow: number;
  /** Grass blades per chunk (0..1 of the maximum) and their colour. */
  grassDensity: number; grassColor: number;
  /** Extra haze (0..1) and its tint mixed into the fog. */
  haze: number; hazeColor: number;
  /** Dryer, dustier air (sky turbidity added). */
  dust: number;
}

export const BIOME_LOOK: Record<Biome, BiomeLook> = {
  meadow: { sand: 0xe8d3a2, grass: 0x6fbf73, rock: 0x8a7f78, snow: 0xf4f6ff, grassDensity: 1, grassColor: 0x6fbf73, haze: 0, hazeColor: 0xc9dcef, dust: 0 },
  forest: { sand: 0xd8c9a0, grass: 0x4f9a55, rock: 0x6f6a62, snow: 0xf4f6ff, grassDensity: 0.9, grassColor: 0x4e9a4f, haze: 0.25, hazeColor: 0xb8d0c0, dust: 0 },
  autumn: { sand: 0xe2cfa0, grass: 0xa8a052, rock: 0x857a70, snow: 0xf4f6ff, grassDensity: 0.8, grassColor: 0xb4a24a, haze: 0.2, hazeColor: 0xe8d2b0, dust: 1 },
  snow: { sand: 0xdfe6ee, grass: 0xeef3f8, rock: 0x7d8590, snow: 0xffffff, grassDensity: 0, grassColor: 0xdfe8ee, haze: 0.3, hazeColor: 0xdfe8f4, dust: 0 },
  desert: { sand: 0xe6c48e, grass: 0xd9b27a, rock: 0xb07a52, snow: 0xf4e4c8, grassDensity: 0.08, grassColor: 0xb8a060, haze: 0.35, hazeColor: 0xf0d6aa, dust: 4 },
  tropical: { sand: 0xf2e2b6, grass: 0x58c46a, rock: 0x7f7468, snow: 0xf4f6ff, grassDensity: 1, grassColor: 0x5ccf6a, haze: 0.1, hazeColor: 0xbfe6f0, dust: 0 },
  city: { sand: 0xbab4aa, grass: 0xa9a59c, rock: 0x8d8780, snow: 0xf4f6ff, grassDensity: 0, grassColor: 0x6fa860, haze: 0.3, hazeColor: 0xd6d4d8, dust: 2 },
  village: { sand: 0xe0cfa2, grass: 0x7cbf6a, rock: 0x8a7f78, snow: 0xf4f6ff, grassDensity: 1, grassColor: 0x7cc06a, haze: 0.1, hazeColor: 0xd0e0ee, dust: 0 },
  fantasy: { sand: 0xe8d0e8, grass: 0x6fc8a8, rock: 0x7a7090, snow: 0xf4f0ff, grassDensity: 0.9, grassColor: 0x72d0b0, haze: 0.35, hazeColor: 0xd8c8f0, dust: 0 },
};

const WORDS: [Biome, RegExp][] = [
  ['city', /\b(city|cities|town ?centre|downtown|metropolis|skyscraper|street|urban|neon|tokyo|new york|london|paris|manhattan|cyberpunk)\b/i],
  ['desert', /\b(desert|dune|sahara|oasis|cactus|cacti|canyon|mesa|wild west|western|pyramid)\b/i],
  ['snow', /\b(snow|snowy|winter|ice|icy|frozen|arctic|polar|tundra|glacier|christmas|north pole)\b/i],
  ['autumn', /\b(autumn|fall|harvest|maple|pumpkin|halloween|october)\b/i],
  ['tropical', /\b(tropical|jungle|beach|island|lagoon|palm|caribbean|hawaii|reef)\b/i],
  ['fantasy', /\b(fairy|fae|magic|magical|enchanted|wizard|elf|elven|crystal|dream|unicorn|dragon)\b/i],
  ['village', /\b(village|hamlet|farm|cottage|countryside|market|windmill|town)\b/i],
  ['forest', /\b(forest|woods|woodland|grove|redwood|pine|taiga)\b/i],
];

/** A best guess from the wish's words (the planner may override it). */
export function guessBiome(text: string): Biome {
  for (const [b, re] of WORDS) if (re.test(text)) return b;
  return 'meadow';
}

export function isBiome(v: unknown): v is Biome {
  return typeof v === 'string' && (BIOMES as readonly string[]).includes(v);
}

/** The biome of a world, falling back to clues in its weather. */
export function biomeOf(spec: { terrain?: { biome?: string; water?: boolean; style?: string }; ambient?: { particles?: string } }): Biome {
  const b = spec.terrain?.biome;
  if (isBiome(b)) return b;
  if (spec.ambient?.particles === 'snow') return 'snow';
  if (spec.ambient?.particles === 'leaves') return 'autumn';
  if (spec.terrain?.water && spec.terrain.style === 'island') return 'tropical';
  return 'meadow';
}
