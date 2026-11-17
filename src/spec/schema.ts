/**
 * The Creation Spec: the single contract between the AI agent and the engine.
 * The agent only ever produces data in this shape; the engine turns it into
 * geometry, hand interactions, sound and effects. Shared by client and server.
 */
import { z } from 'zod';
import { SCALES, scaleNote, type ScaleName } from './music.js';

export const VERBS = ['strike', 'press', 'pluck', 'slide', 'grab', 'hover', 'none'] as const;
export const VOICES = ['membrane', 'noise', 'metal', 'pluck', 'bell', 'pad', 'bass', 'theremin', 'fx'] as const;
export const FX = ['squash', 'flash', 'burst', 'ripple', 'spin', 'wobble'] as const;
export const STYLES = ['glass', 'clay', 'neon', 'wood', 'metal', 'jelly', 'organic', 'crystal', 'pearl'] as const;
export const MOTIONS = ['pulse', 'sway', 'bob', 'spin', 'flutter', 'wander', 'orbit'] as const;
export const REACTIONS = ['burst', 'jump', 'grow', 'spin', 'glow', 'erupt', 'rain', 'daynight', 'bloom'] as const;
export const TERRAINS = ['island', 'hill', 'crater', 'flat', 'floating'] as const;
/** The look of the land: ground, grass, trees, sky and what fills the endless world. */
export const BIOMES = ['meadow', 'forest', 'autumn', 'snow', 'desert', 'tropical', 'city', 'village', 'fantasy'] as const;
export type Biome = (typeof BIOMES)[number];
export const PARTICLES = ['none', 'fireflies', 'snow', 'rain', 'bubbles', 'leaves', 'stars'] as const;
export const LIGHTS = ['day', 'dusk', 'night'] as const;
export const PALETTES = ['aurora', 'ember', 'lagoon', 'candy', 'forest', 'dusk', 'mono', 'sunrise'] as const;
export const PALETTE_SLOTS = ['base', 'accent', 'glow', 'accentRed', 'accentBlue'] as const;

/**
 * Realistic things the engine knows how to build (procedurally, no downloads).
 * Like Holodeck's asset retrieval: the AI names WHAT and HOW BIG, the engine
 * owns the geometry, so a "pine tree" always looks like a pine tree.
 * aspect = footprint radius / height. Defaults make every asset playable.
 */
