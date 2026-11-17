/**
 * GameRunner (StoryRunner): plays a world's 5-chapter cozy quest inside it.
 *
 *   intro → for each chapter: title card → hint → (travel to its place, guided
 *   by a chiming wisp) → arrive → play (wake / talk / find / collect / melody /
 *   choose) → payoff → next … → ending (depends on the choice) → end screen.
 *
 * The next chapter's place is requested while the current one is played, so
 * there's no waiting. The engine places collectibles, bells and choices itself,
 * so every chapter is playable even if the AI place fails. Stars: 3 per chapter,
 * minus one for asking a hint, minus one if it took a long time.
 */
import { AdditiveBlending, Sprite, SpriteMaterial, type Group, type Vector3 } from '@iwsdk/core';
import type { Narrator } from '../audio/narrator.js';
import { CHUNK } from '../engine/chunks.js';
import { isDry } from '../engine/terrain.js';
import { softTexture } from '../render/assets.js';
import type { CreationRuntime, PartRuntime } from '../render/build.js';
import { ASSETS, type AssetType, type PartT } from '../spec/schema.js';
import type { ChapterT, StoryT } from '../spec/story.js';
import type { WorldStreamer } from './streamer.js';

export interface QuestView {
  chapter: number; total: number; title: string; goal: string; progress: string | null; stars: number[]; kind: string;
}

export interface GameUI {
  chapter(n: number, total: number, title: string): void;
  quest(q: QuestView | null): void;
  end(summary: { title: string; ending: string; stars: number[]; seconds: number }): void;
}

export interface StoryHost {
  streamer(): WorldStreamer | null;
  origin(): CreationRuntime | null;
  /** Head position in world units. */
  head(): Vector3;
  scale(): number;
  show(title: string, detail: string): void;
  celebrate(x: number, y: number, z: number): void;
  chime(x: number, y: number, z: number): void;
  /** Play a part's sound and flash it, without counting as the user's touch. */
  demo(id: string): boolean;
  /** A placed part by id (any runtime), to show, hide or light it. */
  part(id: string): PartRuntime | null;
  /** The world's race track (anchor units), if it has one: points around the loop. */
  track(): [number, number][] | null;
  ui: GameUI;
}

const DIR: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const BELL_NOTES = ['C5', 'E5', 'G5', 'A5'];
const SEEK_LINES = ['Hee hee! You found me! Bet you cannot find me again!', 'Oh! Again? You are good at this. One more time!', 'Ready or not, here I go!'];
/** Pickup-sized assets for items, hiders and choices. */
const ITEM_SIZE: Partial<Record<AssetType, number>> = {
  crystal: 0.028, lantern: 0.045, flower: 0.025, mushroom: 0.025, rock: 0.025, character: 0.03, racecar: 0.03, tyres: 0.025,
  cactus: 0.035, tent: 0.04, bench: 0.022, balloon: 0.05, statue: 0.04, well: 0.04, campfire: 0.03, stall: 0.04, fountain: 0.04,
};
const AUTO_HINT_AFTER = 50;
const SLOW_CHAPTER = 150;

type State = 'idle' | 'telling' | 'travel' | 'play' | 'listening' | 'done';

export class StoryRunner {
  story: StoryT | null = null;
  chapter = -1;
  private state: State = 'idle';
  private wisp: Sprite;
  private wispTarget: [number, number, number] | null = null;
  private nextChime = 0;
  private started = false;
  private worldKey = '';
  private centers = new Map<number, [number, number]>();
  private requested = new Set<number>();
  private arrived = false;
  private collected = new Set<string>();
  private tune: number[] = [];
  private tuneAt = 0;
  private choice = -1;
  private found = 0;
  private gateAt = 0;
  private stars: number[] = [];
  private hintsUsed = 0;
  private chapterStart = 0;
  private lastProgress = 0;
  private autoHinted = false;
  private startedAt = 0;
  private now = 0;
  /** Bumped whenever the flow moves on, so a stale await can't change a newer chapter's state. */
  private token = 0;

