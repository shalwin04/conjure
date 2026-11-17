/**
 * Real-time synth voices on the Web Audio API. No samples: any creation the AI
 * imagines gets a voice from a small recipe (voice + pitch + decay + tone).
 * Velocity changes loudness and brightness, so soft and hard hits differ.
 */
import type { SoundRecipeT, Voice } from '../spec/schema.js';

import { midiToHz, noteToMidi } from '../spec/music.js';

/** "C4", "F#3", "Bb2" or a number in Hz -> Hz. */
export function toHz(pitch: number | string | undefined, fallback: number): number {
  if (typeof pitch === 'number') return pitch > 0 ? pitch : fallback;
  if (!pitch) return fallback;
  const midi = noteToMidi(pitch);
  return midi == null ? fallback : midiToHz(midi);
}

const DEFAULT_PITCH: Record<Voice, number> = {
  membrane: 80, noise: 200, metal: 7000, pluck: 220, bell: 523, pad: 262, bass: 65, theremin: 440, fx: 600,
};

export class Synth {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private reverbSend!: GainNode;
  private noiseBuffer!: AudioBuffer;
  private pluckCache = new Map<string, AudioBuffer>();

  get ready() { return this.ctx?.state === 'running'; }

  /**
   * Distances scale with the world: inside a life-size world a volcano 10 m
   * away should still be loud. 1 = tabletop.
   */
  distanceScale = 1;

  /** Raw graph access for long-running sounds (the soundscape). Null until audio is unlocked. */
  get audio(): { ctx: AudioContext; out: GainNode; noise: AudioBuffer } | null {
    return this.ctx && this.ctx.state === 'running' ? { ctx: this.ctx, out: this.master, noise: this.noiseBuffer } : null;
  }

  /** Create or resume the audio context. Call from a user gesture or XR session start. */
  async unlock() {
    if (!this.ctx) this.build();
    if (this.ctx && this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch { /* retried on next gesture */ }
    }
  }

