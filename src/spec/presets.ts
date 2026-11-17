/**
 * Hand-built creations, written in the same spec the AI produces.
 * They ship with the app so Conjure works with no AI at all
 * (the competition's "take it away" test) and serve as few-shot examples.
 */
import type { CreationT, PartT } from './schema.js';

const drumKit: CreationT = {
  id: 'preset-drum-kit',
  title: 'Glass Drum Kit',
  version: 1,
  palette: 'aurora',
  style: 'glass',
  narration: ['Kick', 'Snare', 'Toms', 'Floor tom', 'Hi-hat', 'Crash'],
  parts: [
    {
      id: 'kick', label: 'Kick',
      shape: { kind: 'cylinder', radius: 0.13, height: 0.06 },
      transform: { pos: [0, -0.02, -0.06], rot: [8, 0, 0] },
      material: { color: 'base' },
      verb: 'strike',
      sound: { voice: 'membrane', pitch: 52, decay: 0.55, tone: 0.2 },
      fx: ['squash', 'flash'],
    },
    {
      id: 'snare', label: 'Snare',
      shape: { kind: 'cylinder', radius: 0.09, height: 0.05 },
      transform: { pos: [-0.17, 0.06, 0.03], rot: [15, 0, 0] },
      material: { color: 'accent' },
      verb: 'strike',
      sound: { voice: 'noise', pitch: 190, decay: 0.22, tone: 0.75 },
      fx: ['squash', 'flash'],
    },
    {
      id: 'tom-high', label: 'High tom',
      shape: { kind: 'cylinder', radius: 0.075, height: 0.06 },
      transform: { pos: [-0.075, 0.16, -0.13], rot: [28, 0, 0] },
      material: { color: 'accentBlue' },
      verb: 'strike',
      sound: { voice: 'membrane', pitch: 196, decay: 0.35, tone: 0.5 },
      fx: ['squash', 'flash'],
    },
    {
      id: 'tom-mid', label: 'Mid tom',
      shape: { kind: 'cylinder', radius: 0.08, height: 0.06 },
      transform: { pos: [0.085, 0.16, -0.13], rot: [28, 0, 0] },
      material: { color: 'accentBlue' },
      verb: 'strike',
      sound: { voice: 'membrane', pitch: 147, decay: 0.4, tone: 0.45 },
      fx: ['squash', 'flash'],
    },
    {
      id: 'tom-floor', label: 'Floor tom',
      shape: { kind: 'cylinder', radius: 0.1, height: 0.07 },
      transform: { pos: [0.21, 0.04, 0.02], rot: [12, 0, 0] },
      material: { color: 'accentBlue' },
      verb: 'strike',
      sound: { voice: 'membrane', pitch: 98, decay: 0.5, tone: 0.35 },
      fx: ['squash', 'flash'],
    },
    {
      id: 'hihat', label: 'Hi-hat',
      shape: { kind: 'cylinder', radius: 0.085, height: 0.008 },
      transform: { pos: [-0.29, 0.14, -0.03], rot: [18, 0, 0] },
      material: { color: 'glow', glow: 0.2 },
      verb: 'strike',
      sound: { voice: 'metal', pitch: 8000, decay: 0.09, tone: 0.9 },
      fx: ['flash'],
    },
    {
      id: 'crash', label: 'Crash',
      shape: { kind: 'cylinder', radius: 0.12, height: 0.008 },
      transform: { pos: [0.24, 0.28, -0.17], rot: [26, 0, 0] },
      material: { color: 'glow', glow: 0.2 },
      verb: 'strike',
      sound: { voice: 'metal', pitch: 5200, decay: 1.6, tone: 0.7 },
      fx: ['flash'],
    },
  ],
};

/** Kalimba: lowest note in the middle, alternating outward, C major pentatonic. */
const kalimbaNotes = ['G5', 'D5', 'A4', 'E4', 'C4', 'D4', 'G4', 'C5', 'E5'];
const kalimbaLengths = [0.06, 0.07, 0.08, 0.09, 0.1, 0.09, 0.08, 0.07, 0.06];
const tines: PartT[] = kalimbaNotes.map((note, i) => ({
  id: `tine-${i}`,
  label: note,
  shape: { kind: 'box', size: [0.016, 0.008, kalimbaLengths[i]] },
  transform: { pos: [-0.112 + i * 0.028, 0.03, 0.02 - kalimbaLengths[i] / 2 + 0.05] },
  material: { color: i === 4 ? 'accent' : 'glow', glow: 0.15 },
  verb: 'strike',
  sound: { voice: 'bell', pitch: note, decay: 1.4, tone: 0.35 },
  fx: ['squash', 'flash'],
}));

