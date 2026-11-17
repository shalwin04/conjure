/**
 * The storyteller's voice. Lines are spoken with Gemini TTS through the
 * server (the Quest browser has no speech synthesis); if that is unavailable
 * the browser's own voice is used where it exists, and the text is always
 * shown on the orb either way. Lines queue so the story never talks over itself.
 */
import { fetchSpeech } from '../net/conjure-client.js';
import type { Synth } from './synth.js';

type Who = 'narrator' | 'character';

export class Narrator {
  enabled = true;
  private queue: { text: string; who: Who; speaker?: string; resolve: () => void }[] = [];
  private busy = false;
  private cache = new Map<string, Promise<ArrayBuffer | null>>();
  private current: AudioBufferSourceNode | null = null;
  private last: { text: string; who: Who; speaker?: string } | null = null;

  /** show(text, who, speaker, seconds): subtitles reveal over `seconds` (the line's real length when voiced). */
  constructor(private synth: Synth, private show: (text: string, who: Who, speaker: string | undefined, seconds: number) => void) {}

  /** Start fetching lines before they are needed. */
  prefetch(lines: { text: string; who?: Who }[]) {
    for (const l of lines) this.audio(l.text, l.who ?? 'narrator');
  }

  /** Speak a line (queued). Resolves when it has been said. */
  say(text: string, who: Who = 'narrator', speaker?: string): Promise<void> {
    if (!text.trim()) return Promise.resolve();
    return new Promise((resolve) => {
      this.queue.push({ text, who, speaker, resolve });
      void this.pump();
    });
  }

  /** Say the last line again (voice "repeat that"). */
  repeat() {
    if (this.last && !this.busy) void this.say(this.last.text, this.last.who, this.last.speaker);
  }

  /** Stop talking and drop anything queued. */
  stop() {
    for (const q of this.queue) q.resolve();
    this.queue = [];
    try { this.current?.stop(); } catch { /* not started */ }
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }

  private audio(text: string, who: Who) {
    const key = `${who}:${text}`;
    let p = this.cache.get(key);
    if (!p) { p = fetchSpeech(text, who); this.cache.set(key, p); }
    return p;
  }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length) {
      const line = this.queue.shift()!;
      this.last = { text: line.text, who: line.who, speaker: line.speaker };
      const estimate = 1.2 + line.text.length * 0.055;
      if (this.enabled) await this.speakOne(line.text, line.who, (secs) => this.show(line.text, line.who, line.speaker, secs ?? estimate));
      else { this.show(line.text, line.who, line.speaker, estimate); await new Promise((r) => setTimeout(r, estimate * 1000)); }
      line.resolve();
    }
    this.busy = false;
  }

  private async speakOne(text: string, who: Who, started: (seconds?: number) => void) {
    const audio = this.synth.audio;
    const bytes = await this.audio(text, who);
    if (bytes && audio) {
      try {
        const buf = await audio.ctx.decodeAudioData(bytes.slice(0));
        started(buf.duration);
        await new Promise<void>((resolve) => {
          const src = audio.ctx.createBufferSource();
          src.buffer = buf;
          const g = audio.ctx.createGain();
          g.gain.value = who === 'narrator' ? 1.4 : 1.2;
          src.connect(g).connect(audio.out);
          src.onended = () => resolve();
          this.current = src;
          src.start();
        });
        return;
      } catch { /* fall through to the browser voice */ }
    }
    started();
    if (typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined') {
      await new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 0.95; u.pitch = who === 'character' ? 1.2 : 0.95;
        u.onend = () => resolve(); u.onerror = () => resolve();
        speechSynthesis.speak(u);
        setTimeout(resolve, 2000 + text.length * 90);
      });
      return;
    }
    // No voice at all: give the reader time.
    await new Promise((r) => setTimeout(r, 1500 + text.length * 50));
  }
}