  constructor(private host: StoryHost, private narrator: Narrator, anchor: Group) {
    this.wisp = new Sprite(new SpriteMaterial({ map: softTexture(), color: 0xbff6ff, transparent: true, depthWrite: false, blending: AdditiveBlending }));
    this.wisp.visible = false;
    this.wisp.renderOrder = 5;
    anchor.add(this.wisp);
  }

  get active() { return this.started && this.state !== 'done'; }
  get current(): ChapterT | null { return this.story?.chapters[this.chapter] ?? null; }
  /** Where the current chapter happens (world units). */
  get where(): [number, number] | null { return this.centers.get(this.chapter) ?? null; }
  get playState() { return this.state; }

  /** Story places you can travel to by voice ("take me to the glass bells"). Anchor units. */
  places(): { name: string; at: [number, number] }[] {
    const out: { name: string; at: [number, number] }[] = [];
    if (!this.story) return out;
    this.story.chapters.forEach((c, i) => {
      const at = this.centers.get(i);
      if (!at || !c.place || i > this.chapter + 1) return;
      const spot: [number, number] = [at[0], at[1] + 0.06];
      out.push({ name: c.title, at: spot });
      if (c.target && c.target !== 'Choice') out.push({ name: c.target, at: spot });
    });
    return out;
  }

  /** The two labels of a choice waiting to be made. */
  get options(): string[] | undefined {
    const c = this.current;
    return this.active && c?.kind === 'choose' ? c.options?.map((o) => o.label) : undefined;
  }

  /** Where the current chapter happens (anchor units, in front of its pieces), if away from home. */
  get destination(): [number, number] | null {
    const c = this.current, at = this.where;
    return this.active && c?.place && at ? [at[0], at[1] + 0.06] : null;
  }

  /** A story for the current world (replaces any previous one). */
  setStory(worldKey: string, story: StoryT) {
    if (worldKey === this.worldKey && this.story) return;
    this.reset();
    this.worldKey = worldKey;
    this.story = story;
    this.narrator.prefetch([{ text: story.intro }, { text: story.chapters[0].hint }]);
  }

  hasStoryFor(worldKey: string) { return this.worldKey === worldKey && !!this.story; }

  reset() {
    this.narrator.stop();
    this.story = null; this.worldKey = '';
    this.resetProgress();
    this.host.ui.quest(null);
  }

  private resetProgress() {
    this.chapter = -1; this.state = 'idle'; this.started = false;
    this.wisp.visible = false; this.wispTarget = null; this.arrived = false;
    this.collected.clear(); this.tune = []; this.choice = -1; this.stars = []; this.hintsUsed = 0;
    this.completing = false; this.token++;
  }

  /** Play again from chapter 1 (places already built stay). */
  async restart() {
    if (!this.story) return;
    this.narrator.stop();
    this.resetProgress();
    await this.start();
  }

  /** Called when the user steps inside the world. */
  async start() {
    if (!this.story || this.started) return;
    this.started = true;
    this.startedAt = this.now;
    this.state = 'telling';
    // Chapter 1's goal already counts during the intro (eager players skip ahead).
    this.chapter = 0;
    this.chapterStart = this.now;
    this.host.ui.chapter(0, this.story.chapters.length, this.story.title);
    const token = ++this.token;
    await this.narrator.say(this.story.intro);
    if (token !== this.token || !this.story) return;
    await this.begin(0);
  }

  /** The user asked for a hint (costs a star in this chapter). */
  hint() {
    const c = this.current;
    if (!c || !this.active) return;
    this.hintsUsed++;
    void this.narrator.say(c.hint);
    if (c.kind === 'melody' && this.state === 'play') this.playTune(1.2);
    this.pushQuest();
  }

