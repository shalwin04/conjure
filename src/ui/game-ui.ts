/**
 * Game interface for desktop and the emulator (the headset gets the same
 * subtitles and quest line in 3D, see render/caption.ts):
 *
 *   quest card (top left)    chapter n of 5, title, goal, progress, stars, Hint
 *   subtitles (bottom)       film-style, speaker name, words revealed with the voice
 *   transcript (right, T)    the whole story so far
 *   title cards              "Chapter 2 · Lost Lights" fades in and out
 *   end screen               ending, stars, time, Play again / Create a new world
 */
import type { GameUI, QuestView } from '../world/story.js';
import { installTheme } from './theme.js';

const css = `
.cj-ui{position:fixed;inset:0;pointer-events:none;z-index:2147482000;font:15px/1.45 var(--cj-font);color:var(--cj-ink)}
.cj-card{position:absolute;left:20px;top:20px;width:min(340px,40vw);padding:14px 16px;border-radius:16px;
  background:var(--cj-glass);backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3);border:1px solid var(--cj-line);box-shadow:var(--cj-shadow);pointer-events:auto;
  transition:opacity .4s,transform .4s}
.cj-card.hidden{opacity:0;transform:translateY(-8px);pointer-events:none}
.cj-kicker{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#ffd98a}
.cj-title{font:700 21px/1.2 var(--cj-serif);margin:4px 0 6px}
.cj-goal{font-size:15px;opacity:.95}
.cj-progress{margin-top:6px;font-size:13px;color:#b9f3e4}
.cj-row{display:flex;align-items:center;justify-content:space-between;margin-top:10px}
.cj-stars{letter-spacing:2px;font-size:13px;color:#ffd98a}
.cj-btn{pointer-events:auto;border:0;border-radius:999px;padding:6px 12px;font:700 13px var(--cj-font);cursor:pointer;
  background:var(--cj-grad);color:#2a1630}
.cj-btn.ghost{background:rgba(255,255,255,.12);color:#f6f4ee}
.cj-sub{position:absolute;left:50%;bottom:120px;transform:translateX(-50%);width:min(860px,86vw);text-align:center;
  transition:opacity .5s}
.cj-sub.hidden{opacity:0}
.cj-sub .who{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#ffd98a;margin-bottom:4px}
.cj-sub .line{display:inline;font-size:22px;line-height:1.45;padding:4px 10px;border-radius:8px;background:rgba(14,12,20,.62);
  box-decoration-break:clone;-webkit-box-decoration-break:clone;text-shadow:0 1px 2px rgba(0,0,0,.5)}
.cj-sub .line span{transition:opacity .25s}
.cj-sub .line span.dim{opacity:.18}
.cj-tbtn{position:absolute;right:20px;top:64px}
.cj-trans{position:absolute;right:20px;top:104px;bottom:150px;width:min(360px,36vw);overflow:auto;padding:14px 16px;border-radius:16px;
  background:var(--cj-glass-strong);backdrop-filter:blur(14px);border:1px solid var(--cj-line);pointer-events:auto;transition:opacity .3s,transform .3s}
.cj-trans.hidden{opacity:0;transform:translateX(12px);pointer-events:none}
.cj-trans h3{margin:0 0 8px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#ffd98a}
.cj-trans .e{margin:0 0 10px}
.cj-trans .e b{display:block;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#b9f3e4}
.cj-trans .ch{margin:14px 0 8px;font-weight:650;color:#ffd98a}
.cj-titlecard{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  text-align:center;opacity:0;transition:opacity .9s;text-shadow:0 2px 18px rgba(0,0,0,.6)}
.cj-titlecard.show{opacity:1}
.cj-titlecard .k{font-size:14px;letter-spacing:.3em;text-transform:uppercase;color:#ffd98a}
.cj-titlecard .t{font-size:44px;font-weight:700;margin-top:6px;font-family:var(--cj-serif)}
.cj-end{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(10,8,16,.55);
  opacity:0;transition:opacity .6s;pointer-events:none}
.cj-end.show{opacity:1;pointer-events:auto}
.cj-end .box{width:min(520px,88vw);padding:28px;border-radius:22px;background:var(--cj-glass-strong);border:1px solid var(--cj-line);text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.cj-end h2{margin:4px 0 10px;font:700 32px var(--cj-serif)}
.cj-end p{font-size:17px;opacity:.95}
.cj-end .stars{font-size:30px;color:#ffd98a;letter-spacing:4px;margin:12px 0 4px}
.cj-end .meta{font-size:13px;opacity:.7;margin-bottom:18px}
.cj-end .actions{display:flex;gap:10px;justify-content:center}
`;

export class GameOverlay implements GameUI {
  private root = document.createElement('div');
  private card: HTMLDivElement;
  private sub: HTMLDivElement;
  private trans: HTMLDivElement;
  private titleCard: HTMLDivElement;
  private endEl: HTMLDivElement;
  private subTimer = 0;
  private wordTimer = 0;
  onHint: (() => void) | null = null;
  onRestart: (() => void) | null = null;
  onCreate: (() => void) | null = null;

