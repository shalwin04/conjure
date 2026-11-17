/**
 * Scene plans and the layout solver: Conjure's Holodeck-style world engine.
 *
 * Holodeck (CVPR 2024) showed that language models are good at deciding WHAT
 * belongs in a scene and HOW things relate, and bad at writing coordinates.
 * So the World Planner (LLM) writes a ScenePlan: terrain, a list of object
 * groups (real assets, counts, sizes) with spatial relations ("around the
 * well", "on the shore", "in a row", "scattered in the north"), and the story.
 * This solver turns it into a world deterministically: real-world sizes,
 * constraint-based placement on dry land, no overlaps, things facing what they
 * should, and a landing spot with a view. Shared by server and headset, unit-tested.
 */
import { z } from 'zod';
import { scaleNote } from './music.js';
import {
  ASSET_INFO, ASSETS, BIOMES, LIGHTS, PALETTES, PARTICLES, REACTIONS, SoundRecipe, STYLES, TERRAINS,
  type AssetType, type CreationT, type PartT,
} from './schema.js';
import { coerceStory, type StoryT } from './story.js';
import { faceStreet, onRoad } from '../engine/city.js';
import { TRACK_WIDTH, trackDistance, trackFrame, trackLoop } from '../engine/track.js';

/** The north–south avenue east of the centre (a chunk edge) where city visitors arrive. */
const CITY_ROAD_X = 0.32;
import { isDry, terrainHeight, waterLevel, type TerrainT } from '../engine/terrain.js';

/** Inside a world, 1 world unit = this many metres (the immersive scale). */
export const METRES_PER_UNIT = 40;

/** Typical real heights in metres: the solver sizes everything realistically. */
export const REAL_HEIGHT: Record<AssetType, number> = {
  oak: 9, pine: 11, aspen: 8, ash: 10, bush: 1.3, palm: 8, rock: 1.4, volcano: 26, mountain: 30,
  cottage: 6, tower: 13, lighthouse: 15, castle: 16, campfire: 0.8, lantern: 2.4, mushroom: 0.6,
  crystal: 1.6, flower: 0.5, character: 1.75, portal: 4, well: 2.4, boat: 3, statue: 3.2, cloud: 7,
  maple: 9, snowpine: 11, building: 11, skyscraper: 26, car: 1.5, streetlamp: 4, bench: 0.9, cactus: 3.2, tent: 2.4,
  windmill: 12, stall: 2.6, fountain: 2.2, balloon: 9,
  racecar: 1, grandstand: 9, floodlight: 22, gantry: 5, tyres: 1, garage: 6,
};

/** Small animals and birds are drawn from primitives. */
export const CREATURES = ['creature', 'bird', 'fish'] as const;
const PLAN_ASSETS = [...ASSETS, ...CREATURES] as unknown as [string, ...string[]];

export const PLACES = ['center', 'near', 'around', 'row', 'scattered', 'edge', 'shore', 'water', 'behind', 'in_front', 'sky', 'trackside', 'on_track'] as const;
export const ZONES = ['center', 'north', 'south', 'east', 'west', 'anywhere'] as const;
export const SIZES = ['tiny', 'small', 'medium', 'large', 'giant'] as const;
const SIZE_MUL: Record<(typeof SIZES)[number], number> = { tiny: 0.4, small: 0.7, medium: 1, large: 1.45, giant: 2.2 };
const WORLD_RADIUS = { small: 0.3, medium: 0.42, large: 0.56 } as const;

export const PlanObject = z.object({
  id: z.string().min(1),
  label: z.string(),
  asset: z.enum(PLAN_ASSETS),
  count: z.number().int().min(1).max(12).optional(),
  size: z.enum(SIZES).optional(),
  /** How it is placed. near/around/behind/in_front need a target object id. */
  place: z.enum(PLACES),
  target: z.string().optional(),
  zone: z.enum(ZONES).optional(),
  motion: z.enum(['wander', 'orbit', 'bob', 'sway', 'none']).optional(),
  sound: SoundRecipe.optional(),
  react: z.enum(REACTIONS).optional(),
});
export type PlanObjectT = z.infer<typeof PlanObject>;