  /**
   * Every played part goes through here. Goals count whenever they are touched,
   * even while the narrator is still talking (it stops and the story moves on).
   */
  onPlayed(rt: CreationRuntime, p: PartRuntime) {
    if (!this.started || !this.story) return;
    const c = this.current;
    if (!c || this.state === 'done' || this.completing) return;
    const id = p.spec.id;
    const gid = `g${this.chapter}`;
    const areaId = `s${this.chapter}`;

    {
      switch (c.kind) {
        case 'collect':
          if (id.startsWith(`${gid}-item-`) && !this.collected.has(id)) {
            this.collected.add(id);
            this.lastProgress = this.now;
            p.pivot.visible = false; p.zone.enabled = false;
            const [x, y, z] = p.base;
            this.host.chime(x, y + 0.02, z);
            this.pushQuest();
            if (this.collected.size >= (c.count ?? 3)) void this.complete(p);
            return;
          }
          break;
        case 'melody':
          if (id.startsWith(`${gid}-bell-`) && this.state !== 'listening' && this.tune.length) {
            const bell = Number(id.slice(id.lastIndexOf('-') + 1));
            this.lastProgress = this.now;
            if (bell === this.tune[this.tuneAt]) {
              this.tuneAt++;
              this.pushQuest();
              if (this.tuneAt >= this.tune.length) void this.complete(p);
            } else {
              this.tuneAt = 0;
              this.state = 'listening';
              void this.narrator.say('Almost! Listen once more.').then(() => this.playTune(0.4));
            }
            return;
          }
          break;
        case 'seek':
          if (id.startsWith(`${gid}-hider-`) && this.state === 'play') {
            const k = Number(id.slice(id.lastIndexOf('-') + 1));
            if (k !== this.found) break;
            this.found++;
            this.lastProgress = this.now;
            const [x, y, z] = p.base;
            this.host.chime(x, y + 0.02, z);
            p.pivot.visible = false; p.zone.enabled = false;
            this.pushQuest();
            if (this.found >= (c.count ?? 3)) { void this.complete(p); return; }
            this.showPiece(`${gid}-hider-${this.found}`, true);
            void this.narrator.say(SEEK_LINES[(this.found - 1) % SEEK_LINES.length], 'character', c.target);
            return;
          }
          break;
        case 'gates':
          // Gates count by walking through them (update); touching the next one counts too.
          if (id === `${gid}-gate-${this.gateAt}` && this.state === 'play') { this.passGate(p); return; }
          break;
        case 'choose':
          if (id.startsWith(`${gid}-choice-`)) {
            this.choice = Number(id.slice(id.lastIndexOf('-') + 1));
            void this.complete(p, c.options?.[this.choice]?.payoff);
            return;
          }
          break;
        case 'wake': case 'talk': case 'find': {
          const home = !c.place;
          const label = (p.spec.label ?? '').toLowerCase();
          const isGoal = id === `${gid}-goal`
            || (home
              ? rt === this.host.origin() && (id === c.target || id.startsWith(`${c.target}-`) || label === c.target.toLowerCase())
              : id === `${areaId}-goal` || (id.startsWith(`${areaId}-`) && label === c.target.toLowerCase())
                || (c.kind === 'talk' && id.startsWith(`${areaId}-`) && isCharacter(p)));
          if (isGoal) { void this.complete(p); return; }
          break;
        }
      }
    }
    // Characters help: they repeat the hint in their own voice.
    if (isCharacter(p) && this.state !== 'telling') void this.narrator.say(c.hint, 'character', p.spec.label?.replace(/ \d+$/, ''));
  }

  update(dt: number, time: number) {
    this.now = time;
    if (!this.started || !this.story) return;
    const s = this.host.streamer();
    const head = this.host.head();
    const c = this.current;

    if (c && this.state === 'travel' && s) {
      const center = this.centers.get(this.chapter);
      if (center) {
        const info = s.areaInfo(`s${this.chapter}`);
        if (info?.status === 'failed') this.fallbackArea(s, center);
        const d = Math.hypot(head.x - center[0], head.z - center[1]);
        if (!this.arrived && d < 0.3) {
          this.arrived = true;
          this.state = 'telling';
          const token = this.token;
          void this.narrator.say(c.arrive ?? 'You have arrived.').then(() => { if (token === this.token) this.onArrived(); });
        }
      }
    }
    if (c && c.kind === 'gates' && this.state === 'play') {
      const g = this.host.part(`g${this.chapter}-gate-${this.gateAt}`);
      // Big track gates span the road: anywhere through them counts.
      const reach = g && g.spec.shape.kind === 'asset' ? Math.max(0.05, g.spec.shape.size * 0.8) : 0.05;
      if (g && Math.hypot(head.x - g.base[0], head.z - g.base[2]) < reach) this.passGate(g);
    }
    if (c && (this.state === 'play' || this.state === 'travel') && !this.autoHinted && time - Math.max(this.chapterStart, this.lastProgress) > AUTO_HINT_AFTER) {
      this.autoHinted = true;
      void this.narrator.say(c.hint);
    }
    this.updateWispTarget(s);
    this.moveWisp(dt, time, head, s);
  }