export const ASSET_INFO = {
  oak: { aspect: 0.42, desc: 'broad leafy tree', sound: { voice: 'pluck', pitch: 'G4', decay: 0.8 }, react: 'burst' },
  pine: { aspect: 0.28, desc: 'conifer', sound: { voice: 'pluck', pitch: 'D4', decay: 0.9 }, react: 'burst' },
  aspen: { aspect: 0.26, desc: 'slender pale tree', sound: { voice: 'pluck', pitch: 'A4', decay: 0.7 }, react: 'burst' },
  ash: { aspect: 0.36, desc: 'tall leafy tree', sound: { voice: 'pluck', pitch: 'E4', decay: 0.8 }, react: 'burst' },
  bush: { aspect: 0.7, desc: 'round shrub', sound: { voice: 'noise', pitch: 2500, decay: 0.3, tone: 0.8 }, react: 'burst' },
  palm: { aspect: 0.4, desc: 'tropical palm', sound: { voice: 'bell', pitch: 'E5', decay: 1.0 }, react: 'burst' },
  rock: { aspect: 0.75, desc: 'boulder', sound: { voice: 'membrane', pitch: 90, decay: 0.35, tone: 0.3 }, react: 'glow' },
  volcano: { aspect: 1.05, desc: 'smoking volcano with a lava crater', sound: { voice: 'bass', pitch: 'C1', decay: 2.5, tone: 0.2 }, react: 'erupt' },
  mountain: { aspect: 0.95, desc: 'snow-capped peak', sound: { voice: 'pad', pitch: 'C3', decay: 3, tone: 0.3 }, react: 'glow' },
  cottage: { aspect: 0.6, desc: 'small house with chimney smoke', sound: { voice: 'membrane', pitch: 180, decay: 0.3 }, react: 'glow' },
  tower: { aspect: 0.3, desc: 'stone tower', sound: { voice: 'metal', pitch: 600, decay: 2, tone: 0.4 }, react: 'glow' },
  lighthouse: { aspect: 0.22, desc: 'striped lighthouse with a turning beam', sound: { voice: 'bell', pitch: 'A3', decay: 2.5 }, react: 'glow' },
  castle: { aspect: 0.75, desc: 'small castle with towers', sound: { voice: 'metal', pitch: 400, decay: 2.5 }, react: 'glow' },
  campfire: { aspect: 1.3, desc: 'crackling campfire', sound: { voice: 'noise', pitch: 900, decay: 0.6, tone: 0.5 }, react: 'burst' },
  lantern: { aspect: 0.18, desc: 'glowing lantern post', sound: { voice: 'bell', pitch: 'C6', decay: 1.2 }, react: 'glow' },
  mushroom: { aspect: 0.55, desc: 'spotted toadstool', sound: { voice: 'fx', pitch: 500, decay: 0.3 }, react: 'grow' },
  crystal: { aspect: 0.4, desc: 'glowing crystal cluster', sound: { voice: 'bell', pitch: 'E6', decay: 1.6, tone: 0.8 }, react: 'glow' },
  flower: { aspect: 0.4, desc: 'flower', sound: { voice: 'bell', pitch: 'C6', decay: 0.7 }, react: 'bloom' },
  character: { aspect: 0.28, desc: 'a person or storyteller (villager, wizard, keeper)', sound: { voice: 'pad', pitch: 'E4', decay: 1.2 }, react: 'jump' },
  portal: { aspect: 0.55, desc: 'glowing stone ring gateway', sound: { voice: 'theremin', pitch: 330, decay: 2 }, react: 'glow' },
  well: { aspect: 0.5, desc: 'stone wishing well', sound: { voice: 'bell', pitch: 'G3', decay: 2 }, react: 'burst' },
  boat: { aspect: 0.9, desc: 'small sailing boat', sound: { voice: 'pluck', pitch: 'C3', decay: 1 }, react: 'jump' },
  statue: { aspect: 0.35, desc: 'stone statue on a plinth', sound: { voice: 'metal', pitch: 300, decay: 1.8 }, react: 'glow' },
  cloud: { aspect: 1.4, desc: 'fluffy cloud', sound: { voice: 'pad', pitch: 'G4', decay: 2.5, tone: 0.3 }, react: 'rain' },
  maple: { aspect: 0.42, desc: 'autumn tree with orange and gold leaves', sound: { voice: 'pluck', pitch: 'F4', decay: 0.8 }, react: 'burst' },
  snowpine: { aspect: 0.28, desc: 'frosted snowy pine', sound: { voice: 'bell', pitch: 'D5', decay: 1.2 }, react: 'burst' },
  building: { aspect: 0.42, desc: 'town building, 2-5 floors with lit windows and a shop awning', sound: { voice: 'membrane', pitch: 160, decay: 0.4 }, react: 'glow' },
  skyscraper: { aspect: 0.13, desc: 'tall glass city tower with a blinking light', sound: { voice: 'metal', pitch: 220, decay: 2.5, tone: 0.5 }, react: 'glow' },
  car: { aspect: 1.0, desc: 'small rounded car', sound: { voice: 'fx', pitch: 420, decay: 0.4 }, react: 'jump' },
  streetlamp: { aspect: 0.14, desc: 'iron street lamp', sound: { voice: 'bell', pitch: 'A5', decay: 1.2 }, react: 'glow' },
  bench: { aspect: 0.9, desc: 'park bench', sound: { voice: 'pluck', pitch: 'C4', decay: 0.5 }, react: 'glow' },
  cactus: { aspect: 0.35, desc: 'desert cactus', sound: { voice: 'pluck', pitch: 'B3', decay: 0.6 }, react: 'bloom' },
  tent: { aspect: 0.62, desc: 'canvas camping tent', sound: { voice: 'noise', pitch: 1500, decay: 0.3, tone: 0.6 }, react: 'glow' },
  windmill: { aspect: 0.4, desc: 'windmill with turning sails', sound: { voice: 'pad', pitch: 'G3', decay: 2 }, react: 'glow' },
  stall: { aspect: 0.6, desc: 'market stall with a striped awning and fruit', sound: { voice: 'pluck', pitch: 'E5', decay: 0.6 }, react: 'burst' },
  fountain: { aspect: 0.5, desc: 'stone fountain with spraying water', sound: { voice: 'bell', pitch: 'G4', decay: 2 }, react: 'burst' },
  balloon: { aspect: 0.4, desc: 'striped hot-air balloon', sound: { voice: 'pad', pitch: 'C5', decay: 2 }, react: 'glow' },
  racecar: { aspect: 2.3, desc: 'open-wheel race car (Formula 1 style)', sound: { voice: 'fx', pitch: 220, decay: 0.8 }, react: 'jump' },
  grandstand: { aspect: 1.5, desc: 'grandstand of tiered seats with a roof and a cheering crowd', sound: { voice: 'noise', pitch: 1200, decay: 1.2, tone: 0.6 }, react: 'glow' },
  floodlight: { aspect: 0.15, desc: 'tall floodlight tower for night races and stadiums', sound: { voice: 'metal', pitch: 500, decay: 1.5 }, react: 'glow' },
  gantry: { aspect: 1.6, desc: 'start/finish gantry with red start lights over the track', sound: { voice: 'bell', pitch: 'A5', decay: 1 }, react: 'glow' },
  tyres: { aspect: 0.7, desc: 'stack of tyres (barrier)', sound: { voice: 'membrane', pitch: 120, decay: 0.3 }, react: 'jump' },
  garage: { aspect: 1.6, desc: 'pit garage building with team doors', sound: { voice: 'metal', pitch: 300, decay: 1 }, react: 'glow' },
} as const satisfies Record<string, { aspect: number; desc: string; sound: { voice: string; pitch?: string | number; decay?: number; tone?: number }; react: string }>;
export type AssetType = keyof typeof ASSET_INFO;
export const ASSETS = Object.keys(ASSET_INFO) as AssetType[];

