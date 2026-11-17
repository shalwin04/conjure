/**
 * Desktop / emulator overlay: the wish bar, the agent's progress, a welcome
 * card with ideas to try, and Step inside / out. Stays on top of the
 * emulator's XR view (Esc leaves play mode, then click it).
 */
import type { Stage } from '../spec/protocol.js';
import { installTheme } from './theme.js';

const STAGE_LABEL: Record<Stage, string> = {
  routing: 'Listening', researching: 'Researching', designing: 'Dreaming it up', editing: 'Reshaping', testing: 'Testing',
  fixing: 'Polishing', critiquing: 'Checking', ready: 'Ready', error: 'Hmm',
};

/** Ideas that show off different biomes, so the first world is never the default island. */
export const IDEAS = [
  { icon: '🏮', text: 'A lantern-lit city at dusk with a fountain plaza' },
  { icon: '🏜️', text: 'A desert oasis with tents under the stars' },
  { icon: '❄️', text: 'A snowy village among frosted pines' },
  { icon: '🍂', text: 'An autumn harvest fair by a windmill' },
  { icon: '🌴', text: 'A tropical lagoon with a lighthouse' },
  { icon: '🍄', text: 'A fairy forest of giant glowing mushrooms' },
];

const css = `
.cj-hud{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483000;width:min(720px,calc(100vw - 28px));
  font:15px/1.4 var(--cj-font);color:var(--cj-ink);animation:cj-rise .5s ease both}
.cj-bar{display:flex;gap:10px;align-items:center;padding:8px 8px 8px 10px;border-radius:999px;background:var(--cj-glass);
  backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3);border:1px solid var(--cj-line);box-shadow:var(--cj-shadow)}
.cj-orb{width:30px;height:30px;flex:none;border-radius:50%;background:conic-gradient(from 0deg,#ffc36b,#ff8f8f,#c48bff,#7fd8ff,#ffc36b);
  filter:blur(.3px);box-shadow:0 0 18px rgba(255,180,140,.55);opacity:.85}
.cj-hud.busy .cj-orb{animation:cj-orb 2.2s linear infinite;opacity:1}
.cj-orb{cursor:pointer;border:0;padding:0;transition:transform .08s,box-shadow .2s}
.cj-hud.listening .cj-orb{background:radial-gradient(circle,#fff 0 22%,#7fffd4 45%,#2fd3a4 100%);box-shadow:0 0 calc(14px + var(--lvl,0)*40px) rgba(90,255,200,.8);
  transform:scale(calc(1 + var(--lvl,0)*0.6));opacity:1;animation:none}
.cj-hud.thinking .cj-orb{animation:cj-orb 1s linear infinite;opacity:1}
.cj-mic{flex:none;font:700 11px var(--cj-font);color:var(--cj-dim);letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
.cj-hud.listening .cj-mic{color:#7fffd4}
.cj-heard{color:var(--cj-mint)}
.cj-hud.err .cj-orb{background:#ff6b7d;box-shadow:0 0 18px rgba(255,90,110,.6)}
.cj-input{flex:1;min-width:0;padding:10px 4px;border:0;outline:0;background:transparent;color:inherit;font:600 16px var(--cj-font)}
.cj-input::placeholder{color:var(--cj-dim);font-weight:400}
.cj-go{flex:none;padding:10px 18px;border-radius:999px;border:0;background:var(--cj-grad);color:#2a1630;font:800 15px var(--cj-font);
  cursor:pointer;box-shadow:0 6px 18px rgba(255,140,140,.35);transition:transform .15s,filter .15s}
.cj-go:hover{transform:translateY(-1px);filter:brightness(1.06)}
.cj-in{flex:none;padding:10px 14px;border-radius:999px;border:1px solid var(--cj-line);background:rgba(185,243,228,.14);color:var(--cj-mint);
  font:700 14px var(--cj-font);cursor:pointer;white-space:nowrap}
.cj-status{display:flex;justify-content:space-between;gap:12px;padding:6px 18px 0;font-size:12.5px;color:var(--cj-dim);min-height:1.4em}
.cj-status b{color:var(--cj-gold);font-weight:700;white-space:nowrap}
.cj-ideas{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:10px;transition:opacity .4s,transform .4s}
.cj-ideas.hidden{opacity:0;transform:translateY(8px);pointer-events:none;height:0;margin:0;overflow:hidden}
.cj-chip{padding:7px 12px;border-radius:999px;border:1px solid var(--cj-line);background:var(--cj-glass);backdrop-filter:blur(10px);
  -webkit-backdrop-filter:blur(10px);color:var(--cj-ink);font:600 13px var(--cj-font);cursor:pointer;transition:background .2s,transform .2s}
.cj-chip:hover{background:rgba(255,217,138,.18);transform:translateY(-1px)}
.cj-welcome{position:fixed;left:50%;top:5%;transform:translateX(-50%);z-index:2147482500;text-align:center;color:var(--cj-ink);
  font-family:var(--cj-font);pointer-events:none;transition:opacity .6s,transform .6s;text-shadow:0 2px 24px rgba(10,4,30,.55)}
.cj-welcome.hidden{opacity:0;transform:translate(-50%,-10px)}
.cj-welcome .brand{font:700 54px/1 var(--cj-serif);letter-spacing:-.01em;background:var(--cj-grad);-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 4px 20px rgba(255,150,140,.35))}
.cj-welcome .tag{margin-top:10px;font-size:17px;color:var(--cj-ink);opacity:.9}
.cj-welcome .how{margin-top:6px;font-size:13px;color:var(--cj-dim)}
`;

