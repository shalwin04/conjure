/**
 * Story games: every world becomes a short, cozy quest the user plays inside it.
 *
 * A game has up to 5 chapters. A chapter with no `place` happens on the world
 * the user conjured ("home"); a chapter with a `place` happens in a new spot
 * the engine builds in its `direction`. Each chapter is one kind of play:
 *
 *   wake     touch the target thing           talk    touch a character (they speak)
 *   find     just reach the place             collect gather `count` glowing items
 *   melody   listen to a tune and play it back on bells
 *   choose   pick one of two things; the choice changes the ending
 *   gates    pass through glowing gates in order (a race, a parade, a flight)
 *   seek     find a shy someone who hides three times (hide and seek)
 *
 * The engine (not the model) places collectibles, bells and choices, so every
 * chapter is always playable. Shared by the server (Story Director, World
 * Planner) and the headset (StoryRunner). `templateStory` needs no model.
 */
import { z } from 'zod';
import type { CreationT } from './schema.js';

export const DIRECTIONS = ['north', 'east', 'south', 'west'] as const;
export const CHAPTER_KINDS = ['wake', 'talk', 'find', 'collect', 'melody', 'choose', 'gates', 'seek'] as const;
export type ChapterKind = (typeof CHAPTER_KINDS)[number];

export const ChoiceOption = z.object({
  /** What it is ("the sleeping lantern"). */
  label: z.string().max(40),
  /** Said when chosen. */
  payoff: z.string().max(240),
  /** Replaces the story's ending when this was chosen. */
  ending: z.string().max(320).optional(),
});

export const Chapter = z.object({
  title: z.string().max(60),
  kind: z.enum(CHAPTER_KINDS).default('wake'),
  /** What to do, as a short instruction ("Wake the sleeping volcano"). */
  goal: z.string().max(80),
  /** One sentence the narrator says to point the way. */
  hint: z.string().max(200),
  /** wake/talk at home: a part id of the world. In a new place: the name of the thing. collect: the item name. */
  target: z.string().max(40),
  /** A new place: what it looks like (fed to the world builder). Absent = at home. */
  place: z.string().max(240).optional(),
  direction: z.enum(DIRECTIONS).optional(),
  /** Narration when the user arrives at the place. */
  arrive: z.string().max(240).optional(),
  /** Narration when the goal is done. */
  payoff: z.string().max(240),
  /** collect: how many. */
  count: z.number().int().min(2).max(5).optional(),
  /** choose: exactly two options. */
  options: z.array(ChoiceOption).length(2).optional(),
  /** Who speaks in a talk chapter. */
  speaker: z.string().max(30).optional(),
  /** What the chapter's items, goal or hider look like: an asset type from the catalogue. */
  item: z.string().max(20).optional(),
});
export type ChapterT = z.infer<typeof Chapter>;

export const Story = z.object({
  title: z.string().max(60),
  intro: z.string().max(320),
  chapters: z.array(Chapter).min(2).max(5),
  ending: z.string().max(320),
});
export type StoryT = z.infer<typeof Story>;

/** What the Story Director needs to know about a world. */
export interface StoryRequest {
  world: Pick<CreationT, 'title' | 'palette' | 'style' | 'terrain' | 'ambient'>;
  parts: { id: string; label: string; kind: string }[];
  wish?: string | null;
}

export function storyRequestFor(world: CreationT, wish?: string | null): StoryRequest {
  return {
    world: { title: world.title, palette: world.palette, style: world.style, terrain: world.terrain, ambient: world.ambient },
    parts: world.parts
      .filter((p) => p.verb !== 'none')
      .slice(0, 30)
      .map((p) => ({ id: p.id, label: p.label ?? p.id, kind: p.shape.kind === 'asset' ? p.shape.type : p.shape.kind })),
    wish: wish ?? null,
  };
}

const HERO_ORDER = ['volcano', 'portal', 'castle', 'lighthouse', 'statue', 'crystal', 'well', 'campfire', 'mountain', 'tower', 'cottage', 'character'];
function pickHero(req: StoryRequest, not?: string) {
  for (const k of HERO_ORDER) { const p = req.parts.find((q) => q.kind === k && q.id !== not); if (p) return p; }
  return req.parts.find((p) => p.id !== not) ?? req.parts[0];
}

