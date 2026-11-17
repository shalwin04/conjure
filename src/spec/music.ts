/** Note names <-> Hz and scales, shared by the synth and spec expansion. */
const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
} as const;
export type ScaleName = keyof typeof SCALES;

/** "C4", "F#3", "Bb2" -> MIDI note number, or null. */
export function noteToMidi(note: string): number | null {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(note.trim());
  if (!m) return null;
  let semis = NOTE_INDEX[m[1].toUpperCase()];
  if (m[2] === '#') semis += 1;
  if (m[2] === 'b') semis -= 1;
  return (Number(m[3]) + 1) * 12 + semis;
}

export function midiToNote(midi: number): string {
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export const midiToHz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** The k-th note of a scale starting at root (k may exceed one octave). */
export function scaleNote(root: string, scale: ScaleName, k: number): string {
  const base = noteToMidi(root) ?? 60;
  const steps = SCALES[scale];
  const octave = Math.floor(k / steps.length);
  return midiToNote(base + octave * 12 + steps[k % steps.length]);
}