/** Footprint radius and height of an asset of a given size (height). */
export function assetDims(type: AssetType, size: number) {
  return { radius: size * ASSET_INFO[type].aspect, height: size };
}

/** Play zone in metres, relative to the creation anchor (x right, y up, z toward the user). */
export const PLAY_ZONE = {
  x: [-0.32, 0.32],
  y: [-0.12, 0.42],
  z: [-0.28, 0.16],
} as const;
export const LIMITS = { maxParts: 48, minSize: 0.005, maxSize: 0.64 } as const;

const num = z.number().finite();
export const Vec3 = z.tuple([num, num, num]);

const BasicShape = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cylinder'), radius: num, height: num }),
  z.object({ kind: z.literal('box'), size: Vec3 }),
  z.object({ kind: z.literal('sphere'), radius: num }),
  z.object({ kind: z.literal('torus'), radius: num, tube: num }),
  z.object({ kind: z.literal('cone'), radius: num, height: num }),
  z.object({ kind: z.literal('capsule'), radius: num, length: num }),
  /** Side outline [radius, height] from bottom to top, spun around the y axis: bells, domes, vases, gongs. */
  z.object({ kind: z.literal('lathe'), profile: z.array(z.tuple([num, num])).min(3).max(12) }),
  /** Tapering tube hanging DOWN from the part position: tentacles, strings, vines, horns. */
  z.object({ kind: z.literal('tube'), length: num, radius: num, taper: num.optional(), curl: num.optional(), wave: num.optional() }),
  /** Soft lumpy sphere: bodies, rocks, creatures, clouds. */
  z.object({ kind: z.literal('blob'), radius: num, lumps: num.optional(), squash: num.optional() }),
  /** Cone with a flat top: drum shells, lamp shades, pedestals. */
  z.object({ kind: z.literal('frustum'), top: num, bottom: num, height: num }),
  /** A realistic thing built by the engine: size = its height (base on the ground at its position). */
  z.object({ kind: z.literal('asset'), type: z.enum(ASSETS as [AssetType, ...AssetType[]]), size: num, variant: num.optional() }),
]);
export const Shape = BasicShape;

export const SoundRecipe = z.object({
  voice: z.enum(VOICES),
  pitch: z.union([num, z.string()]).optional(),
  decay: num.optional(),
  tone: num.optional(),
  gain: num.optional(),
});

export const Part = z.object({
  id: z.string().min(1).max(40),
  label: z.string().max(40).optional(),
  shape: Shape,
  transform: z.object({
    pos: Vec3,
    rot: Vec3.optional(),
    scale: num.optional(),
  }),
  material: z
    .object({
      color: z.enum(PALETTE_SLOTS).optional(),
      glow: num.optional(),
      opacity: num.optional(),
    })
    .optional(),
  verb: z.enum(VERBS),
  sound: SoundRecipe.optional(),
  fx: z.array(z.enum(FX)).max(4).optional(),
  /** Idle animation that makes things feel alive. amp 0..1, freq in Hz; radius for wander/orbit. */
  motion: z.object({ type: z.enum(MOTIONS), amp: num.optional(), freq: num.optional(), phase: num.optional(), radius: num.optional() }).optional(),
  /** What happens when it is played (worlds): effects on itself or on another part. */
  react: z.array(z.object({ do: z.enum(REACTIONS), target: z.string().optional() })).max(3).optional(),
});