  /** Keep the listener on the user's head so parts sound from where they sit. */
  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number) {
    const l = this.ctx?.listener;
    if (!l || !l.positionX) return;
    const t = this.ctx!.currentTime;
    l.positionX.setTargetAtTime(x, t, 0.02); l.positionY.setTargetAtTime(y, t, 0.02); l.positionZ.setTargetAtTime(z, t, 0.02);
    l.forwardX.setTargetAtTime(fx, t, 0.02); l.forwardY.setTargetAtTime(fy, t, 0.02); l.forwardZ.setTargetAtTime(fz, t, 0.02);
    l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
  }

  /** Play a recipe at a world position with velocity 0-1. */
  play(recipe: SoundRecipeT, velocity: number, x = 0, y = 0, z = 0) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const v = Math.min(1, Math.max(0, velocity));
    const out = this.spatial(x, y, z);
    const gain = (recipe.gain ?? 1) * (0.25 + 0.75 * v);
    const hz = toHz(recipe.pitch, DEFAULT_PITCH[recipe.voice]);
    const tone = Math.min(1, Math.max(0, recipe.tone ?? 0.5));
    const decay = Math.min(4, Math.max(0.03, recipe.decay ?? 0.4));
    const t = ctx.currentTime + 0.005;
    switch (recipe.voice) {
      case 'membrane': this.membrane(out, t, hz, decay, tone, gain, v); break;
      case 'noise': this.snare(out, t, hz, decay, tone, gain, v); break;
      case 'metal': this.metal(out, t, hz, decay, gain, v); break;
      case 'pluck': this.pluck(out, t, hz, decay, tone, gain); break;
      case 'bell': this.bell(out, t, hz, decay, tone, gain, v); break;
      case 'pad': this.pad(out, t, hz, decay, tone, gain); break;
      case 'bass': this.bass(out, t, hz, decay, tone, gain, v); break;
      case 'theremin': this.theremin(out, t, hz, decay, gain); break;
      case 'fx': this.sweep(out, t, hz, decay, gain); break;
    }
  }

  /** Short UI sounds: part placed, creation ready, listening. */
  ui(kind: 'place' | 'ready' | 'listen' | 'error') {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.005;
    const out = this.master;
    if (kind === 'place') this.bell(out, t, 1320 + Math.random() * 200, 0.15, 0.6, 0.12, 0.5);
    if (kind === 'ready') { this.bell(out, t, 784, 0.6, 0.5, 0.2, 0.6); this.bell(out, t + 0.09, 1175, 0.8, 0.5, 0.2, 0.6); }
    if (kind === 'listen') this.sweep(out, t, 500, 0.18, 0.12);
    if (kind === 'error') this.bass(out, t, 110, 0.25, 0.3, 0.25, 0.5);
  }

  // ---------------------------------------------------------------------------

  private build() {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 4;
    comp.attack.value = 0.003; comp.release.value = 0.15;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20;
    limiter.attack.value = 0.001; limiter.release.value = 0.05;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(comp).connect(limiter).connect(ctx.destination);

    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse(1.4, 3);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.22;
    this.reverbSend.connect(reverb).connect(this.master);

    const len = ctx.sampleRate;
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  private impulse(seconds: number, decay: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  /** Per-note spatial output: panner -> dry + reverb send. */
  private spatial(x: number, y: number, z: number): AudioNode {
    const ctx = this.ctx!;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 0.5 * this.distanceScale;
    p.rolloffFactor = 0.6;
    p.maxDistance = 10000;
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; }
    else p.setPosition(x, y, z);
    p.connect(this.master);
    p.connect(this.reverbSend);
    return p;
  }

  private env(t: number, peak: number, attack: number, decay: number) {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  private osc(type: OscillatorType, hz: number, t: number, stop: number) {
    const o = this.ctx!.createOscillator();
    o.type = type; o.frequency.setValueAtTime(hz, t);
    o.start(t); o.stop(stop);
    return o;
  }

  private noise(t: number, stop: number) {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noiseBuffer; s.loop = true;
    s.start(t, Math.random() * 0.5); s.stop(stop);
    return s;
  }

  private filter(type: BiquadFilterType, hz: number, q = 0.7) {
    const f = this.ctx!.createBiquadFilter();
    f.type = type; f.frequency.value = hz; f.Q.value = q;
    return f;
  }

  /** Drum body: sine with a fast pitch drop, plus a click for attack. */
  private membrane(out: AudioNode, t: number, hz: number, decay: number, tone: number, gain: number, v: number) {
    const o = this.osc('sine', hz * (2.2 + v), t, t + decay + 0.1);
    o.frequency.exponentialRampToValueAtTime(hz, t + 0.04 + 0.04 * (1 - tone));
    o.connect(this.env(t, gain, 0.002, decay)).connect(out);
    const click = this.noise(t, t + 0.03);
    click.connect(this.filter('highpass', 1500 + 3000 * tone)).connect(this.env(t, gain * 0.35 * (0.4 + v), 0.001, 0.02)).connect(out);
  }

  /** Snare: bright noise burst + short tonal body. */
  private snare(out: AudioNode, t: number, hz: number, decay: number, tone: number, gain: number, v: number) {
    const n = this.noise(t, t + decay + 0.05);
    n.connect(this.filter('highpass', 700 + 1500 * tone)).connect(this.filter('lowpass', 4000 + 8000 * v))
      .connect(this.env(t, gain * 0.8, 0.001, decay)).connect(out);
    const body = this.osc('triangle', hz * 1.6, t, t + 0.15);
    body.frequency.exponentialRampToValueAtTime(hz, t + 0.03);
    body.connect(this.env(t, gain * 0.5, 0.001, 0.09)).connect(out);
  }

  /** Cymbals and hats: detuned square cluster through high filters. */
  private metal(out: AudioNode, t: number, hz: number, decay: number, gain: number, v: number) {
    const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];
    const bus = this.ctx!.createGain();
    bus.gain.value = 0.18;
    for (const r of ratios) this.osc('square', 40 * r * (1 + Math.random() * 0.01), t, t + decay + 0.1).connect(bus);
    const hp = this.filter('highpass', Math.min(hz, 12000) * (0.75 + 0.25 * v));
    bus.connect(this.filter('bandpass', 10000, 0.5)).connect(hp).connect(this.env(t, gain, 0.001, decay)).connect(out);
  }

  /** Karplus-Strong plucked string, rendered once per pitch and cached. */
  private pluck(out: AudioNode, t: number, hz: number, decay: number, tone: number, gain: number) {
    const ctx = this.ctx!;
    const key = `${Math.round(hz)}:${decay.toFixed(2)}:${tone.toFixed(2)}`;
    let buf = this.pluckCache.get(key);
    if (!buf) {
      const len = Math.floor(ctx.sampleRate * Math.min(3, decay + 0.2));
      buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      const period = Math.max(2, Math.round(ctx.sampleRate / hz));
      const ring = new Float32Array(period);
      for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
      const damp = 0.996 - 0.01 * (1 - Math.min(1, decay / 2));
      const blend = 0.5 + 0.45 * tone;
      let idx = 0;
      for (let i = 0; i < len; i++) {
        const next = (idx + 1) % period;
        const s = ring[idx];
        ring[idx] = damp * (blend * s + (1 - blend) * ring[next]);
        d[i] = s;
        idx = next;
      }
      if (this.pluckCache.size > 64) this.pluckCache.clear();
      this.pluckCache.set(key, buf);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = gain * 0.7;
    src.connect(g).connect(out);
    src.start(t);
  }

  /** Bells, marimba, kalimba, glass: FM with an inharmonic modulator. */
  private bell(out: AudioNode, t: number, hz: number, decay: number, tone: number, gain: number, v: number) {
    const ctx = this.ctx!;
    const end = t + decay + 0.1;
    const carrier = this.osc('sine', hz, t, end);
    const mod = this.osc('sine', hz * (1.4 + 2.1 * tone), t, end);
    const index = ctx.createGain();
    index.gain.setValueAtTime(hz * (0.6 + 2.4 * v * tone + 0.4), t);
    index.gain.exponentialRampToValueAtTime(hz * 0.02 + 0.01, t + decay * 0.6);
    mod.connect(index).connect(carrier.frequency);
    carrier.connect(this.env(t, gain * 0.55, 0.002, decay)).connect(out);
  }

  private pad(out: AudioNode, t: number, hz: number, decay: number, tone: number, gain: number) {
    const lp = this.filter('lowpass', 600 + 3000 * tone);
    const e = this.env(t, gain * 0.3, 0.08, decay + 0.6);
    for (const det of [-7, 0, 7]) {
      const o = this.osc('sawtooth', hz, t, t + decay + 0.8);
      o.detune.value = det;
      o.connect(lp);
    }
    lp.connect(e).connect(out);
  }

  private bass(out: AudioNode, t: number, hz: number, decay: number, tone: number, gain: number, v: number) {
    const lp = this.filter('lowpass', 200, 4);
    lp.frequency.setValueAtTime(300 + 2500 * tone * v, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + decay);
    this.osc('sawtooth', hz, t, t + decay + 0.1).connect(lp);
    this.osc('sine', hz / 2, t, t + decay + 0.1).connect(lp);
    lp.connect(this.env(t, gain * 0.6, 0.004, decay)).connect(out);
  }

  /** One-shot theremin note; continuous hover control comes with the hover verb. */
  private theremin(out: AudioNode, t: number, hz: number, decay: number, gain: number) {
    const o = this.osc('sine', hz, t, t + decay + 0.2);
    const lfo = this.osc('sine', 5.5, t, t + decay + 0.2);
    const depth = this.ctx!.createGain(); depth.gain.value = hz * 0.012;
    lfo.connect(depth).connect(o.frequency);
    o.connect(this.env(t, gain * 0.4, 0.05, decay)).connect(out);
  }

  private sweep(out: AudioNode, t: number, hz: number, decay: number, gain: number) {
    const o = this.osc('sine', hz, t, t + decay + 0.05);
    o.frequency.exponentialRampToValueAtTime(hz * 2.5, t + decay);
    o.connect(this.env(t, gain * 0.4, 0.005, decay)).connect(out);
  }
}