  // ---------------------------------------------------------------------------

  private async begin(i: number) {
    const story = this.story!;
    const c = story.chapters[i];
    const token = ++this.token;
    this.chapter = i;
    this.arrived = false;
    this.collected.clear(); this.tune = []; this.tuneAt = 0; this.found = 0; this.gateAt = 0;
    this.hintsUsed = 0; this.autoHinted = false;
    this.chapterStart = this.now; this.lastProgress = this.now;
    this.state = 'telling';
    this.host.ui.chapter(i + 1, story.chapters.length, c.title);
    this.pushQuest();
    this.ensurePlace(i);
    this.ensurePlace(i + 1); // build the next place while this chapter is played
    const next = story.chapters[i + 1];
    this.narrator.prefetch([{ text: c.hint }, { text: c.arrive ?? '' }, { text: c.payoff }, ...(next ? [{ text: next.hint }] : [])]);
    await this.narrator.say(c.hint);
    if (token !== this.token) return; // already done while the hint was being said
    if (c.place) { this.state = 'travel'; return; }
    this.onArrived();
  }

  /** At the chapter's spot: start its play. */
  private onArrived() {
    const c = this.current!;
    if (c.kind === 'find') { void this.complete(null); return; }
    this.state = 'play';
    const gid = `g${this.chapter}`;
    if (c.kind === 'seek') for (let k = 1; k < (c.count ?? 3); k++) this.showPiece(`${gid}-hider-${k}`, false);
    if (c.kind === 'gates') this.lightGate();
    this.pushQuest();
    if (c.kind === 'melody') { this.state = 'listening'; this.playTune(0.6); }
  }

  private showPiece(id: string, on: boolean) {
    const p = this.host.part(id);
    if (p) { p.pivot.visible = on; p.zone.enabled = on; if (on) p.flash = 1.4; }
  }

  /** The next gate glows; passed ones fade away. */
  private lightGate() {
    const g = this.host.part(`g${this.chapter}-gate-${this.gateAt}`);
    if (g) g.flash = 2.5;
  }

  private passGate(g: PartRuntime) {
    const c = this.current!;
    this.gateAt++;
    this.lastProgress = this.now;
    const [x, y, z] = g.base;
    this.host.chime(x, y + 0.03, z);
    this.host.demo(g.spec.id);
    g.pivot.visible = false; g.zone.enabled = false;
    this.pushQuest();
    if (this.gateAt >= (c.count ?? 4)) { void this.complete(g); return; }
    this.lightGate();
  }

  /** Where chapter i happens: home, or a step in its direction from the previous place. */
  private centerFor(i: number): [number, number] {
    const known = this.centers.get(i);
    if (known) return known;
    const c = this.story!.chapters[i];
    let center: [number, number] = [0, 0];
    if (c.place) {
      let prev: [number, number] = [0, 0];
      for (let k = i - 1; k >= 0; k--) { if (this.story!.chapters[k].place) { prev = this.centerFor(k); break; } }
      const [dx, dz] = DIR[c.direction ?? 'north'];
      center = [prev[0] + dx * CHUNK * 1.6, prev[1] + dz * CHUNK * 1.6];
    }
    this.centers.set(i, center);
    return center;
  }