/**
 * Shortcut for rows of similar parts (marimba bars, keys, bells, tines).
 * The model writes one part + `repeat`; the engine expands it into `count`
 * parts, each moved by `step`, scaled by `shrink`^k, and tuned up the scale.
 * Cuts both the model's reasoning and its output.
 */
export const Repeat = z.object({
  count: z.number().int().min(2).max(16),
  /** 'line' (default): each copy moved by step. 'radial': copies in a ring of `radius` around the part, facing out. */
  mode: z.enum(['line', 'radial']).optional(),
  step: Vec3.optional(),
  radius: num.optional(),
  scale: z.enum(Object.keys(SCALES) as [ScaleName, ...ScaleName[]]).optional(),
  root: z.string().optional(),
  shrink: num.optional(),
});
export const RepeatedPart = Part.extend({ repeat: Repeat.optional() });

export const Terrain = z.object({
  style: z.enum(TERRAINS),
  radius: num,
  height: num,
  roughness: num.optional(),
  water: z.boolean().optional(),
  seed: num.optional(),
  biome: z.enum(BIOMES).optional(),
  track: z.enum(['circuit', 'oval']).optional(),
});
export const Ambient = z.object({
  particles: z.enum(PARTICLES).optional(),
  light: z.enum(LIGHTS).optional(),
});

export const Creation = z.object({
  id: z.string(),
  /** 'world' = a tiny interactive world on terrain (held in the palm in XR). */
  kind: z.enum(['instrument', 'world']).optional(),
  terrain: Terrain.optional(),
  ambient: Ambient.optional(),
  title: z.string().max(60),
  version: z.number().int().nonnegative().default(1),
  palette: z.enum(PALETTES),
  style: z.enum(STYLES),
  parts: z.array(RepeatedPart).min(1).max(LIMITS.maxParts).transform((parts) => expandParts(parts)),
  narration: z.array(z.string().max(60)).max(24).default([]),
  /** Worlds: where you land when you step inside (x, z in world units), facing the centre. */
  spawn: z.tuple([num, num]).optional(),
});

/** Creation without parts: what the Designer sends first, before streaming parts. */
export const CreationHeader = Creation.pick({ title: true, palette: true, style: true, narration: true, kind: true, terrain: true, ambient: true });

/** Flat patch shape (no unions) so every provider's structured output can produce it. */
export const PartPatch = z.object({
  label: z.string().max(40).optional(),
  shape: Shape.optional(),
  transform: z.object({ pos: Vec3.optional(), rot: Vec3.optional(), scale: num.optional() }).optional(),
  material: Part.shape.material,
  verb: z.enum(VERBS).optional(),
  sound: SoundRecipe.partial().optional(),
  fx: z.array(z.enum(FX)).max(4).optional(),
  motion: Part.shape.motion,
});

export const Edit = z.object({
  op: z.enum(['add', 'update', 'remove', 'set']),
  /** Part id for update/remove. */
  id: z.string().optional(),
  /** Full part for add. */
  part: Part.optional(),
  /** Changes for update. */
  patch: PartPatch.optional(),
  /** Creation-level field for set. */
  field: z.enum(['title', 'palette', 'style']).optional(),
  value: z.string().optional(),
});

export type Vec3T = z.infer<typeof Vec3>;
export type RepeatedPartT = z.infer<typeof RepeatedPart>;

