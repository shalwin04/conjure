/** Curated palettes: the AI picks one by name, so every creation looks coherent. */
import type { PALETTES, PALETTE_SLOTS } from '../spec/schema.js';

type Palette = Record<(typeof PALETTE_SLOTS)[number], number>;

export const PALETTE_COLORS: Record<(typeof PALETTES)[number], Palette> = {
  aurora:  { base: 0x6c7cff, accent: 0xff6fb5, glow: 0x7ff6e0, accentRed: 0xff4d5e, accentBlue: 0x4fb3ff },
  ember:   { base: 0xd9573b, accent: 0xffb347, glow: 0xffe08a, accentRed: 0xff3b30, accentBlue: 0x5a7dff },
  lagoon:  { base: 0x2a9d8f, accent: 0xe9c46a, glow: 0xa8f0e6, accentRed: 0xe76f51, accentBlue: 0x48cae4 },
  candy:   { base: 0xff8fab, accent: 0x9b5de5, glow: 0xfee440, accentRed: 0xf15bb5, accentBlue: 0x00bbf9 },
  forest:  { base: 0x588157, accent: 0xdda15e, glow: 0xc7f9cc, accentRed: 0xbc4749, accentBlue: 0x5fa8d3 },
  dusk:    { base: 0x5e548e, accent: 0xe0b1cb, glow: 0xffd6a5, accentRed: 0xef476f, accentBlue: 0x6c8eef },
  mono:    { base: 0xd9d9de, accent: 0x8d8d99, glow: 0xffffff, accentRed: 0xff5c5c, accentBlue: 0x5cc8ff },
  sunrise: { base: 0xffb4a2, accent: 0xff7b54, glow: 0xffe5b4, accentRed: 0xe63946, accentBlue: 0x7aa2ff },
};