  /** Ask for chapter i's place (if it has one) and lay out its game pieces. */
  private ensurePlace(i: number) {
    const story = this.story!;
    const c = story.chapters[i];
    const s = this.host.streamer();
    if (!c || !s || this.requested.has(i)) return;
    this.requested.add(i);
    const center = this.centerFor(i);
    if (c.place) void s.storyArea(`s${i}`, center, { chapter: c.title, place: c.place, target: c.target });
    const pieces = this.gamePieces(i, c, s, center);
    if (pieces.length) s.placeLocalArea(`g${i}`, center, c.title, pieces);
  }

  /** Engine-made pieces: collectibles, bells, choices (play-zone coords around the centre). */
  private gamePieces(i: number, c: ChapterT, s: WorldStreamer, center: [number, number]): PartT[] {
    const dryAt = (rx: number, rz: number) => isDry(s.terrain, center[0] + rx, center[1] + rz + 0.06, 0.004);
    const spot = (r0: number, r1: number, k: number, n: number): [number, number] => {
      for (let t = 0; t < 24; t++) {
        const a = (k / n) * Math.PI * 2 + t * 0.7 + i, r = r0 + ((t * 0.37 + k * 0.21) % 1) * (r1 - r0);
        const x = Math.cos(a) * r, z = Math.sin(a) * r - 0.06;
        if (dryAt(x, z)) return [x, z];
      }
      return [Math.cos(k) * r0, Math.sin(k) * r0 - 0.06];
    };
    const out: PartT[] = [];
    if (c.place && (c.kind === 'wake' || c.kind === 'talk')) {
      // The engine always brings its own goal, so the chapter works whatever the builder made.
      out.push(c.kind === 'talk'
        ? { id: 'goal', label: c.speaker ?? c.target, shape: { kind: 'asset', type: 'character', size: 0.044 }, transform: { pos: [0.05, 0, 0.02], rot: [0, 200, 0] }, verb: 'strike', sound: { voice: 'pad', pitch: 'E4', decay: 1.2 }, react: [{ do: 'jump' }] }
        : { id: 'goal', label: c.target, shape: { kind: 'asset', type: itemAsset(c.item, c.target, goalAsset(c.target)), size: 0.06 }, transform: { pos: [0, 0, -0.02] }, material: { color: 'glow', glow: 0.6 }, verb: 'strike', sound: { voice: 'bell', pitch: 'E5', decay: 2 }, react: [{ do: 'glow' }] });
    }
    if (c.kind === 'collect') {
      const n = c.count ?? 3;
      const look = itemAsset(c.item, c.target, 'crystal');
      for (let k = 0; k < n; k++) {
        const [x, z] = spot(0.1, 0.24, k, n);
        out.push({
          id: `item-${k}`, label: c.target, shape: { kind: 'asset', type: look, size: ITEM_SIZE[look] ?? 0.028 }, transform: { pos: [x, 0, z] },
          material: { color: 'glow', glow: 0.8 }, verb: 'strike', sound: { voice: 'bell', pitch: BELL_NOTES[k % 4], decay: 1.4, tone: 0.8 },
          motion: { type: 'bob', amp: 0.6, freq: 0.5 }, react: [{ do: 'burst' }],
        });
      }
    }
    if (c.kind === 'melody') {
      for (let k = 0; k < 4; k++) {
        const a = Math.PI * (0.25 + 0.5 * (k / 3));
        out.push({
          id: `bell-${k}`, label: `Bell ${k + 1}`, shape: { kind: 'asset', type: 'lantern', size: 0.05 },
          transform: { pos: [Math.cos(a) * 0.09 - 0.0, 0, -Math.sin(a) * 0.09 + 0.02] },
          verb: 'strike', sound: { voice: 'bell', pitch: BELL_NOTES[k], decay: 1.6, tone: 0.7 }, react: [{ do: 'glow' }],
        });
      }
    }
    if (c.kind === 'gates') {
      const n = c.count ?? 4;
      const track = this.host.track();
      for (let k = 0; k < n; k++) {
        let x: number, z: number, yaw: number;
        if (track && !c.place) {
          // At home on a race track: gates around the lap (absolute → relative to the centre).
          const j = Math.floor(((k + 1) / (n + 1)) * track.length) % track.length;
          const [px, pz] = track[j], [qx, qz] = track[(j + 1) % track.length];
          x = px - center[0]; z = pz - center[1] - 0.06; yaw = (Math.atan2(qx - px, qz - pz) * 180) / Math.PI;
        } else {
          // A winding path leading away from where you arrive.
          const t = k / Math.max(1, n - 1);
          x = Math.sin(t * 5 + i) * 0.12; z = 0.1 - t * 0.42; yaw = (Math.atan2(Math.cos(t * 5 + i) * 0.6, -0.42) * 180) / Math.PI;
          if (!dryAt(x, z)) x = -x;
        }
        out.push({
          id: `gate-${k}`, label: `${c.target} ${k + 1}`, shape: { kind: 'asset', type: 'portal', size: track && !c.place ? 0.2 : 0.075 },
          transform: { pos: [x, 0, z], rot: [0, yaw, 0] }, material: { color: 'glow', glow: 0.7 },
          verb: 'strike', sound: { voice: 'bell', pitch: BELL_NOTES[k % 4], decay: 1.4, tone: 0.8 }, react: [{ do: 'burst' }],
        });
      }
    }
    if (c.kind === 'seek') {
      const n = c.count ?? 3;
      const look = itemAsset(c.item, c.target, 'character');
      for (let k = 0; k < n; k++) {
        const [x, z] = spot(0.12, 0.26, k * 2 + 1, n * 2);
        out.push({
          id: `hider-${k}`, label: c.target, shape: { kind: 'asset', type: look, size: look === 'character' ? 0.03 : ITEM_SIZE[look] ?? 0.03 },
          transform: { pos: [x, 0, z], rot: [0, (k * 137) % 360, 0] }, verb: 'strike',
          sound: { voice: 'fx', pitch: 900 + k * 120, decay: 0.3 }, react: [{ do: 'jump' }],
        });
      }
    }
    if (c.kind === 'choose' && c.options) {
      const types = c.options.map((o, k) => itemAsset(undefined, o.label, k ? 'crystal' : 'lantern'));
      c.options.forEach((o, k) => out.push({
        id: `choice-${k}`, label: o.label, shape: { kind: 'asset', type: types[k], size: ITEM_SIZE[types[k]] ? ITEM_SIZE[types[k]]! * 1.8 : k ? 0.05 : 0.065 },
        transform: { pos: [k ? 0.07 : -0.07, 0, -0.02] }, verb: 'strike',
        sound: { voice: 'bell', pitch: k ? 'E5' : 'C5', decay: 1.8 }, react: [{ do: 'glow' }],
      }));
    }
    return out;
  }