/** Map a model's target (an id, a label, a group id) to a real part id of the world. */
function resolveTarget(target: string, req: StoryRequest, kind: ChapterKind): string {
  const ids = new Set(req.parts.map((p) => p.id));
  if (ids.has(target)) return target;
  const t = target.toLowerCase();
  const hit = req.parts.find((p) => p.id.startsWith(`${target}-`)) ?? req.parts.find((p) => p.label.toLowerCase() === t)
    ?? req.parts.find((p) => p.label.toLowerCase().includes(t) || t.includes(p.label.toLowerCase()));
  if (hit) return hit.id;
  if (kind === 'talk') return req.parts.find((p) => p.kind === 'character')?.id ?? pickHero(req)?.id ?? target;
  return pickHero(req)?.id ?? target;
}

/** Make a model's story playable: real targets at home, places with directions, valid kinds. */
export function fixStory(story: StoryT, req: StoryRequest): StoryT {
  const chapters = story.chapters.map((c, i) => {
    const kind: ChapterKind = c.kind === 'choose' && c.options?.length !== 2 ? 'wake' : c.kind;
    const home = i === 0 || !c.place;
    const fixed: ChapterT = { ...c, kind, place: home ? undefined : c.place, direction: home ? undefined : c.direction ?? DIRECTIONS[i % 4] };
    if (home && (kind === 'wake' || kind === 'talk')) fixed.target = resolveTarget(c.target, req, kind);
    if (home && kind === 'find') fixed.kind = 'wake';
    if (kind === 'collect' || kind === 'seek') fixed.count = c.count ?? 3;
    if (kind === 'gates') fixed.count = Math.max(3, c.count ?? 4);
    return fixed;
  });
  return { ...story, chapters };
}

type Middle = Omit<ChapterT, 'direction'>;

/** Middle chapters the template mixes, so offline stories differ from world to world. */
function middles(t: string, b: string): Middle[] {
  const scene = b === 'city' ? 'a little square between tall houses' : b === 'desert' ? 'a ring of warm dunes' : b === 'snow' ? 'a frosted clearing' : 'a quiet meadow';
  return [
    {
      title: 'Lost Lights', kind: 'collect', goal: 'Gather the lost lights', target: 'Lost light', count: 3,
      hint: 'Little lights are hiding nearby. Follow the wisp.', place: `${scene} where little lights hide`,
      arrive: 'Little lights blink at you, shy but curious.', payoff: 'The lights gather in your hands and settle into a warm glow.',
    },
    {
      title: 'The Bell Song', kind: 'melody', goal: 'Play the bells back', target: 'Glass bells',
      hint: 'Listen to the bells, then play the same song back.', place: `${scene} with glass bells hanging from lanterns`,
      arrive: 'Glass bells chime in the breeze, as if they are trying to say something.', payoff: 'The bells sing with you, and everything glows.',
    },
    {
      title: 'The Gate Run', kind: 'gates', goal: 'Run through the glowing gates', target: 'Glowing gate', count: 4,
      hint: 'Glowing gates are waiting. Pass through each one, in order.', place: `${scene} with a winding path of glowing gates`,
      arrive: 'A row of glowing gates hums in the air. Ready, steady, go!', payoff: 'Whoosh! The last gate bursts into sparkles. What a run!',
    },
    {
      title: 'Hide and Seek', kind: 'seek', goal: 'Find Pip, who loves to hide', target: 'Pip', count: 3, item: 'character',
      hint: 'Pip giggles somewhere close. Look behind things!', place: `${scene} full of good hiding places`,
      arrive: 'Somewhere nearby, someone small is trying very hard not to giggle.', payoff: 'Pip laughs and hugs you. Best game ever!',
    },
    {
      title: 'Two Paths', kind: 'choose', goal: 'Choose where the songs should go', target: 'Choice',
      hint: 'Touch the lantern or the crystal. There is no wrong choice.', place: `${scene} with a lantern and a crystal waiting side by side`,
      arrive: 'A lantern and a crystal wait side by side, glowing softly.', payoff: 'Your choice settles warmly in the air.',
      options: [
        { label: 'The warm lantern', payoff: 'The lantern flickers happily. The songs will light every home.', ending: `${t} glows every evening now, a little lantern in every window.` },
        { label: 'The singing crystal', payoff: 'The crystal rings like laughter. The songs will travel on the wind.', ending: `Now the wind carries ${t}'s songs to every corner, and everyone hums along.` },
      ],
    },
  ];
}