/** Expand `repeat` shortcuts into plain parts (capped at the part limit). */
export function expandParts(parts: readonly RepeatedPartT[]): z.infer<typeof Part>[] {
  const out: z.infer<typeof Part>[] = [];
  for (const { repeat, ...base } of parts) {
    if (!repeat) { out.push(base); continue; }
    const root = repeat.root ?? (typeof base.sound?.pitch === 'string' ? base.sound.pitch : 'C4');
    const radial = repeat.mode === 'radial';
    for (let k = 0; k < repeat.count && out.length < LIMITS.maxParts; k++) {
      const [px, py, pz] = base.transform.pos;
      const [rx, ry, rz] = base.transform.rot ?? [0, 0, 0];
      let pos: [number, number, number];
      let rot: [number, number, number] | undefined = base.transform.rot;
      if (radial) {
        const a = (k / repeat.count) * Math.PI * 2;
        const r = repeat.radius ?? 0.1;
        pos = [px + Math.sin(a) * r, py, pz + Math.cos(a) * r];
        rot = [rx, ry + (a * 180) / Math.PI, rz];
      } else {
        const [sx, sy, sz] = repeat.step ?? [0.06, 0, 0];
        pos = [px + sx * k, py + sy * k, pz + sz * k];
      }
      const note = repeat.scale ? scaleNote(root, repeat.scale, k) : undefined;
      out.push({
        ...structuredClone(base),
        id: `${base.id}-${k + 1}`,
        label: note ?? (base.label ? `${base.label} ${k + 1}` : undefined),
        transform: { ...base.transform, pos, ...(rot ? { rot } : {}), scale: (base.transform.scale ?? 1) * Math.pow(repeat.shrink ?? 1, k) },
        sound: base.sound && note ? { ...base.sound, pitch: note } : base.sound,
        // offset idle motion so copies move as a wave, not in lockstep
        motion: base.motion ? { ...base.motion, phase: (base.motion.phase ?? 0) + k * 0.7 } : undefined,
      });
    }
  }
  return out.slice(0, LIMITS.maxParts);
}

/** Parse one streamed part line that may carry a `repeat`, expanded and sanitised. */
export function parsePartLine(raw: unknown): { parts: z.infer<typeof Part>[]; errors: string[]; fixes: string[] } {
  const parsed = RepeatedPart.safeParse(raw);
  if (!parsed.success) return { parts: [], errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`), fixes: [] };
  const fixes: string[] = [];
  const parts = expandParts([parsed.data]);
  for (const p of parts) sanitizePart(p, fixes);
  return { parts, errors: [], fixes };
}
export type ShapeT = z.infer<typeof Shape>;
export type SoundRecipeT = z.infer<typeof SoundRecipe>;
export type PartT = z.infer<typeof Part>;
export type CreationT = z.infer<typeof Creation>;
export type Verb = (typeof VERBS)[number];
export type CreationHeaderT = z.infer<typeof CreationHeader>;
export type PartPatchT = z.infer<typeof PartPatch>;
export type EditT = z.infer<typeof Edit>;

/** Verbs the engine can play today. The Designer prompt is generated from this list. */
export const SUPPORTED_VERBS: readonly Verb[] = ['strike', 'press', 'none'];
export type Voice = (typeof VOICES)[number];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface ValidationResult {
  ok: boolean;
  creation?: CreationT;
  errors: string[];
  /** Non-fatal fixes the engine applied (reported back to the agent). */
  fixes: string[];
}

/**
 * Parse untrusted spec data, then enforce engine rules the AI must not be
 * trusted with: parts stay inside the play zone, sizes are clamped, and every
 * interactive part makes a sound.
 */
export function validateCreation(raw: unknown): ValidationResult {
  const parsed = Creation.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      fixes: [],
    };
  }
  const creation = parsed.data;
  const fixes: string[] = [];
  if (creation.terrain) {
    creation.kind = 'world';
    creation.terrain.radius = clamp(creation.terrain.radius, 0.08, 0.6);
    creation.terrain.height = clamp(creation.terrain.height, 0, 0.15);
    creation.terrain.roughness = clamp(creation.terrain.roughness ?? 0.4, 0, 1);
  } else if (creation.kind === 'world') {
    creation.terrain = { style: 'island', radius: 0.22, height: 0.06, roughness: 0.4, water: true };
    fixes.push('world without terrain: added an island');
  }
  const ids = new Set<string>();
  for (const part of creation.parts) {
    if (ids.has(part.id)) {
      part.id = `${part.id}-${ids.size}`;
      fixes.push(`renamed duplicate part id to ${part.id}`);
    }
    ids.add(part.id);
    sanitizePart(part, fixes, creation.kind === 'world' ? creation.terrain : undefined);
  }
  return { ok: true, creation, errors: [], fixes };
}

/** Parse one untrusted part (e.g. a streamed NDJSON line) and apply engine rules. */
export function parsePart(raw: unknown): { part?: PartT; errors: string[]; fixes: string[] } {
  const parsed = Part.safeParse(raw);
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`), fixes: [] };
  }
  const fixes: string[] = [];
  sanitizePart(parsed.data, fixes);
  return { part: parsed.data, errors: [], fixes };
}