  /** The engine plays the tune; then it's the user's turn. */
  private playTune(delay: number) {
    const c = this.current;
    if (!c || c.kind !== 'melody') return;
    if (!this.tune.length) {
      const len = 3 + (this.chapter % 2);
      for (let k = 0; k < len; k++) this.tune.push((k * 3 + this.chapter + 1) % 4);
    }
    this.tuneAt = 0;
    this.state = 'listening';
    const gid = `g${this.chapter}`;
    this.tune.forEach((b, k) => setTimeout(() => this.host.demo(`${gid}-bell-${b}`), (delay + k * 0.75) * 1000));
    setTimeout(() => { if (this.state === 'listening') { this.state = 'play'; this.pushQuest(); } }, (delay + this.tune.length * 0.75 + 0.2) * 1000);
    this.pushQuest();
  }

  private completing = false;

  private async complete(p: PartRuntime | null, payoff?: string) {
    const story = this.story!;
    const c = story.chapters[this.chapter];
    if (this.completing) return;
    this.completing = true;
    const token = ++this.token;
    // The user did it while the narrator was still talking: cut the line short.
    this.narrator.stop();
    this.state = 'telling';
    const head = this.host.head();
    const [x, y, z] = p ? p.base : [head.x, head.y, head.z];
    this.host.celebrate(x, y, z);
    const took = this.now - this.chapterStart;
    this.stars[this.chapter] = Math.max(1, 3 - (this.hintsUsed ? 1 : 0) - (took > SLOW_CHAPTER ? 1 : 0));
    this.pushQuest();
    const speaker = c.kind === 'talk' ? (c.speaker ?? p?.spec.label ?? undefined) : undefined;
    await this.narrator.say(payoff ?? c.payoff, c.kind === 'talk' ? 'character' : 'narrator', speaker);
    this.completing = false;
    if (token !== this.token) return;
    if (this.chapter + 1 < story.chapters.length) { await this.begin(this.chapter + 1); return; }
    this.state = 'done';
    this.wisp.visible = false;
    this.host.celebrate(x, y + 0.02, z);
    const ending = (this.choice >= 0 && story.chapters.find((ch) => ch.kind === 'choose')?.options?.[this.choice]?.ending) || story.ending;
    this.host.ui.quest(null);
    await this.narrator.say(ending);
    this.host.ui.end({ title: story.title, ending, stars: this.stars.slice(), seconds: this.now - this.startedAt });
  }

