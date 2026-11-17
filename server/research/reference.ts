/**
 * Reference cards: what a real object looks like, in terms the Designer can
 * build from (anatomy, counts, proportions, colours, motion). Comes from a
 * small verified library, a per-process cache, or grounded web research.
 */
import { z } from 'zod';

export const ReferencePart = z.object({
  name: z.string().max(60),
  shape: z.string().max(160).optional(),
  count: z.string().max(40).optional(),
  size: z.string().max(160).optional(),
  color: z.string().max(100).optional(),
});

export const ReferenceCard = z.object({
  subject: z.string().max(80),
  summary: z.string().max(600),
  parts: z.array(ReferencePart).max(10).default([]),
  proportions: z.array(z.string().max(200)).max(8).default([]),
  colors: z.string().max(240).optional(),
  materials: z.string().max(240).optional(),
  motion: z.string().max(240).optional(),
  sound: z.string().max(240).optional(),
  sources: z.array(z.object({ title: z.string().max(160).optional(), url: z.string().max(500) })).max(8).default([]),
});
export type ReferenceCardT = z.infer<typeof ReferenceCard>;
export type ReferenceSource = 'library' | 'cache' | 'web' | 'model';

/** Compact text for prompts. */
export function formatCard(c: ReferenceCardT): string {
  return [
    `Subject: ${c.subject}. ${c.summary}`,
    c.parts.length ? `Parts: ${c.parts.map((p) => [p.name, p.count && `×${p.count}`, p.shape, p.size, p.color].filter(Boolean).join(', ')).join(' | ')}` : '',
    c.proportions.length ? `Proportions: ${c.proportions.join('; ')}` : '',
    c.colors ? `Colours: ${c.colors}` : '',
    c.materials ? `Materials: ${c.materials}` : '',
    c.motion ? `Motion: ${c.motion}` : '',
    c.sound ? `Sound idea: ${c.sound}` : '',
  ].filter(Boolean).join('\n');
}