const kalimba: CreationT = {
  id: 'preset-kalimba',
  title: 'Moon Kalimba',
  version: 1,
  palette: 'lagoon',
  style: 'clay',
  narration: ['Sound box', 'Tines'],
  parts: [
    {
      id: 'body', label: 'Sound box',
      shape: { kind: 'box', size: [0.29, 0.035, 0.17] },
      transform: { pos: [0, 0, 0] },
      material: { color: 'base' },
      verb: 'none',
    },
    ...tines,
  ],
};

/**
 * Blueprint: a singing jellyfish built from the organic shapes. The bell is a
 * lathe outline, tentacles are tapering tubes in a radial ring, and idle
 * motion makes it breathe and drift. Also the Designer's organic example.
 */
const jellyfish = {
  id: 'preset-jellyfish',
  title: 'Singing Jellyfish',
  version: 1,
  palette: 'candy',
  style: 'jelly',
  narration: ['Bell', 'Oral arms', 'Tentacles'],
  parts: [
    {
      id: 'bell', label: 'Bell',
      shape: { kind: 'lathe', profile: [[0.13, 0], [0.128, 0.025], [0.115, 0.06], [0.085, 0.1], [0.045, 0.128], [0, 0.138]] },
      transform: { pos: [0, 0.24, -0.08] },
      material: { color: 'base', glow: 0.25 },
      verb: 'strike',
      sound: { voice: 'pad', pitch: 'C4', decay: 2.2, tone: 0.35 },
      fx: ['squash', 'flash'],
      motion: { type: 'pulse', amp: 0.7, freq: 0.45 },
    },
    {
      id: 'arm', label: 'Oral arm',
      shape: { kind: 'blob', radius: 0.022, lumps: 0.8, squash: 2 },
      transform: { pos: [0, 0.14, -0.08] },
      material: { color: 'accent', glow: 0.35 },
      verb: 'strike',
      sound: { voice: 'bell', decay: 1.6, tone: 0.3 },
      fx: ['squash', 'flash'],
      motion: { type: 'sway', amp: 0.5, freq: 0.35 },
      repeat: { mode: 'radial', count: 4, radius: 0.035, scale: 'pentatonic', root: 'G4' },
    },
    {
      id: 'tentacle', label: 'Tentacle',
      shape: { kind: 'tube', length: 0.24, radius: 0.006, taper: 0.75, curl: 0.25, wave: 0.6 },
      transform: { pos: [0, 0.18, -0.08] },
      material: { color: 'glow', glow: 0.4 },
      verb: 'strike',
      sound: { voice: 'bell', decay: 1.3, tone: 0.55 },
      fx: ['flash'],
      motion: { type: 'sway', amp: 0.6, freq: 0.4 },
      repeat: { mode: 'radial', count: 10, radius: 0.105, scale: 'pentatonic', root: 'C5' },
    },
  ],
} as unknown as CreationT;

const xylophone = {
  id: 'preset-xylophone',
  title: 'Glass Xylophone',
  version: 1,
  palette: 'lagoon',
  style: 'glass',
  narration: ['Frame', 'Eight bars'],
  parts: [
    { id: 'frame', label: 'Frame', shape: { kind: 'box', size: [0.6, 0.03, 0.2] }, transform: { pos: [0, -0.03, 0] }, material: { color: 'base' }, verb: 'none' },
    {
      id: 'bar', shape: { kind: 'box', size: [0.055, 0.02, 0.16] }, transform: { pos: [-0.245, 0, 0] },
      material: { color: 'glow', glow: 0.2 }, verb: 'strike', sound: { voice: 'bell', decay: 1.2, tone: 0.5 }, fx: ['squash', 'flash'],
      repeat: { count: 8, step: [0.07, 0, 0], scale: 'major', root: 'C5', shrink: 0.96 },
    },
  ],
} as unknown as CreationT;

/**
 * World blueprint: a tiny island to hold in your palm. In worlds, pos.y is
 * height above the ground. Tap the volcano to erupt it, the cloud to rain,
 * the sun to switch day and night, palm crowns to shower leaves, turtles to hop.
 */