  private pushQuest() {
    const c = this.current;
    if (!c || !this.story) return;
    let progress: string | null = null;
    if (c.kind === 'collect') progress = `${this.collected.size} / ${c.count ?? 3} ${c.target}`;
    if (c.kind === 'melody') progress = this.state === 'listening' ? 'Listen…' : `Your turn: ${this.tuneAt} / ${this.tune.length || 3} notes`;
    if (c.kind === 'seek') progress = `Found ${this.found} / ${c.count ?? 3}`;
    if (c.kind === 'gates') progress = `Gate ${Math.min(this.gateAt + 1, c.count ?? 4)} of ${c.count ?? 4}`;
    if (c.kind === 'choose') progress = c.options?.map((o) => o.label).join('  or  ') ?? null;
    if (this.state === 'travel') progress = `Follow the light ${c.direction ?? ''}`.trim();
    this.host.ui.quest({
      chapter: this.chapter + 1, total: this.story.chapters.length, title: c.title, goal: c.goal, progress, kind: c.kind,
      stars: this.story.chapters.map((_, k) => this.stars[k] ?? 0),
    });
  }

  private updateWispTarget(s: WorldStreamer | null) {
    const c = this.current;
    if (!c || !s || this.state === 'done' || this.state === 'idle') { this.wispTarget = null; return; }
    const center = this.centers.get(this.chapter) ?? [0, 0];
    const ground = (x: number, z: number) => s.groundAt(x, z);
    if (this.state === 'travel') { this.wispTarget = [center[0], ground(center[0], center[1]), center[1]]; return; }
    const gid = `g${this.chapter}`;
    const pieces = s.areaInfo(gid)?.parts ?? [];
    let target: PartT | undefined;
    if (c.kind === 'collect') target = pieces.find((q) => !this.collected.has(q.id));
    else if (c.kind === 'gates') target = pieces.find((q) => q.id === `${gid}-gate-${this.gateAt}`);
    else if (c.kind === 'seek') target = this.autoHinted ? pieces.find((q) => q.id === `${gid}-hider-${this.found}`) : undefined;
    else if (c.kind === 'melody' || c.kind === 'choose') target = pieces[0];
    else if (!c.place) {
      const o = this.host.origin()?.parts.find((q) => q.spec.id === c.target || q.spec.id.startsWith(`${c.target}-`));
      if (o) { this.wispTarget = [o.base[0], o.base[1] + (o.spec.shape.kind === 'asset' ? o.spec.shape.size : 0.05), o.base[2]]; return; }
    } else target = s.areaInfo(`s${this.chapter}`)?.parts.find((q) => q.id.endsWith('-goal'));
    if (target) {
      const [x, y, z] = target.transform.pos;
      this.wispTarget = [x, ground(x, z) + y + (target.shape.kind === 'asset' ? target.shape.size : 0.04), z];
    } else this.wispTarget = [center[0], ground(center[0], center[1]), center[1]];
  }