  constructor() {
    installTheme();
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    this.root.className = 'cj-ui';
    this.root.innerHTML = `
      <div class="cj-card hidden" data-card></div>
      <div class="cj-sub hidden" data-sub><div class="who"></div><div class="line"></div></div>
      <button class="cj-btn ghost cj-tbtn" data-tbtn title="Transcript (T)">Story transcript</button>
      <div class="cj-trans hidden" data-trans><h3>Story so far</h3><div data-entries></div></div>
      <div class="cj-titlecard" data-title><div class="k"></div><div class="t"></div></div>
      <div class="cj-end" data-end></div>`;
    document.body.appendChild(this.root);
    this.card = this.root.querySelector('[data-card]')!;
    this.sub = this.root.querySelector('[data-sub]')!;
    this.trans = this.root.querySelector('[data-trans]')!;
    this.titleCard = this.root.querySelector('[data-title]')!;
    this.endEl = this.root.querySelector('[data-end]')!;
    this.root.querySelector('[data-tbtn]')!.addEventListener('click', (e) => { (e.target as HTMLElement).blur(); this.toggleTranscript(); });
  }

  /** Film-style subtitle; words light up over `seconds`, the whole line goes to the transcript. */
  line(text: string, speaker: string, seconds: number) {
    const who = this.sub.querySelector('.who')!, line = this.sub.querySelector('.line')!;
    who.textContent = speaker;
    line.innerHTML = '';
    const words = text.split(/\s+/).filter(Boolean);
    const spans = words.map((w) => { const s = document.createElement('span'); s.textContent = `${w} `; s.className = 'dim'; line.appendChild(s); return s; });
    this.sub.classList.remove('hidden');
    clearInterval(this.wordTimer); clearTimeout(this.subTimer);
    let n = 0;
    const step = Math.max(60, (seconds * 1000) / Math.max(1, words.length));
    this.wordTimer = window.setInterval(() => { if (n < spans.length) spans[n++].classList.remove('dim'); else clearInterval(this.wordTimer); }, step);
    this.subTimer = window.setTimeout(() => this.sub.classList.add('hidden'), seconds * 1000 + 3500);
    this.addEntry(speaker, text);
  }

  chapter(n: number, total: number, title: string) {
    const k = this.titleCard.querySelector('.k')!, t = this.titleCard.querySelector('.t')!;
    k.textContent = n === 0 ? 'A story begins' : `Chapter ${n} of ${total}`;
    t.textContent = title;
    if (n > 0) this.addHeading(`Chapter ${n} · ${title}`); else this.addHeading(title);
    this.titleCard.classList.add('show');
    window.setTimeout(() => this.titleCard.classList.remove('show'), 2800);
  }

  quest(q: QuestView | null) {
    if (!q) { this.card.classList.add('hidden'); return; }
    const stars = q.stars.map((s) => '★'.repeat(s) + '☆'.repeat(3 - s)).join(' ');
    this.card.innerHTML = `
      <div class="cj-kicker">Chapter ${q.chapter} of ${q.total}</div>
      <div class="cj-title"></div>
      <div class="cj-goal"></div>
      ${q.progress ? '<div class="cj-progress"></div>' : ''}
      <div class="cj-row"><span class="cj-stars">${stars}</span><button class="cj-btn" data-hint title="Hint (H)">Hint</button></div>`;
    this.card.querySelector('.cj-title')!.textContent = q.title;
    this.card.querySelector('.cj-goal')!.textContent = q.goal;
    if (q.progress) this.card.querySelector('.cj-progress')!.textContent = q.progress;
    this.card.querySelector('[data-hint]')!.addEventListener('click', (e) => { (e.target as HTMLElement).blur(); this.onHint?.(); });
    this.card.classList.remove('hidden');
  }

  end(s: { title: string; ending: string; stars: number[]; seconds: number }) {
    const got = s.stars.reduce((a, b) => a + (b || 0), 0), max = s.stars.length * 3;
    const m = Math.floor(s.seconds / 60), sec = Math.round(s.seconds % 60);
    this.endEl.innerHTML = `<div class="box">
      <div class="cj-kicker">The end</div><h2></h2><p></p>
      <div class="stars">${'★'.repeat(Math.round((got / max) * 5))}${'☆'.repeat(5 - Math.round((got / max) * 5))}</div>
      <div class="meta">${got} of ${max} stars · ${m}m ${sec}s</div>
      <div class="actions"><button class="cj-btn" data-again>Play again</button><button class="cj-btn ghost" data-new>Create a new world</button><button class="cj-btn ghost" data-stay>Keep exploring</button></div></div>`;
    this.endEl.querySelector('h2')!.textContent = s.title;
    this.endEl.querySelector('p')!.textContent = s.ending;
    const close = () => this.endEl.classList.remove('show');
    this.endEl.querySelector('[data-again]')!.addEventListener('click', () => { close(); this.onRestart?.(); });
    this.endEl.querySelector('[data-new]')!.addEventListener('click', () => { close(); this.onCreate?.(); });
    this.endEl.querySelector('[data-stay]')!.addEventListener('click', close);
    this.endEl.classList.add('show');
  }

  toggleTranscript() { this.trans.classList.toggle('hidden'); }

  clear() {
    this.root.querySelector('[data-entries]')!.innerHTML = '';
    this.quest(null);
    this.endEl.classList.remove('show');
  }

  dispose() { this.root.remove(); }

  private addEntry(speaker: string, text: string) {
    const list = this.root.querySelector('[data-entries]')!;
    const e = document.createElement('div');
    e.className = 'e';
    const b = document.createElement('b'); b.textContent = speaker;
    e.append(b, document.createTextNode(text));
    list.appendChild(e);
    this.trans.scrollTop = this.trans.scrollHeight;
  }

  private addHeading(text: string) {
    const list = this.root.querySelector('[data-entries]')!;
    const h = document.createElement('div'); h.className = 'ch'; h.textContent = text;
    list.appendChild(h);
  }
}