/** A playable 5-chapter game from the world alone (offline / replay mode, or if the model fails). */
export function templateStory(req: StoryRequest): StoryT {
  const hero = pickHero(req);
  const keeper = req.parts.find((p) => p.kind === 'character');
  const t = req.world.title;
  const heroName = (hero?.label ?? 'heart of the world').toLowerCase();
  // Pick three different middle chapters (always including a choice) from the world's name.
  let h = 0;
  for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const pool = middles(t, req.world.terrain?.biome ?? 'meadow');
  const choose = pool.find((m) => m.kind === 'choose')!;
  const rest = pool.filter((m) => m !== choose);
  const a = rest[h % rest.length], b = rest[(h + 1 + (h >> 3) % (rest.length - 1)) % rest.length];
  const picks = [a, b === a ? rest[(h + 2) % rest.length] : b, choose];
  const dirs = (['north', 'east', 'south', 'west'] as const);
  return {
    title: `The Songs of ${t}`,
    intro: `Long ago, ${t} sang every evening. One night its songs drifted away like fireflies. Let's find them together.`,
    chapters: [
      {
        title: 'The First Song', kind: 'wake', goal: `Wake the ${heroName}`,
        hint: `The ${heroName} is waiting. Go and touch it.`, target: hero?.id ?? 'unknown',
        payoff: `The ${heroName} hums softly. Somewhere far away, something hums back.`,
      },
      ...picks.map((m, k) => ({ ...m, direction: dirs[(h + k) % 4] })),
      {
        title: 'Home Again', kind: 'talk', goal: keeper ? `Tell ${keeper.label} the news` : 'Return home', target: keeper?.id ?? hero?.id ?? 'unknown',
        hint: 'Head home and share what you found.', speaker: keeper?.label,
        payoff: 'Thank you, friend. You brought the songs home.',
      },
    ],
    ending: `${t} is singing again, every hill and wave of it. And it is yours to keep exploring.`,
  };
}

/** Why the last story was rejected (logged by the server). */
export let storyProblem = '';

/** Accept a story from a model leniently: nulls, missing lines, long lines and odd kinds are all repaired. */
export function coerceStory(raw: unknown): StoryT | null {
  if (!raw || typeof raw !== 'object') { storyProblem = 'no story'; return null; }
  const str = (v: unknown, n: number, fallback?: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : fallback);
  const r = raw as Record<string, unknown>;
  const title = str(r.title, 60, 'A Little Adventure')!;
  const chapters = Array.isArray(r.chapters) ? r.chapters.slice(0, 5).filter((c) => c && typeof c === 'object').map((c: Record<string, unknown>, i: number) => {
    const rawKind = typeof c.kind === 'string' ? c.kind.toLowerCase().trim() : '';
    let kind = (CHAPTER_KINDS as readonly string[]).includes(rawKind) ? rawKind : rawKind === 'race' ? 'gates' : rawKind === 'hide' || rawKind === 'hide and seek' ? 'seek' : 'wake';
    const options = Array.isArray(c.options) && c.options.length >= 2
      ? c.options.slice(0, 2).map((o: unknown, k: number) => {
        const oo = (o && typeof o === 'object' ? o : { label: String(o) }) as Record<string, unknown>;
        const label = str(oo.label, 40, k ? 'The second way' : 'The first way')!;
        return { label, payoff: str(oo.payoff, 240, `You choose ${label.toLowerCase()}.`)!, ending: str(oo.ending, 320) };
      })
      : undefined;
    if (kind === 'choose' && !options) kind = 'wake';
    const count = typeof c.count === 'number' && Number.isFinite(c.count) ? Math.min(5, Math.max(2, Math.round(c.count))) : undefined;
    const ctitle = str(c.title, 60, `Chapter ${i + 1}`)!;
    const goal = str(c.goal, 80, ctitle)!;
    const direction = typeof c.direction === 'string' && (DIRECTIONS as readonly string[]).includes(c.direction.toLowerCase()) ? c.direction.toLowerCase() : undefined;
    return {
      title: ctitle, kind, goal,
      hint: str(c.hint, 200, goal)!,
      target: str(c.target, 40, ctitle)!,
      place: str(c.place, 240), direction, arrive: str(c.arrive, 240),
      payoff: str(c.payoff, 240, 'Well done. The story goes on.')!,
      count, options, speaker: str(c.speaker, 30), item: str(c.item, 20),
    };
  }) : [];
  const parsed = Story.safeParse({ title, intro: str(r.intro, 320, `Welcome to ${title}.`), chapters, ending: str(r.ending, 320, 'And the adventure goes on. Keep exploring.') });
  storyProblem = parsed.success ? '' : parsed.error.issues.slice(0, 3).map((x) => `${x.path.join('.')}: ${x.message}`).join('; ');
  return parsed.success ? parsed.data : null;
}