  /** The wisp leads: a few metres ahead of you toward the target, then onto it. It chimes so you can follow by ear. */
  private moveWisp(dt: number, time: number, head: Vector3, s: WorldStreamer | null) {
    const scale = Math.max(1, this.host.scale());
    if (!this.wispTarget) { this.wisp.visible = false; return; }
    const [tx, ty, tz] = this.wispTarget;
    const dx = tx - head.x, dz = tz - head.z, dist = Math.hypot(dx, dz) || 1;
    const near = dist < 8 / scale;
    const x = near ? tx : head.x + (dx / dist) * Math.min(dist, 6 / scale);
    const z = near ? tz : head.z + (dz / dist) * Math.min(dist, 6 / scale);
    const groundY = s?.groundAt(x, z) ?? ty;
    const y = Math.max(near ? ty : groundY, groundY) + (1.2 + 0.15 * Math.sin(time * 2.2)) / scale;
    const k = 1 - Math.exp(-dt * 2.5);
    if (!this.wisp.visible) this.wisp.position.set(x, y, z);
    this.wisp.position.x += (x - this.wisp.position.x) * k;
    this.wisp.position.y += (y - this.wisp.position.y) * k;
    this.wisp.position.z += (z - this.wisp.position.z) * k;
    this.wisp.scale.setScalar((0.9 + 0.2 * Math.sin(time * 5)) / scale);
    this.wisp.visible = true;
    if (time > this.nextChime && dist > 3 / scale) {
      this.nextChime = time + 3;
      this.host.chime(this.wisp.position.x, this.wisp.position.y, this.wisp.position.z);
    }
  }

  /** The builder couldn't make the place: put a goal, a keeper and a gate there ourselves. */
  private fallbackArea(s: WorldStreamer, center: [number, number]) {
    const c = this.current!;
    const parts: PartT[] = [
      { id: 'goal', label: c.target, shape: { kind: 'asset', type: 'crystal', size: 0.08 }, transform: { pos: [0, 0, -0.1] }, verb: 'strike', sound: { voice: 'bell', pitch: 'E5', decay: 2 }, react: [{ do: 'glow' }] },
      { id: 'keeper', label: c.speaker ?? 'Keeper', shape: { kind: 'asset', type: 'character', size: 0.042 }, transform: { pos: [0.12, 0, 0.04] }, verb: 'strike', react: [{ do: 'jump' }] },
      { id: 'portal', label: 'Old gate', shape: { kind: 'asset', type: 'portal', size: 0.12 }, transform: { pos: [-0.16, 0, -0.16] }, verb: 'strike', react: [{ do: 'glow' }] },
    ];
    s.placeLocalArea(`s${this.chapter}`, center, c.title, parts);
  }
}

/** The look of a chapter's items: the model's pick if it is a known asset, else from the name. */
function itemAsset(item: string | undefined, name: string, fallback: AssetType): AssetType {
  if (item && (ASSETS as readonly string[]).includes(item)) return item as AssetType;
  const n = name.toLowerCase();
  if (/car|racer|kart/.test(n)) return 'racecar';
  if (/tyre|tire|wheel/.test(n)) return 'tyres';
  if (/kid|child|fox|cat|pup|dog|friend|sprite|pip|elf|imp/.test(n)) return 'character';
  return n ? (goalAsset(name) === 'crystal' ? fallback : goalAsset(name)) : fallback;
}

/** A fitting thing for a named goal ("the Moon Bell", "an old well"). */
function goalAsset(name: string): 'crystal' | 'lantern' | 'portal' | 'well' | 'statue' | 'campfire' | 'mushroom' | 'flower' {
  const n = name.toLowerCase();
  if (/bell|lamp|lantern|light|beacon/.test(n)) return 'lantern';
  if (/gate|door|portal|arch/.test(n)) return 'portal';
  if (/well|fountain|water|spring/.test(n)) return 'well';
  if (/statue|stone|idol|guardian/.test(n)) return 'statue';
  if (/fire|flame|hearth/.test(n)) return 'campfire';
  if (/mushroom|toadstool/.test(n)) return 'mushroom';
  if (/flower|bloom|seed|rose/.test(n)) return 'flower';
  return 'crystal';
}

function isCharacter(p: PartRuntime) {
  return p.spec.shape.kind === 'asset' && p.spec.shape.type === 'character';
}