/** Hand-checked cards for the hero creations: instant and reliable on demo day. */
const LIBRARY: { keywords: RegExp; card: ReferenceCardT }[] = [
  {
    keywords: /jelly ?fish|medusa/i,
    card: {
      subject: 'jellyfish (moon jelly)',
      summary: 'A translucent, bell-shaped body that pulses to swim, with frilly oral arms hanging from the centre and many fine tentacles around the rim.',
      parts: [
        { name: 'bell', shape: 'shallow dome, wider than tall, slightly flared rim', count: '1', size: 'diameter about 2.5x its height', color: 'translucent milky pink or blue, glowing rim' },
        { name: 'gonads', shape: 'four horseshoe rings visible through the top of the bell', count: '4', color: 'pink or violet' },
        { name: 'oral arms', shape: 'frilly, ruffled ribbons hanging from the centre', count: '4', size: 'about as long as the bell is wide', color: 'slightly denser than the bell' },
        { name: 'marginal tentacles', shape: 'very thin threads hanging from the rim edge', count: 'many (8-24 stylised)', size: '1-3x the bell diameter', color: 'pale, faintly glowing' },
      ],
      proportions: ['bell diameter : height ≈ 2.5 : 1', 'oral arms ≈ 1x bell diameter', 'tentacles ≈ 1-3x bell diameter, thinnest at the tips'],
      colors: 'translucent pastel pink, lilac or aqua with a soft glowing edge',
      materials: 'gelatinous, see-through, iridescent',
      motion: 'bell pulses about once per second; tentacles and arms trail and sway slowly',
      sound: 'soft pad from the bell, glassy chimes from tentacles in a pentatonic scale',
      sources: [{ title: 'Moon jellyfish (Aurelia aurita)', url: 'https://en.wikipedia.org/wiki/Aurelia_aurita' }],
    },
  },
  {
    keywords: /drum ?kit|drum set|drums\b/i,
    card: {
      subject: 'drum kit',
      summary: 'A standard 5-piece kit around a seated player: bass drum in front, snare between the knees, toms above, cymbals higher and to the sides.',
      parts: [
        { name: 'bass drum', shape: 'large cylinder on its side facing the player', count: '1', size: '20-22 in diameter', color: 'lacquered shell, white head' },
        { name: 'snare', shape: 'shallow cylinder', count: '1', size: '14 in, slightly tilted toward player', color: 'chrome or wood shell' },
        { name: 'rack toms', shape: 'cylinders mounted above the bass drum', count: '2', size: '10 and 12 in' },
        { name: 'floor tom', shape: 'deep cylinder on the right', count: '1', size: '16 in' },
        { name: 'hi-hat', shape: 'two thin stacked discs on the left', count: '1', size: '14 in', color: 'brass' },
        { name: 'crash / ride', shape: 'thin discs, higher', count: '2', size: '16-20 in', color: 'brass' },
      ],
      proportions: ['drum heads tilt 10-30° toward the player', 'cymbals sit higher than drums, outermost'],
      colors: 'glossy shells, white drum heads, brass cymbals',
      motion: 'cymbals wobble when hit',
      sources: [{ title: 'Drum kit', url: 'https://en.wikipedia.org/wiki/Drum_kit' }],
    },
  },
  {
    keywords: /xylophone|marimba|glockenspiel|vibraphone/i,
    card: {
      subject: 'xylophone / marimba',
      summary: 'A row of tuned bars on a frame, longest (lowest) on the left, shortening to the right, often with resonator tubes underneath.',
      parts: [
        { name: 'bars', shape: 'flat rectangular bars in a row', count: '8-16', size: 'graduated: lowest bar ~2x the length of the highest', color: 'rosewood brown or bright synthetic' },
        { name: 'frame', shape: 'low trapezoid frame under the bars', count: '1' },
        { name: 'resonators', shape: 'vertical tubes under each bar, graduated length', count: 'one per bar', color: 'metallic' },
      ],
      proportions: ['bars ~5 cm wide', 'each bar slightly shorter than the previous'],
      colors: 'warm wood bars, dark frame, gold or silver resonators',
      sources: [{ title: 'Marimba', url: 'https://en.wikipedia.org/wiki/Marimba' }],
    },
  },
  {
    keywords: /\bharp\b|lyre/i,
    card: {
      subject: 'harp',
      summary: 'A triangular frame: a tall pillar, a curved neck on top and a slanted soundboard, with strings running between neck and soundboard, longest strings nearest the pillar.',
      parts: [
        { name: 'pillar', shape: 'tall column at the front', count: '1' },
        { name: 'neck', shape: 'curved S-shaped top arm', count: '1' },
        { name: 'soundboard', shape: 'slanted box widening toward the bottom', count: '1' },
        { name: 'strings', shape: 'thin vertical lines, graduated length', count: '12-24 stylised', color: 'some coloured red/blue as C and F markers' },
      ],
      proportions: ['longest string ~3x the shortest', 'frame roughly a right triangle'],
      colors: 'golden or natural wood frame, pale strings',
      sources: [{ title: 'Harp', url: 'https://en.wikipedia.org/wiki/Harp' }],
    },
  },
];

const cache = new Map<string, ReferenceCardT>();
const key = (wish: string) => wish.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

export function fromLibrary(wish: string): ReferenceCardT | null {
  return LIBRARY.find((l) => l.keywords.test(wish))?.card ?? null;
}
export function fromCache(wish: string) { return cache.get(key(wish)) ?? null; }
export function remember(wish: string, card: ReferenceCardT) {
  if (cache.size > 200) cache.clear();
  cache.set(key(wish), card);
}

/** Verify a researched card belongs to the wish and has something to build from. */
export function verifyCard(card: ReferenceCardT | null, wish: string): { ok: boolean; reason: string } {
  if (!card) return { ok: false, reason: 'no reference found' };
  if (!card.summary && card.parts.length === 0) return { ok: false, reason: 'reference is empty' };
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const wishWords = words(wish);
  const cardWords = words(`${card.subject} ${card.summary} ${card.parts.map((p) => p.name).join(' ')}`);
  const overlap = [...wishWords].some((w) => cardWords.has(w) || [...cardWords].some((c) => c.startsWith(w.slice(0, 5))));
  if (!overlap && wishWords.size > 0) return { ok: false, reason: `reference is about "${card.subject}", not the wish` };
  return { ok: true, reason: card.sources.length ? `${card.sources.length} source(s)` : 'model knowledge' };
}
