/**
 * Push-to-talk microphone. Records 16 kHz mono PCM while held, ends a clip by
 * itself after a short silence (or 12 s), and hands back a WAV that the server
 * sends straight to Gemini. Works the same on desktop and in the Quest browser
 * (which has no built-in speech recognition).
 */
const RATE = 16000;
const MAX_SECONDS = 12;
const SILENCE_END = 0.9;
const SPEECH_RMS = 0.018;

export interface Clip { wav: Uint8Array; seconds: number; speech: boolean }

export class Mic {
  /** 0..1 loudness of the last few milliseconds (for the listening orb). */
  level = 0;
  /** Called when a clip ends by itself (silence or time limit). */
  onAutoEnd: (() => void) | null = null;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private recording = false;
  private heardSpeech = false;
  private quiet = 0;
  private srcRate = 48000;
  private opening: Promise<boolean> | null = null;

  get supported() { return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia; }
  get active() { return this.recording; }

  /** Ask for the microphone (once); keeps it open so the next press starts instantly. */
  open(): Promise<boolean> {
    if (this.stream) return Promise.resolve(true);
    if (this.opening) return this.opening;
    this.opening = (async () => {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
        this.ctx = new AudioContext();
        this.srcRate = this.ctx.sampleRate;
        const src = this.ctx.createMediaStreamSource(this.stream);
        this.node = this.ctx.createScriptProcessor(4096, 1, 1);
        this.node.onaudioprocess = (e) => this.onAudio(e.inputBuffer.getChannelData(0), e.inputBuffer.duration);
        // A silent sink keeps the processor running without echoing the voice.
        const mute = this.ctx.createGain();
        mute.gain.value = 0;
        src.connect(this.node);
        this.node.connect(mute);
        mute.connect(this.ctx.destination);
        return true;
      } catch (err) {
        console.warn('[mic]', err);
        this.stream = null;
        return false;
      } finally {
        this.opening = null;
      }
    })();
    return this.opening;
  }

  async start(): Promise<boolean> {
    if (!(await this.open())) return false;
    if (this.ctx?.state === 'suspended') await this.ctx.resume();
    this.chunks = [];
    this.heardSpeech = false;
    this.quiet = 0;
    this.recording = true;
    return true;
  }

  /** End the clip; null if nothing was recorded. */
  stop(): Clip | null {
    if (!this.recording) return null;
    this.recording = false;
    this.level = 0;
    const total = this.chunks.reduce((s, c) => s + c.length, 0);
    if (!total) return null;
    const all = new Float32Array(total);
    let o = 0;
    for (const c of this.chunks) { all.set(c, o); o += c.length; }
    this.chunks = [];
    const pcm = resample(all, this.srcRate, RATE);
    return { wav: toWav(pcm, RATE), seconds: pcm.length / RATE, speech: this.heardSpeech };
  }

  private onAudio(data: Float32Array, duration: number) {
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    this.level = this.level * 0.5 + Math.min(1, rms * 12) * 0.5;
    if (!this.recording) return;
    this.chunks.push(new Float32Array(data));
    if (rms > SPEECH_RMS) { this.heardSpeech = true; this.quiet = 0; } else if (this.heardSpeech) this.quiet += duration;
    const seconds = this.chunks.length * duration;
    if ((this.heardSpeech && this.quiet > SILENCE_END) || seconds > MAX_SECONDS) this.onAutoEnd?.();
  }

  dispose() {
    this.recording = false;
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.stream = null; this.ctx = null; this.node = null;
  }
}

function resample(input: Float32Array, from: number, to: number) {
  if (from === to) return input;
  const ratio = from / to, n = Math.floor(input.length / ratio), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Average the source samples that fall in this output sample (a cheap low-pass).
    const a = Math.floor(i * ratio), b = Math.min(input.length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b; j++) s += input[j];
    out[i] = s / Math.max(1, b - a);
  }
  return out;
}

function toWav(pcm: Float32Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length * 2);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return out;
}

export function toBase64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