export class Hud {
  readonly root: HTMLDivElement;
  private input: HTMLInputElement;
  private stage: HTMLElement;
  private line: HTMLElement;
  private ideas: HTMLDivElement;
  private welcome: HTMLDivElement;
  private insideBtn: HTMLButtonElement;
  onInside: (() => void) | null = null;
  /** Push-to-talk on the orb: true = pressed, false = released. */
  onTalk: ((down: boolean) => void) | null = null;
  private mic!: HTMLElement;

  /** Show the Step inside / Step out button (worlds). */
  setInside(available: boolean, inside: boolean) {
    this.insideBtn.style.display = available ? '' : 'none';
    this.insideBtn.textContent = inside ? 'Step out' : 'Step inside';
  }

  /** Inside a world the bar builds things ahead of you, so say so. */
  setPlaceholder(text: string) { this.input.placeholder = text; }

  /** The welcome title and idea chips are for the empty room only. */
  setWelcome(on: boolean) {
    this.welcome.classList.toggle('hidden', !on);
    this.ideas.classList.toggle('hidden', !on);
  }

  constructor(onSubmit: (text: string) => void) {
    installTheme();
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    this.welcome = document.createElement('div');
    this.welcome.className = 'cj-welcome';
    this.welcome.innerHTML = `<div class="brand">Conjure</div>
      <div class="tag">Say a world. Step inside. Play its story.</div>`;
    document.body.appendChild(this.welcome);

    this.root = document.createElement('div');
    this.root.className = 'cj-hud';
    this.root.innerHTML = `
      <div class="cj-ideas" data-ideas>${IDEAS.map((i, n) => `<button type="button" class="cj-chip" data-idea="${n}">${i.icon} ${i.text}</button>`).join('')}</div>
      <form class="cj-bar">
        <button type="button" class="cj-orb" data-orb title="Hold to talk (or hold Space)"></button>
        <input class="cj-input" data-input placeholder="Describe a world to step into…" autocomplete="off"/>
        <span class="cj-mic" data-mic>Hold Space to talk</span>
        <button type="button" class="cj-in" data-inside style="display:none">Step inside</button>
        <button class="cj-go">Conjure ✦</button>
      </form>
      <div class="cj-status"><span data-line></span><b data-stage>Ready</b></div>`;
    this.input = this.root.querySelector('[data-input]')!;
    this.stage = this.root.querySelector('[data-stage]')!;
    this.line = this.root.querySelector('[data-line]')!;
    this.ideas = this.root.querySelector('[data-ideas]')!;
    this.insideBtn = this.root.querySelector('[data-inside]')!;
    this.mic = this.root.querySelector('[data-mic]')!;
    const orb = this.root.querySelector('[data-orb]') as HTMLButtonElement;
    let held = false;
    const up = () => { if (held) { held = false; this.onTalk?.(false); } };
    orb.addEventListener('pointerdown', (e) => { e.preventDefault(); held = true; orb.setPointerCapture(e.pointerId); this.onTalk?.(true); });
    orb.addEventListener('pointerup', up);
    orb.addEventListener('pointercancel', up);
    this.insideBtn.addEventListener('click', () => { this.insideBtn.blur(); this.onInside?.(); });
    this.ideas.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-idea]') as HTMLElement | null;
      if (!b) return;
      const idea = IDEAS[Number(b.dataset.idea)];
      b.blur();
      this.input.value = idea.text;
      onSubmit(idea.text);
    });
    this.root.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      // Give the keyboard back to the world (I, W/A/S/D) once the wish is sent.
      this.input.blur();
      if (text) onSubmit(text);
    });
    // Esc also leaves the prompt bar.
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.input.blur(); });
    document.body.appendChild(this.root);
  }

  setStage(stage: Stage, detail?: string) {
    this.stage.textContent = detail ? `${STAGE_LABEL[stage]} ${detail}` : STAGE_LABEL[stage];
    const busy = stage !== 'ready' && stage !== 'error';
    this.root.classList.toggle('busy', busy);
    this.root.classList.toggle('err', stage === 'error');
    if (busy) this.setWelcome(false);
  }

  say(text: string) { this.line.textContent = text; this.line.classList.remove('cj-heard'); }

  /** Voice state: the orb listens (and pulses with your voice), thinks, or rests. */
  setVoice(state: 'idle' | 'listening' | 'thinking', level = 0) {
    this.root.classList.toggle('listening', state === 'listening');
    this.root.classList.toggle('thinking', state === 'thinking');
    this.root.style.setProperty('--lvl', level.toFixed(2));
    this.mic.textContent = state === 'listening' ? 'Listening…' : state === 'thinking' ? 'Thinking…' : 'Hold Space to talk';
    if (state !== 'idle') this.setWelcome(false);
  }

  /** What was heard, shown in the status line. */
  heard(text: string) { this.line.textContent = `“${text}”`; this.line.classList.add('cj-heard'); }

  /** Live timer while the agent works. */
  setElapsed(seconds: number) {
    const base = this.stage.textContent?.replace(/ · [\d.]+s$/, '') ?? '';
    this.stage.textContent = `${base} · ${seconds.toFixed(1)}s`;
  }

  clearInput() { this.input.value = ''; }

  dispose() { this.root.remove(); this.welcome.remove(); }
}