export const ScenePlan = z.object({
  title: z.string(),
  palette: z.enum(PALETTES),
  style: z.enum(STYLES),
  narration: z.array(z.string()).optional(),
  terrain: z.object({
    style: z.enum(TERRAINS),
    size: z.enum(['small', 'medium', 'large']),
    water: z.boolean(),
    hilly: z.boolean().optional(),
    /** meadow | forest | autumn | snow | desert | tropical | city | village | fantasy */
    biome: z.enum(BIOMES).optional(),
    /** A race track looping around the world: circuit (twisty, F1) or oval (speedway). */
    track: z.enum(['circuit', 'oval']).optional(),
  }),
  ambient: z.object({ particles: z.enum(PARTICLES).optional(), light: z.enum(LIGHTS).optional() }).optional(),
  objects: z.array(PlanObject).min(2).max(18),
  /** Checked separately (coerceStory), so a long line can't sink the whole world. */
  story: z.any().optional(),
});
export type ScenePlanT = z.infer<typeof ScenePlan>;

// ---------------------------------------------------------------------------

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Height (world units) and footprint radius of one object. */
export function objectSize(o: Pick<PlanObjectT, 'asset' | 'size'>, worldRadius: number) {
  const mul = SIZE_MUL[o.size ?? 'medium'];
  if (o.asset === 'creature') return { h: 0.012 * mul, r: 0.012 * mul };
  if (o.asset === 'bird') return { h: 0.006 * mul, r: 0.008 * mul };
  if (o.asset === 'fish') return { h: 0.006 * mul, r: 0.009 * mul };
  const type = o.asset as AssetType;
  let h = (REAL_HEIGHT[type] / METRES_PER_UNIT) * mul;
  // Landmarks never swallow the whole world.
  h = Math.min(h, worldRadius * (BIG.has(type) ? 0.75 : 0.9), 0.64);
  // Trees: canopies may overlap, only trunks need room.
  const footprint = TREES.has(type) ? 0.45 : BIG.has(type) ? 0.55 : 1;
  return { h, r: h * ASSET_INFO[type].aspect * footprint };
}

const TREES = new Set<string>(['oak', 'pine', 'aspen', 'ash', 'palm', 'maple', 'snowpine']);
/** Things that belong on the street in a city (everything else keeps off the road). */
const STREET = new Set<string>(['car', 'streetlamp', 'bench', 'character', 'creature', 'bird', 'cloud', 'balloon']);
const FACES_STREET = new Set<string>(['building', 'skyscraper', 'stall', 'cottage', 'tower', 'castle']);
/** Terrain-sized landmarks: may stand at the island's edge, half in the sea. */
const BIG = new Set<string>(['volcano', 'mountain']);

interface Placed { id: string; x: number; z: number; r: number; asset: string }

/** Order so every target is placed before the things that refer to it. */
function orderObjects(objects: PlanObjectT[]): PlanObjectT[] {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const out: PlanObjectT[] = [];
  const seen = new Set<string>();
  const visit = (o: PlanObjectT, depth = 0) => {
    if (seen.has(o.id) || depth > 20) return;
    if (o.target && byId.has(o.target) && o.target !== o.id) visit(byId.get(o.target)!, depth + 1);
    seen.add(o.id);
    out.push(o);
  };
  // Big centre pieces first, then everything else.
  for (const o of objects.filter((q) => q.place === 'center')) visit(o);
  for (const o of objects) visit(o);
  return out;
}

const ZONE_DIR: Record<(typeof ZONES)[number], [number, number] | null> = {
  center: [0, 0], north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0], anywhere: null,
};

export interface SolvedWorld { creation: CreationT; story?: StoryT; notes: string[] }