/** Enforce engine rules on a part in place: play zone, size clamps, sound for interactive parts. */
export function sanitizePart(part: PartT, fixes: string[], terrain?: { radius: number }) {
  const [x, y, zz] = part.transform.pos;
  // Worlds can be bigger than the tabletop play zone: keep parts on (or just off) their land.
  const wr = terrain ? terrain.radius * 1.3 : 0;
  const p: [number, number, number] = terrain
    ? [clamp(x, -wr, wr), clamp(y, -0.05, 0.8), clamp(zz, -wr, wr)]
    : [
      clamp(x, PLAY_ZONE.x[0], PLAY_ZONE.x[1]),
      clamp(y, PLAY_ZONE.y[0], PLAY_ZONE.y[1]),
      clamp(zz, PLAY_ZONE.z[0], PLAY_ZONE.z[1]),
    ];
  if (p[0] !== x || p[1] !== y || p[2] !== zz) fixes.push(`${part.id}: moved inside the play zone`);
  part.transform.pos = p;
  if (part.transform.scale != null) part.transform.scale = clamp(part.transform.scale, 0.25, 3);
  if (part.motion) {
    part.motion.amp = clamp(part.motion.amp ?? 0.5, 0, 1);
    part.motion.freq = clamp(part.motion.freq ?? 0.6, 0.05, 3);
    if (part.motion.radius != null) part.motion.radius = clamp(part.motion.radius, 0.01, 0.3);
  }
  clampShape(part, fixes);
  if (part.shape.kind === 'asset') {
    // Assets are always alive: default sound and reaction from the catalogue.
    const info = ASSET_INFO[part.shape.type];
    if (part.verb === 'none' && part.shape.type !== 'cloud') part.verb = 'strike';
    if (part.verb !== 'none' && !part.sound) part.sound = { ...info.sound } as SoundRecipeT;
    if (!part.react?.length) part.react = [{ do: info.react as (typeof REACTIONS)[number] }];
    if (!part.fx?.length) part.fx = ['squash', 'flash'];
  }
  if (part.verb !== 'none' && !part.sound && !(part.fx && part.fx.length)) {
    part.sound = { voice: 'bell', pitch: 'C5', decay: 0.4 };
    fixes.push(`${part.id}: added a default sound`);
  }
}

function clampShape(part: PartT, fixes: string[]) {
  const s = part.shape;
  const c = (v: number) => clamp(v, LIMITS.minSize, LIMITS.maxSize);
  // Fill optional defaults first so they don't count as clamping.
  if (s.kind === 'tube') { s.taper ??= 0.5; s.curl ??= 0; s.wave ??= 0; }
  if (s.kind === 'blob') { s.lumps ??= 0.3; s.squash ??= 1; }
  const before = JSON.stringify(s);
  switch (s.kind) {
    case 'cylinder':
    case 'cone':
      s.radius = c(s.radius);
      s.height = c(s.height);
      break;
    case 'box':
      s.size = [c(s.size[0]), c(s.size[1]), c(s.size[2])];
      break;
    case 'sphere':
      s.radius = c(s.radius);
      break;
    case 'torus':
      s.radius = c(s.radius);
      s.tube = c(s.tube);
      break;
    case 'capsule':
      s.radius = c(s.radius);
      s.length = c(s.length);
      break;
    case 'lathe':
      s.profile = s.profile.map(([r, y]) => [clamp(r, 0, LIMITS.maxSize), clamp(y, 0, LIMITS.maxSize)] as [number, number])
        .sort((a, b) => a[1] - b[1]);
      break;
    case 'tube':
      s.length = c(s.length);
      s.radius = clamp(s.radius, 0.003, 0.08);
      s.taper = clamp(s.taper ?? 0.5, 0, 0.95);
      s.curl = clamp(s.curl ?? 0, 0, 1);
      s.wave = clamp(s.wave ?? 0, 0, 1);
      break;
    case 'blob':
      s.radius = c(s.radius);
      s.lumps = clamp(s.lumps ?? 0.3, 0, 1);
      s.squash = clamp(s.squash ?? 1, 0.3, 2);
      break;
    case 'frustum':
      s.top = c(s.top);
      s.bottom = c(s.bottom);
      s.height = c(s.height);
      break;
    case 'asset':
      s.size = clamp(s.size, 0.01, LIMITS.maxSize);
      break;
  }
  if (JSON.stringify(s) !== before) fixes.push(`${part.id}: size clamped`);
}