const volcanoIsle = {
  id: 'preset-volcano-isle',
  kind: 'world',
  title: 'Volcano Isle',
  version: 1,
  palette: 'forest',
  style: 'organic',
  terrain: { style: 'island', radius: 0.22, height: 0.06, roughness: 0.5, water: true },
  ambient: { particles: 'none', light: 'day' },
  narration: ['Island', 'Volcano', 'Palms', 'The keeper', 'Sky'],
  parts: [
    {
      id: 'volcano', label: 'Volcano',
      shape: { kind: 'asset', type: 'volcano', size: 0.17 },
      transform: { pos: [0.03, 0, -0.07] },
      verb: 'strike', sound: { voice: 'bass', pitch: 'C1', decay: 2.5, tone: 0.2 }, react: [{ do: 'erupt' }],
    },
    {
      id: 'palm', label: 'Palm tree',
      shape: { kind: 'asset', type: 'palm', size: 0.12 },
      transform: { pos: [-0.16, 0, -0.03] },
      verb: 'strike', sound: { voice: 'bell', decay: 1.2, tone: 0.4 }, react: [{ do: 'burst' }],
      repeat: { count: 3, step: [0.025, 0, 0.065], scale: 'pentatonic', root: 'E5' },
    },
    {
      id: 'keeper', label: 'Island keeper',
      shape: { kind: 'asset', type: 'character', size: 0.04 },
      transform: { pos: [0.02, 0, 0.11], rot: [0, 20, 0] },
      verb: 'strike', sound: { voice: 'pad', pitch: 'E4', decay: 1.2 }, react: [{ do: 'jump' }],
    },
    {
      id: 'fire', label: 'Campfire',
      shape: { kind: 'asset', type: 'campfire', size: 0.022 },
      transform: { pos: [0.07, 0, 0.1] },
      verb: 'strike', sound: { voice: 'noise', pitch: 900, decay: 0.6, tone: 0.5 }, react: [{ do: 'burst' }],
    },
    {
      id: 'rock', label: 'Boulder',
      shape: { kind: 'asset', type: 'rock', size: 0.03 },
      transform: { pos: [0.13, 0, -0.01] },
      verb: 'strike', sound: { voice: 'membrane', pitch: 90, decay: 0.35, tone: 0.3 }, react: [{ do: 'glow' }],
      repeat: { count: 2, step: [-0.05, 0, 0.08] },
    },
    {
      id: 'turtle', label: 'Turtle',
      shape: { kind: 'blob', radius: 0.012, lumps: 0.3, squash: 0.5 },
      transform: { pos: [0.12, 0.006, 0.12] },
      material: { color: 'accentBlue', glow: 0.1 },
      verb: 'strike', sound: { voice: 'fx', pitch: 700, decay: 0.25 },
      fx: ['squash'], motion: { type: 'wander', radius: 0.035, freq: 0.4 }, react: [{ do: 'jump' }],
      repeat: { count: 2, step: [-0.17, 0, 0.03] },
    },
    {
      id: 'cloud', label: 'Rain cloud',
      shape: { kind: 'asset', type: 'cloud', size: 0.05 },
      transform: { pos: [-0.06, 0.22, -0.05] },
      verb: 'strike', sound: { voice: 'pad', pitch: 'G4', decay: 2.5, tone: 0.3 },
      motion: { type: 'orbit', radius: 0.14, freq: 0.2 }, react: [{ do: 'rain' }],
    },
    {
      id: 'sun', label: 'Sun',
      shape: { kind: 'sphere', radius: 0.022 },
      transform: { pos: [0.14, 0.3, -0.14] },
      material: { color: 'glow', glow: 1 },
      verb: 'strike', sound: { voice: 'bell', pitch: 'C6', decay: 2, tone: 0.7 },
      fx: ['flash'], motion: { type: 'pulse', amp: 0.3, freq: 0.3 }, react: [{ do: 'daynight' }],
    },
  ],
} as unknown as CreationT;

export const PRESETS: Record<string, CreationT> = {
  kalimba,
  drums: drumKit,
  jellyfish,
  xylophone,
  volcanoIsle,
};
export const PRESET_ORDER = ['kalimba', 'drums', 'jellyfish', 'xylophone', 'volcanoIsle'] as const;

/** Wishes that a hand-tuned blueprint answers directly (instant, no design call). */
const BLUEPRINT_MATCH: [RegExp, keyof typeof PRESETS][] = [
  [/jelly ?fish|medusa/i, 'jellyfish'],
  [/drum ?kit|drum set|\bdrums\b/i, 'drums'],
  [/xylophone|marimba|glockenspiel/i, 'xylophone'],
  [/kalimba|thumb piano/i, 'kalimba'],
  [/volcano (island|isle)|island with a volcano/i, 'volcanoIsle'],
];
export function blueprintFor(wish: string): keyof typeof PRESETS | null {
  return BLUEPRINT_MATCH.find(([re]) => re.test(wish))?.[1] ?? null;
}
