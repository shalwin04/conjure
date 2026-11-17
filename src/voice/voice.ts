/**
 * Push-to-talk: hold (Space, the HUD orb, the left X button, or a left-hand
 * pinch held up toward your face), speak, let go. The clip goes to the server,
 * which returns what you said and what it means; the host carries it out.
 */
import { fetchListen } from '../net/conjure-client.js';
import type { ListenContext, VoiceCommandT } from '../spec/voice.js';
import { Mic, toBase64 } from './mic.js';

export type VoiceState = 'idle' | 'listening' | 'thinking';

export interface VoiceHost {
  context(): ListenContext;
  /** About to listen: quiet the narrator, play a cue. */
  begin(): void;
  state(s: VoiceState, level: number): void;
  heard(transcript: string): void;
  fail(message: string): void;
  run(command: VoiceCommandT, transcript: string): void;
}

export class VoiceController {
  readonly mic = new Mic();
  state: VoiceState = 'idle';
  private held = false;
  private abort: AbortController | null = null;

  constructor(private host: VoiceHost) {
    this.mic.onAutoEnd = () => this.release();
  }

  get supported() { return this.mic.supported; }

  /** Pressed: start listening (a new press interrupts a request still in flight). */
  async press() {
    if (this.held) return;
    this.held = true;
    this.abort?.abort();
    this.abort = null;
    if (!this.mic.supported) { this.held = false; this.host.fail('This browser has no microphone access.'); return; }
    this.host.begin();
    const ok = await this.mic.start();
    if (!ok) { this.held = false; this.set('idle'); this.host.fail('Allow the microphone to talk to Conjure.'); return; }
    // Released while the microphone was opening: nothing to send.
    if (!this.held) { this.mic.stop(); this.set('idle'); return; }
    this.set('listening');
  }

  /** Released (or the clip ended by itself): send what was said. */
  release() {
    if (!this.held) return;
    this.held = false;
    const clip = this.mic.stop();
    if (!clip || !clip.speech || clip.seconds < 0.3) { this.set('idle'); if (clip && !clip.speech) this.host.fail("I didn't hear anything. Hold, speak, then let go."); return; }
    this.set('thinking');
    const abort = new AbortController();
    this.abort = abort;
    void fetchListen(toBase64(clip.wav), this.host.context(), abort.signal).then((r) => {
      if (abort.signal.aborted) return;
      this.abort = null;
      this.set('idle');
      if ('error' in r) { this.host.fail(r.error); return; }
      if (r.transcript) this.host.heard(r.transcript);
      this.host.run(r.command, r.transcript);
    });
  }

  /** Each frame: the orb follows your voice. */
  update() {
    if (this.state === 'listening') this.host.state('listening', this.mic.level);
  }

  private set(s: VoiceState) {
    this.state = s;
    this.host.state(s, 0);
  }

  dispose() { this.abort?.abort(); this.mic.dispose(); }
}