/** Turn a ScenePlan into a placed, playable world. Deterministic for (plan, seed). */
export function solveScene(plan: ScenePlanT, id: string, seedText = plan.title): SolvedWorld {
  plan = {
    ...plan,
    title: plan.title.slice(0, 60),
    narration: (plan.narration ?? []).slice(0, 5).map((n) => n.slice(0, 60)),
    objects: plan.objects.slice(0, 18).map((o) => ({ ...o, id: o.id.replace(/[^a-z0-9-]/gi, '-').slice(0, 24) || 'thing', label: o.label.slice(0, 32) })),
  };
  const rand = rng(hash(seedText));
  const R = WORLD_RADIUS[plan.terrain.size];
  const biome = plan.terrain.biome;
  const city = biome === 'city';
  // A city stands on level ground with no sea in its streets.
  const style = city ? 'flat' : plan.terrain.style;
  const terrain: TerrainT = {
    style, radius: R,
    height: style === 'flat' ? 0.012 : plan.terrain.hilly || style === 'hill' ? 0.05 : 0.03,
    roughness: city ? 0.1 : plan.terrain.hilly ? 0.6 : 0.4,
    water: city ? false : plan.terrain.water,
    seed: hash(plan.title) % 97,
    ...(biome ? { biome } : {}),
    ...(plan.terrain.track ? { track: plan.terrain.track } : {}),
  };
  if (terrain.track) { terrain.water = false; terrain.style = 'flat'; terrain.height = 0.012; }
  const loop = trackLoop(terrain);
  const offTrack = (x: number, z: number, r: number) => !loop || trackDistance(loop, x, z) > TRACK_WIDTH / 2 + r + 0.01;
  const notes: string[] = [];
  const placed: Placed[] = [];
  const parts: PartT[] = [];
  // In a city you arrive in the street, looking up the avenue at the heart of the place.
  // On a race track you land on the grid, looking down the start straight.
  const spawn: [number, number] = loop ? [loop[0][0] - TRACK_WIDTH * 0.2, loop[0][1] + 0.12] : city ? [CITY_ROAD_X, R * 0.9] : findSpawn(terrain, R);
  const onTrack = new Map<string, number>(); // part id -> loop index (for heading)
  const dry = (x: number, z: number) => isDry(terrain, x, z, 0.004) && Math.hypot(x, z) < R * 0.97;
  const wet = (x: number, z: number) => !isDry(terrain, x, z, 0.002) && Math.hypot(x, z) < R * 1.25;
  // View constraint: keep a clear sightline from where you land to the heart of the world,
  // so the first thing you see is the place, not the back of a house.
  const inView = (x: number, z: number, r: number) => r > 0.025 && Math.abs(x - spawn[0] * (z / spawn[1])) < r + 0.035 && z > 0.03 && z < spawn[1] + r;
  const free = (x: number, z: number, r: number) =>
    placed.every((p) => Math.hypot(p.x - x, p.z - z) >= p.r + r + 0.004) && Math.hypot(x - spawn[0], z - spawn[1]) > r + 0.03 && !inView(x, z, r);

  for (const o of orderObjects(plan.objects)) {
    const count = o.count ?? 1;
    const { h, r } = objectSize(o, R);
    const target = o.target ? placed.find((p) => p.id === o.target || p.id === `${o.target}-1`) : undefined;
    const zone = ZONE_DIR[o.zone ?? 'anywhere'];
    const big = BIG.has(o.asset);
    const zoneC: [number, number] = zone ? [zone[0] * R * (big ? 1.0 : 0.5), zone[1] * R * (big ? 1.0 : 0.5)] : [0, 0];
    const zoneR = zone ? R * (zone[0] || zone[1] ? 0.42 : 0.35) : R * 0.92;
    const rowDir = rand() * Math.PI;
    let made = 0;

    for (let k = 0; k < count; k++) {
      let spot: [number, number] | null = null;
      for (let attempt = 0; attempt < 90 && !spot; attempt++) {
        const relax = attempt > 30; // last tries: anywhere free
        let x: number, z: number;
        const a = rand() * Math.PI * 2;
        const place = relax ? 'scattered' : o.place;
        switch (place) {
          case 'center': x = zoneC[0] + (rand() - 0.5) * 0.04 * attempt / 10; z = zoneC[1] + (rand() - 0.5) * 0.04 * attempt / 10; break;
          case 'near': case 'around': case 'behind': case 'in_front': {
            const t = target ?? { x: zoneC[0], z: zoneC[1], r: 0 };
            const gap = 0.012 + rand() * 0.03 + attempt * 0.002;
            const d = t.r + r + gap;
            // Rings start away from the sightline and slide around it if a spot is taken.
            let ang = place === 'around' ? Math.PI / 4 + (2 * Math.PI * k) / count + (attempt % 2 ? 1 : -1) * attempt * 0.12 + (rand() - 0.5) * 0.2 : a;
            if (place === 'in_front') ang = Math.PI / 2 + (rand() - 0.5) * 1.2; // toward the spawn side (+z)
            if (place === 'behind') ang = -Math.PI / 2 + (rand() - 0.5) * 1.2;
            x = t.x + Math.cos(ang) * d; z = t.z + Math.sin(ang) * d;
            break;
          }
          case 'row': {
            const step = 2 * r + 0.012;
            const off = (k - (count - 1) / 2) * step;
            const base = target ? [target.x, target.z + target.r + r + 0.02] : zoneC;
            x = base[0] + Math.cos(rowDir) * off + (attempt ? (rand() - 0.5) * 0.02 * attempt : 0);
            z = base[1] + Math.sin(rowDir) * off + (attempt ? (rand() - 0.5) * 0.02 * attempt : 0);
            break;
          }
          case 'edge': { const d = R * (0.78 + rand() * 0.15); x = Math.cos(a) * d; z = Math.sin(a) * d; break; }
          case 'shore': {
            const d = R * (0.6 + rand() * 0.38); x = Math.cos(a) * d; z = Math.sin(a) * d;
            if (terrain.water && terrainHeight(terrain, x, z) > waterLevel(terrain) + 0.012) continue;
            break;
          }
          case 'water': { const d = R * (0.85 + rand() * 0.35); x = Math.cos(a) * d; z = Math.sin(a) * d; break; }
          case 'sky': { const d = R * rand() * 0.6; x = Math.cos(a) * d; z = Math.sin(a) * d; break; }
          case 'trackside': case 'on_track': {
            if (!loop) { const d = R * (0.78 + rand() * 0.15); x = Math.cos(a) * d; z = Math.sin(a) * d; break; }
            // Spread around the lap (the grid and the start are near index 0).
            const j = place === 'on_track'
              ? (o.asset === 'gantry' ? 6 : 10 + k * 7 + Math.floor(attempt / 3) * 3)
              : Math.floor((loop.length * (k + 0.5 + rand() * 0.4)) / count + attempt * 4) % loop.length;
            const f = trackFrame(loop, j);
            const off = place === 'on_track' ? (o.asset === 'gantry' ? 0 : (k % 2 ? 1 : -1) * TRACK_WIDTH * 0.22) : TRACK_WIDTH / 2 + r + 0.02;
            x = f.x + f.nx * off; z = f.z + f.nz * off;
            onTrack.set(count > 1 ? `${o.id}-${k + 1}` : o.id, j);
            if (place === 'on_track') { spot = [x, z]; break; }
            if (!free(x, z, r)) continue;
            spot = [x, z];
            break;
          }
          case 'scattered':
          default: {
            // When relaxing, anywhere on the land will do.
            const zc = relax ? [0, 0] : zoneC, zr = relax ? R * 0.92 : zoneR;
            const d = Math.sqrt(rand()) * zr; x = zc[0] + Math.cos(a) * d; z = zc[1] + Math.sin(a) * d;
          }
        }
        const inWater = o.place === 'water' || o.asset === 'boat' || o.asset === 'fish';
        if (o.place === 'sky' || o.asset === 'bird' || o.asset === 'cloud') { spot = [x, z]; break; }
        if (!big && (inWater ? (terrain.water ? !wet(x, z) : !dry(x, z)) : !dry(x, z))) continue;
        if (spot) break;
        if (city && !STREET.has(o.asset) && onRoad(x, z, r * 0.6)) continue;
        if (!offTrack(x, z, r) && !(o.asset === 'racecar' || o.asset === 'gantry' || o.asset === 'bird' || o.asset === 'cloud' || o.asset === 'character')) continue;
        if (city && o.asset === 'car' && !onRoad(x, z, -0.02)) continue;
        if (!free(x, z, r)) continue;
        spot = [x, z];
      }
      if (!spot) { notes.push(`no room for ${o.id} #${k + 1}`); continue; }
      const pid = count > 1 ? `${o.id}-${k + 1}` : o.id;
      placed.push({ id: pid, x: spot[0], z: spot[1], r, asset: o.asset });
      const part = makePart(o, pid, spot, h, r, k, count, target, spawn, R, rand, city);
      const j = onTrack.get(pid);
      if (loop && j != null) {
        const f = trackFrame(loop, j);
        // Cars point down the track, the gantry spans it, stands and garages face it.
        const yaw = o.asset === 'racecar' ? f.yaw - 90 : o.asset === 'gantry' ? f.yaw : (Math.atan2(-f.nx, -f.nz) * 180) / Math.PI;
        part.transform.rot = [0, yaw, 0];
      }
      parts.push(part);
      made++;
    }
    if (made === 0) notes.push(`could not place ${o.id}`);
  }

  const creation: CreationT = {
    id, version: 1, kind: 'world', title: plan.title, palette: plan.palette, style: plan.style,
    terrain, ambient: { particles: plan.ambient?.particles ?? 'none', light: plan.ambient?.light ?? 'day' },
    narration: plan.narration ?? [], parts, spawn,
  };
  return { creation, story: coerceStory(plan.story) ?? undefined, notes };
}

