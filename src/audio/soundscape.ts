/**
 * The sound of being inside a world: wind that gusts, waves when you are near
 * water, birds by day, crickets at night, and footsteps as you travel. All
 * synthesised (no samples), spatialised around the listener, and silent on the
 * table so the miniature stays a clean instrument.
 */
import type { Synth } from './synth.js';

interface Bed { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode }

export interface SoundscapeState {
  /** Inside a world (immersive). */
  active: boolean;
  light: 'day' | 'dusk' | 'night';
  particles: string;
  /** 0..1: how close the user is to water. */
  waterNear: number;
  /** Metres travelled this frame (for footsteps). */
  moved: number;
  /** Listener position, world space. */
  x: number; y: number; z: number;
  /** Floor height under the user, world space. */
  floorY: number;
}

export class Soundscape {
  private wind: Bed | null = null;
  private water: Bed | null = null;
  private nextBird = 2;
  private nextCricket = 1;
  private stepAcc = 0;
  private chirps: { at: number; hz: number; x: number; y: number; z: number }[] = [];
  enabled = true;

  constructor(private synth: Synth) {}

  update(time: number, s: SoundscapeState) {
    const audio = this.synth.audio;
    if (!audio) return;
    const on = this.enabled && s.active;
    if (on && !this.wind) {
      this.wind = this.bed(audio, 'bandpass', 520, 0.7);
      this.water = this.bed(audio, 'lowpass', 480, 0.5);
    }
    if (!this.wind || !this.water) return;
    const t = audio.ctx.currentTime;
    const snowy = s.particles === 'snow';
    const gust = 0.5 + 0.5 * Math.sin(time * 0.13) * Math.sin(time * 0.31 + 1);
    const windGain = on ? (snowy ? 0.09 : 0.045) * (0.4 + 0.8 * gust) * (s.light === 'night' ? 0.7 : 1) : 0;
    this.wind.gain.gain.setTargetAtTime(windGain, t, 0.4);
    this.wind.filter.frequency.setTargetAtTime((snowy ? 900 : 480) + 300 * gust, t, 0.5);
    const swell = 0.6 + 0.4 * Math.sin(time * 0.55);
    this.water.gain.gain.setTargetAtTime(on ? 0.09 * s.waterNear * swell : 0, t, 0.3);
    if (!on) { this.chirps.length = 0; return; }

    // Birds by day (not in snow), crickets at night: little spatial life around you.
    if (s.light !== 'night' && !snowy && time > this.nextBird) {
      this.nextBird = time + 2.5 + Math.random() * 5;
      const a = Math.random() * Math.PI * 2, d = 4 + Math.random() * 6;
      const x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d, y = s.floorY + 2 + Math.random() * 3;
      const hz = 2200 + Math.random() * 1800;
      const notes = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < notes; i++) this.chirps.push({ at: time + i * 0.11, hz: hz * (1 + (Math.random() - 0.3) * 0.25), x, y, z });
    }
    if (s.light === 'night' && time > this.nextCricket) {
      this.nextCricket = time + 0.7 + Math.random() * 1.2;
      const a = Math.random() * Math.PI * 2, d = 2 + Math.random() * 5;
      const x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d;
      for (let i = 0; i < 3; i++) this.chirps.push({ at: time + i * 0.06, hz: 4800 + Math.random() * 600, x, y: s.floorY + 0.1, z });
    }
    for (let i = this.chirps.length - 1; i >= 0; i--) {
      const c = this.chirps[i];
      if (time < c.at) continue;
      this.chirps.splice(i, 1);
      const night = s.light === 'night';
      this.synth.play({ voice: night ? 'metal' : 'bell', pitch: c.hz, decay: night ? 0.04 : 0.07, tone: 0.9, gain: night ? 0.08 : 0.16 }, 0.5, c.x, c.y, c.z);
    }

    // Footsteps while travelling.
    this.stepAcc += s.moved;
    if (this.stepAcc > 0.8) {
      this.stepAcc = 0;
      const wet = s.waterNear > 0.8;
      this.synth.play({ voice: 'noise', pitch: snowy ? 1100 : wet ? 700 : 320, decay: wet ? 0.18 : 0.07, tone: snowy ? 0.6 : 0.2, gain: 0.25 }, 0.4, s.x, s.floorY + 0.05, s.z);
    }
  }

  stop() {
    for (const b of [this.wind, this.water]) {
      if (!b) continue;
      try { b.src.stop(); } catch { /* already stopped */ }
      b.src.disconnect(); b.filter.disconnect(); b.gain.disconnect();
    }
    this.wind = this.water = null;
  }

  private bed(audio: NonNullable<Synth['audio']>, type: BiquadFilterType, hz: number, q: number): Bed {
    const src = audio.ctx.createBufferSource();
    src.buffer = audio.noise;
    src.loop = true;
    const filter = audio.ctx.createBiquadFilter();
    filter.type = type; filter.frequency.value = hz; filter.Q.value = q;
    const gain = audio.ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(audio.out);
    src.start(0, Math.random() * (audio.noise.duration || 1));
    return { src, filter, gain };
  }
}