function makePart(
  o: PlanObjectT, id: string, [x, z]: [number, number], h: number, r: number, k: number, count: number,
  target: Placed | undefined, spawn: [number, number], R: number, rand: () => number, city = false,
): PartT {
  // Face what matters: characters and buildings look at their target, or toward where you arrive.
  const look = target ?? (o.place === 'center' ? null : { x: spawn[0], z: spawn[1] });
  let yaw = look ? (Math.atan2(look.x - x, look.z - z) * 180) / Math.PI : rand() * 360;
  // City buildings line up with the streets.
  if (city && FACES_STREET.has(o.asset)) yaw = faceStreet(x, z);
  if (city && o.asset === 'car') yaw = Math.abs(((x / 0.64 + 0.5) % 1 + 1) % 1 - 0.5) > 0.4 ? 90 : 0;
  const sound = o.sound ?? (o.asset in ASSET_INFO ? undefined : { voice: 'fx' as const, pitch: 600 + k * 80, decay: 0.25 });
  // Groups sing a scale together instead of one note.
  const tuned = count > 1 && sound && typeof sound.pitch !== 'number' && sound.voice !== 'noise' && sound.voice !== 'membrane'
    ? { ...sound, pitch: scaleNote(typeof sound.pitch === 'string' ? sound.pitch : 'C5', 'pentatonic', k) } : sound;
  const motion = o.motion && o.motion !== 'none'
    ? { type: o.motion, radius: o.motion === 'orbit' ? Math.min(R * 0.6, 0.06 + rand() * 0.1) : 0.03 + rand() * 0.03, freq: 0.3 + rand() * 0.2 }
    : o.asset === 'creature' ? { type: 'wander' as const, radius: 0.04, freq: 0.4 }
    : o.asset === 'bird' ? { type: 'orbit' as const, radius: 0.06 + rand() * 0.1, freq: 0.35 } : undefined;
  const base: Omit<PartT, 'shape'> = {
    id, label: o.label + (count > 1 ? ` ${k + 1}` : ''),
    transform: { pos: [x, o.asset === 'bird' ? 0.12 + rand() * 0.1 : o.asset === 'cloud' ? 0.3 + rand() * 0.15 : 0, z], rot: [0, yaw, 0] },
    verb: 'strike',
    sound: tuned,
    react: o.react ? [{ do: o.react }] : undefined,
    motion,
  };
  if (o.asset === 'creature') {
    return { ...base, shape: { kind: 'blob', radius: h, lumps: 0.35, squash: 0.6 }, material: { color: 'accent' }, fx: ['squash'], react: base.react ?? [{ do: 'jump' }] };
  }
  if (o.asset === 'bird') {
    return { ...base, shape: { kind: 'capsule', radius: h * 0.5, length: h * 1.8 }, material: { color: 'base' }, fx: ['flash'], react: base.react ?? [{ do: 'spin' }] };
  }
  if (o.asset === 'fish') {
    return { ...base, shape: { kind: 'blob', radius: h, lumps: 0.1, squash: 0.45 }, material: { color: 'accentBlue', glow: 0.2 }, react: base.react ?? [{ do: 'jump' }], motion: base.motion ?? { type: 'wander', radius: 0.05, freq: 0.5 } };
  }
  return { ...base, shape: { kind: 'asset', type: o.asset as AssetType, size: h, variant: k } };
}

/** Where you land: on the near (+z) shore, inside the land, with the world in front of you. */
function findSpawn(t: TerrainT, R: number): [number, number] {
  for (let d = R * 0.92; d > R * 0.3; d -= R * 0.03) {
    if (isDry(t, 0, d, 0.004)) return [0, d];
  }
  return [0, R * 0.5];
}

/** Every object id the story may refer to (the first instance of a group). */
export function planTargets(plan: ScenePlanT) {
  return plan.objects.map((o) => ((o.count ?? 1) > 1 ? `${o.id}-1` : o.id));
}
