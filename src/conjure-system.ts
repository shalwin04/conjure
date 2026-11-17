/**
 * ConjureSystem: the heart of the client. Each frame it reads the hands and
 * controllers, moves the world (Navigator), streams an endless world around
 * the user when they step inside one (WorldStreamer), runs the interaction
 * verbs and turns events into sound and visual feedback. Also owns loading
 * creations, the assembly animation and placing the play zone.
 */
import {
  ACESFilmicToneMapping, Color, createSystem, Fog, Group, NoToneMapping, Pressed, Quaternion, RayInteractable, Vector3, VisibilityState,
} from '@iwsdk/core';
import { objectToWorld } from './engine/chunks.js';
import { assetDims } from './spec/schema.js';
import { updateSharedAssets } from './render/assets.js';
import type { Entity } from '@iwsdk/core';
import { Narrator } from './audio/narrator.js';
import { Soundscape } from './audio/soundscape.js';
import { Synth } from './audio/synth.js';
import { ConjurePart } from './conjure-components.js';
import { HandTracker, PALM } from './engine/hands.js';
import { WORLD_BASE_Y } from './engine/terrain.js';
import { TUNING, VerbEngine, type PartZone } from './engine/verbs.js';
import { fetchStory, streamConjure, streamCritique } from './net/conjure-client.js';
import { fixStory, storyRequestFor, templateStory, type StoryT } from './spec/story.js';
import { StoryRunner } from './world/story.js';
import { snapshotCreation } from './render/snapshot.js';
import { addPart, ASSEMBLY_STAGGER, createRuntime, disposeCreation, syncZones, type CreationRuntime, type PartRuntime } from './render/build.js';
import { triggerHitFx, triggerReaction, updateFx } from './render/fx.js';
import { WorldEnv } from './render/world.js';
import { Orb } from './render/orb.js';
import { PALETTE_COLORS } from './render/palettes.js';
import { Stage } from './render/stage.js';
import { PRESET_ORDER, PRESETS } from './spec/presets.js';
import type { ConjureEvent, ReferenceView } from './spec/protocol.js';
import { validateCreation, type CreationHeaderT, type CreationT, type PartT, type SoundRecipeT } from './spec/schema.js';
import { Hud } from './ui/hud.js';
import { GameOverlay } from './ui/game-ui.js';
import { Caption3D } from './render/caption.js';
import { NAV, Navigator, type Grab, type NavInput } from './world/navigator.js';
import { STREAM, WorldStreamer } from './world/streamer.js';
import { VoiceController } from './voice/voice.js';
import { trackLoop } from './engine/track.js';
import { matchName, type ListenContext, type VoiceCommandT } from './spec/voice.js';

/** Where the play zone sits relative to the head (metres). */
const PLACEMENT = {
  immersive: { forward: 0.5, down: 0.4 },
  desktop: { forward: 1.0, down: 0.12 },
};
/** Frames to wait after entering XR before placing, so the head pose has settled. */
const PLACEMENT_SETTLE_FRAMES = 20;
/** Inside a world, a wish that isn't an edit of the world builds something where you look. */
const EDIT_WISH = /^\s*(new\b|start over|make it\b|make everything|make the\b|turn\b|change\b|remove\b|delete\b|undo\b|recolou?r\b)/i;

interface Mounted { root: Entity; entities: Entity[] }

export class ConjureSystem extends createSystem({
  pressedParts: { required: [ConjurePart, Pressed] },
}) {
  private synth = new Synth();
  private soundscape = new Soundscape(this.synth);
  private hands = new HandTracker();
  private verbs = new VerbEngine();
  /** The creation the user conjured (the origin of a world). */
  private creation: CreationRuntime | null = null;
  private hud: Hud | null = null;
  private orb = new Orb();
  private orbHome = new Vector3();
  /** Wish + reference of the last new creation, for the Critic. */
  private lastWish = '';
  private lastReference: ReferenceView | null = null;
  /** Set when a new creation lands; the critique runs once it has fully assembled. */
  private critiquePending = false;
  private critiqueReadyAt = 0;
  private bgColor = new Color(0x14151c);

  // Every mounted creation/area/chunk, and every playable part by uid (ray hits).
  private mounted = new Map<CreationRuntime, Mounted>();
  private partsByUid = new Map<number, { rt: CreationRuntime; part: PartRuntime }>();
  private flatParts: PartRuntime[] = [];
  private flatOwners: CreationRuntime[] = [];
  private flatZones: PartZone[] = [];
  private flatDirty = true;

  // Worlds
  private worldEnv: WorldEnv | null = null;
  private worldEntity: Entity | null = null;
  private streamer: WorldStreamer | null = null;
  private lastLight = '';
  private nav!: Navigator;
  private fog = new Fog(0xdcefff, 30, 95);
  private stage = new Stage();
  private lastHudTick = 0;
  private request: AbortController | null = null;
  /** Last part the user played: "make that one red". */
  private focusPartId: string | null = null;
  /** Parts received from the server for the creation being built. */
  private streamedCount = 0;
  private anchor = new Group();
  private anchorEntity!: Entity;
  private placementCountdown = 0;
  private readyChimePlayed = true;
  private now = 0;
  private keysDown = new Set<string>();
  // Voice: push-to-talk from Space, the HUD orb, or the headset (left X / left-hand pinch toward your face).
  private voice!: VoiceController;
  private talkKey = false;
  private talkOrb = false;
  private talkXR = false;
  private talking = false;
  private voiceCaptionUntil = 0;
  /** A quick tap still walks a step: keys count as held for a moment after release. */
  private keyHold = new Map<string, number>();
  private drag: { x: number; moved: boolean } | null = null;
  private narrator!: Narrator;
  private gameUI!: GameOverlay;
  private caption = new Caption3D();
  private story!: StoryRunner;
  private storyRequest: AbortController | null = null;
  /** Story that arrived with the world (World Planner), used instead of asking for one. */
  private incomingStory: StoryT | null = null;
  private autoEnterPending = false;
  private roomTone: { mapping: typeof NoToneMapping | typeof ACESFilmicToneMapping | number; exposure: number } = { mapping: NoToneMapping, exposure: 1 };

  // Scratch objects: never allocate in update().
  private headPos = new Vector3();
  private headQuat = new Quaternion();
  private forward = new Vector3();
  private flatForward = new Vector3();
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private headLocal = new Vector3();
  private grabL: Grab = { active: false, x: 0, y: 0, z: 0 };
  private grabR: Grab = { active: false, x: 0, y: 0, z: 0 };
  private navInput!: NavInput;

  init(): void {
    this.anchor.name = 'conjure-anchor';
    this.anchorEntity = this.world.createTransformEntity(this.anchor, { persistent: true });
    this.anchor.add(this.orb.root, this.orb.ghostsRoot, this.stage.root);
    this.orbHome.copy(this.orb.root.position);
    this.world.createTransformEntity(this.stage.root, { parent: this.anchorEntity });
    this.world.scene.background = this.bgColor;
    this.world.createTransformEntity(this.orb.root, { parent: this.anchorEntity });
    this.world.createTransformEntity(this.orb.ghostsRoot, { parent: this.anchorEntity });

    this.nav = new Navigator(this.anchor, (x, z) => this.streamer?.groundAt(x, z) ?? WORLD_BASE_Y);
    this.gameUI = new GameOverlay();
    this.cleanupFuncs.push(() => this.gameUI.dispose());
    this.player.add(this.caption.mesh);
    this.narrator = new Narrator(this.synth, (text, who, speaker, secs) => {
      const name = speaker ?? (who === 'character' ? 'Villager' : 'Narrator');
      this.gameUI.line(text, name, secs);
      this.caption.line(name, text, secs, this.now);
    });
    this.story = new StoryRunner({
      streamer: () => this.streamer,
      origin: () => this.creation,
      head: () => this.headLocal,
      scale: () => this.nav.scale,
      show: (title, detail) => { if (!this.orb.isBusy) this.orb.finish(title, detail); this.hud?.say(`${title} · ${detail}`); },
      celebrate: (x, y, z) => this.celebrate(x, y, z),
      chime: (x, y, z) => this.streamHost.chime(x, y, z),
      demo: (id) => this.demoPart(id),
      part: (id) => { for (const rt of this.mounted.keys()) { const p = rt.parts.find((q) => q.spec.id === id); if (p) return p; } return null; },
      track: () => (this.streamer ? trackLoop(this.streamer.terrain) : null),
      ui: {
        chapter: (n, total, title) => this.gameUI.chapter(n, total, title),
        quest: (q) => {
          this.gameUI.quest(q);
          this.caption.setQuest(q ? `Chapter ${q.chapter}/${q.total} · ${q.goal}${q.progress ? `  ·  ${q.progress}` : ''}` : '');
          if (q) this.orb.setDetail(q.goal);
        },
        end: (s) => this.gameUI.end(s),
      },
    }, this.narrator, this.anchor);
    this.gameUI.onHint = () => this.story.hint();
    this.gameUI.onRestart = () => void this.story.restart();
    this.gameUI.onCreate = () => {
      this.toggleInside(false);
      (document.querySelector('[data-input]') as HTMLInputElement | null)?.focus();
    };
    this.nav.onModeChange = (m) => this.onModeChange(m === 'immersive');
    this.navInput = {
      dt: 0, xr: false, head: this.headPos, forward: this.flatForward, floorY: 0, canEnter: false,
      stickL: { x: 0, y: 0 }, stickR: { x: 0, y: 0 }, grabL: this.grabL, grabR: this.grabR, palm: null,
      keys: { forward: 0, turn: 0 },
    };

    const requested = new URLSearchParams(location.search).get('preset');
    const first = requested && PRESETS[requested] ? requested : 'kalimba';
    this.load(PRESETS[first]);
    this.place(false);

    this.queries.pressedParts.subscribe('qualify', (entity) => {
      void this.synth.unlock();
      const hit = this.partsByUid.get(entity.getValue(ConjurePart, 'uid') as number);
      if (hit) this.hitPart(hit.rt, hit.part, 0.75);
    });

    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        if (state === VisibilityState.Visible) {
          // Passthrough needs a transparent background in immersive AR.
          this.world.scene.background = null;
          void this.synth.unlock();
          this.placementCountdown = PLACEMENT_SETTLE_FRAMES;
        } else if (state === VisibilityState.NonImmersive) {
          this.world.scene.background = this.bgColor;
          this.hands.reset();
          this.nav.reset();
          this.place(false);
        }
      }),
    );

    this.hud = new Hud((text) => void this.ask(text));
    this.hud.onInside = () => this.toggleInside(this.nav.mode !== 'immersive');
    this.hud.onTalk = (down) => { this.talkOrb = down; };
    this.voice = new VoiceController({
      context: () => this.voiceContext(),
      begin: () => { void this.synth.unlock(); this.narrator.stop(); this.synth.ui('listen'); },
      state: (s, level) => this.hud?.setVoice(s, level),
      heard: (t) => { this.hud?.heard(t); this.voiceCaption('You', t); },
      fail: (m) => { this.hud?.say(m); this.voiceCaption('Conjure', m); this.synth.ui('error'); },
      run: (c, t) => this.runVoice(c, t),
    });
    this.cleanupFuncs.push(() => this.voice.dispose());
    this.cleanupFuncs.push(() => this.hud?.dispose());

    const unlock = () => void this.synth.unlock();
    const onKey = (e: KeyboardEvent) => this.onKey(e);
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === ' ') this.talkKey = false;
      this.keysDown.delete(k);
      this.keyHold.set(k, performance.now() + 220);
    };
    // Desktop mouse look: drag the 3D view to turn (a click without dragging still plays things).
    const canvas = this.world.renderer.domElement;
    const onDown = (e: PointerEvent) => { if (e.button === 0 || e.button === 2) this.drag = { x: e.clientX, moved: false }; };
    const onMove = (e: PointerEvent) => {
      if (!this.drag || this.isXR() || this.nav.mode !== 'immersive') return;
      const dx = e.clientX - this.drag.x;
      if (!this.drag.moved && Math.abs(dx) < 4) return;
      this.drag.moved = true;
      this.drag.x = e.clientX;
      this.nav.turnAround(this.headPos, dx * 0.005);
    };
    const onUp = () => { this.drag = null; };
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    this.cleanupFuncs.push(
      () => canvas.removeEventListener('pointerdown', onDown),
      () => window.removeEventListener('pointermove', onMove),
      () => window.removeEventListener('pointerup', onUp),
    );
    const onBlur = () => this.keysDown.clear();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.cleanupFuncs.push(
      () => window.removeEventListener('pointerdown', unlock),
      () => window.removeEventListener('keydown', onKey),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('blur', onBlur),
      () => this.soundscape.stop(),
    );

    // Debug/tuning handle for testers (console: conjure.tuning.zoneScale = 1.5).
    (window as unknown as Record<string, unknown>).conjure = {
      tuning: TUNING,
      nav: NAV,
      stream: STREAM,
      load: (name: string) => PRESETS[name] && this.load(PRESETS[name]),
      loadSpec: (spec: unknown, story?: StoryT) => { if (story) this.incomingStory = story; this.load(spec); },
      ask: (text: string) => this.ask(text),
      spec: () => this.creation?.spec,
      recenter: () => this.place(this.isXR()),
      presets: Object.keys(PRESETS),
      /** Step inside the current world / back out. */
      enter: () => this.toggleInside(true),
      exit: () => this.toggleInside(false),
      /** Sky dome inside worlds (false = see your room around the world). */
      sky: (on: boolean) => { this.streamer?.setSky(on); if (!on) this.world.scene.fog = null; },
      ambience: (on: boolean) => { this.soundscape.enabled = on; },
      /** The current story, and narrator voice on/off. */
      story: () => this.story.story,
      /** Testing: touch a part by id as if the user played it, and jump to a spot (world units). */
      touch: (id: string) => {
        for (const rt of this.mounted.keys()) { const p = rt.parts.find((q) => q.spec.id === id); if (p) { this.playPart(rt, p, 0.8); return true; } }
        return false;
      },
      goto: (x: number, z: number) => {
        const s = this.nav.scale, yaw = this.anchor.rotation.y, c = Math.cos(yaw), sn = Math.sin(yaw);
        const dx = x - this.headLocal.x, dz = z - this.headLocal.z;
        this.anchor.position.x -= (c * dx + sn * dz) * s;
        this.anchor.position.z -= (-sn * dx + c * dz) * s;
      },
      /** Testing: run a voice command as if it had been spoken. */
      say: (c: VoiceCommandT) => this.runVoice(c, ''),
      navState: () => ({ busy: this.nav.busy, mode: this.nav.mode, yaw: +this.anchor.rotation.y.toFixed(3), pos: this.anchor.position.toArray().map((v) => +v.toFixed(2)) }),
      game: () => ({ chapter: this.story.chapter, kind: this.story.current?.kind, title: this.story.current?.title, active: this.story.active, state: this.story.playState, at: this.story.where }),
      parts: (prefix: string) => [...this.mounted.keys()].flatMap((rt) => rt.parts.filter((p) => p.spec.id.startsWith(prefix)).map((p) => ({ id: p.spec.id, x: p.base[0], z: p.base[2] }))),
      /** Where you are (world units) and how the world is placed: for debugging movement. */
      where: () => ({ mode: this.nav.mode, scale: +this.nav.scale.toFixed(2), head: [+this.headLocal.x.toFixed(3), +this.headLocal.z.toFixed(3)], keys: [...this.keysDown], focus: document.activeElement?.tagName }),
      voice: (on: boolean) => { this.narrator.enabled = on; },
      /** Palm holding for worlds: conjure.palm(false) to keep worlds on the table. */
      palm: (on: boolean) => { this.nav.palmEnabled = on; },
      /** Flip palm-up detection if it is upside down on a device. */
      set palmSign(v: number) { PALM.sign = v; },
      get palmSign() { return PALM.sign; },
    };
  }

  update(delta: number, time: number): void {
    this.now = time;
    this.orb.update(delta, time);
    this.stage.update(delta, time);
    if (this.orb.isBusy && time - this.lastHudTick > 0.1) {
      this.lastHudTick = time;
      this.hud?.setElapsed(this.orb.elapsed);
    }
    const rt = this.creation;
    if (!rt) return;

    this.readHead();
    const frame = this.world.xrFrame;
    const ref = this.world.xrReferenceSpace;
    const xr = !!(frame && ref);
    if (xr) {
      if (this.placementCountdown > 0 && --this.placementCountdown === 0) this.place(true);
      this.player.updateWorldMatrix(true, false);
      this.hands.update(frame!, ref!, this.player.matrixWorld.elements, time);
    }

    // Move the world: table / palm / step inside / walk.
    this.readInputs(delta, xr);
    // Push-to-talk: press and release from any source.
    const talk = this.talkKey || this.talkOrb || this.talkXR;
    if (talk !== this.talking) { this.talking = talk; if (talk) void this.voice.press(); else this.voice.release(); }
    this.voice.update();
    this.nav.update(this.navInput);
    const scale = this.nav.scale;
    const inside = this.nav.mode === 'immersive';
    if (inside && !this.nav.busy) this.collide(scale);

    if (this.flatDirty) this.rebuildFlat();
    updateSharedAssets(time);
    for (const r of this.mounted.keys()) updateFx(r, delta, r === rt ? () => this.synth.ui('place') : undefined);
    // Sounds carry as far as the world is big.
    this.synth.distanceScale = Math.max(1, scale * 0.7);

    if (this.worldEnv) {
      this.worldEnv.update(delta, time);
      this.worldEnv.setPointScale(scale);
      this.stage.setLight(this.worldEnv.lightTint, this.worldEnv.lightIntensity);
    }
    this.updateStream(delta, time, inside);
    this.story.update(delta, time);

    if (!this.readyChimePlayed && rt.parts.length > 0 && rt.spec.version > 0 && rt.parts.every((p) => p.appear >= 1)) {
      this.readyChimePlayed = true;
      this.synth.ui('ready');
    }
    if (this.autoEnterPending && rt.spec.version > 0 && rt.parts.every((p) => p.appear >= 1)) {
      this.autoEnterPending = false;
      this.toggleInside(true);
    }
    if (this.critiquePending && rt.parts.every((p) => p.appear >= 1)) {
      if (this.critiqueReadyAt === 0) this.critiqueReadyAt = time + 0.6;
      else if (time >= this.critiqueReadyAt) {
        this.critiquePending = false;
        this.critiqueReadyAt = 0;
        if (!inside) void this.critique();
      }
    }

    if (xr) {
      // Holding the world on the left palm: that hand holds, the right one plays.
      TUNING.zoneScale = this.nav.holding ? 1.8 : 1.3;
      if (this.nav.holding) for (const t of this.hands.tips) if (t.hand === 'left') t.active = false;
      for (const r of this.mounted.keys()) syncZones(r);
      this.verbs.update(this.hands.tips, this.flatZones, time);
      for (let i = 0; i < this.verbs.eventCount; i++) {
        const e = this.verbs.events[i];
        if (e.kind === 'up') continue;
        const p = this.flatParts[e.part];
        if (p) this.playPart(this.flatOwners[e.part], p, e.velocity);
      }
    }

    this.followOrb(inside, scale);
    this.caption.update(time, this.headPos, this.headQuat, this.player, xr && (this.story.active || this.now < this.voiceCaptionUntil));
    this.synth.setListener(this.headPos.x, this.headPos.y, this.headPos.z, this.forward.x, this.forward.y, this.forward.z);
  }

  // ---------------------------------------------------------------------------
  // Loading creations

  /** Validate and show a creation, replacing the current one. */
  load(raw: unknown, animate = true): boolean {
    const result = validateCreation(raw);
    if (!result.ok || !result.creation) {
      console.error('[conjure] invalid creation', result.errors);
      this.synth.ui('error');
      return false;
    }
    if (result.fixes.length) console.info('[conjure] engine fixes', result.fixes);
    const spec = result.creation as CreationT;
    this.mount(spec);
    spec.parts.forEach((p, i) => this.attach(p, animate ? i * ASSEMBLY_STAGGER : -1));
    this.creation!.spec = spec;
    this.readyChimePlayed = !animate;
    console.info(`[conjure] loaded "${spec.title}" (${spec.parts.length} parts)`);
    if (spec.kind === 'world' && spec.terrain) void this.prepareStory(spec);
    else this.story.reset();
    return true;
  }

  /** Every world gets a story (written by the Story Director, or a template offline). */
  private async prepareStory(spec: CreationT) {
    const key = `${spec.title}|${JSON.stringify(spec.terrain ?? null)}`;
    if (this.story.hasStoryFor(key)) return;
    this.storyRequest?.abort();
    const controller = new AbortController();
    this.storyRequest = controller;
    const req = storyRequestFor(spec, this.lastWish || null);
    if (this.incomingStory) {
      const story = fixStory(this.incomingStory, req);
      this.incomingStory = null;
      this.gameUI.clear();
      this.story.setStory(key, story);
      console.info(`[conjure] story "${story.title}" (with the world): ${story.chapters.map((c) => c.title).join(' → ')}`);
      if (this.nav.mode === 'immersive') void this.story.start();
      return;
    }
    const got = await fetchStory(req, controller.signal);
    if (controller.signal.aborted || this.creation?.spec.title !== spec.title) return;
    const story = got?.story ?? templateStory(req);
    this.gameUI.clear();
    this.story.setStory(key, story);
    console.info(`[conjure] story "${story.title}" (${got?.source ?? 'template, offline'}): ${story.chapters.map((c) => c.title).join(' → ')}`);
    if (this.nav.mode === 'immersive') void this.story.start();
  }

  /** The game plays a part (a bell of a tune) without it counting as the user's touch. */
  private demoPart(id: string): boolean {
    for (const rt of this.mounted.keys()) {
      const p = rt.parts.find((q) => q.spec.id === id);
      if (!p) continue;
      p.pivot.getWorldPosition(this.tmp);
      if (p.spec.sound) this.synth.play(p.spec.sound, 0.8, this.tmp.x, this.tmp.y, this.tmp.z);
      triggerHitFx(p, 0.9);
      p.flash = 1.4;
      return true;
    }
    return false;
  }

  /** A chapter is done: fireworks of the world's colours, and a rising chord. */
  private celebrate(x: number, y: number, z: number) {
    const env = this.worldEnv;
    const glow = this.creation ? PALETTE_COLORS[this.creation.spec.palette].glow : 0xffffff;
    const accent = this.creation ? PALETTE_COLORS[this.creation.spec.palette].accent : 0xffffff;
    env?.emit(x, y + 0.03, z, 'burst', glow);
    env?.emit(x, y + 0.05, z, 'bloom');
    env?.emit(x, y + 0.04, z, 'burst', accent);
    this.tmp2.set(x, y, z);
    this.anchor.localToWorld(this.tmp2);
    ['C5', 'E5', 'G5', 'C6'].forEach((n, i) => this.synth.play({ voice: 'bell', pitch: n, decay: 2.2, tone: 0.7, gain: 0.6 - i * 0.08 }, 0.8, this.tmp2.x, this.tmp2.y + i * 0.2, this.tmp2.z));
  }

  /** Ask the agent server to create or edit something. */
  async ask(text: string) {
    void this.synth.unlock();
    if (this.nav.mode === 'immersive' && this.streamer && !EDIT_WISH.test(text)) return this.wishHere(text);
    this.request?.abort();
    this.critiquePending = false;
    const controller = new AbortController();
    this.request = controller;
    this.lastWish = text;
    this.hud?.setStage('routing');
    this.hud?.say(`"${text}"`);
    this.orb.start();
    this.orb.setDetail(`"${text}"`);
    const current = this.creation?.spec;
    try {
      await streamConjure(
        { text, spec: current && current.version > 0 ? current : null, focusPartId: this.focusPartId },
        (e) => { if (this.request === controller) this.onServerEvent(e); },
        controller.signal,
      );
      this.hud?.clearInput();
      if (this.orb.isBusy && this.request === controller) this.orb.finish('Ready', 'Done');
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error('[conjure] request failed', err);
      this.hud?.setStage('error');
      this.hud?.say('Could not reach the Conjure server. Is `npm run server` running?');
      this.orb.finish('Offline', 'Start the Conjure server', false);
      this.synth.ui('error');
    }
  }

  /** Inside a world: build what was asked for a few steps ahead of the user. */
  private async wishHere(text: string) {
    const streamer = this.streamer!;
    const ahead = 0.24;
    const at: [number, number] = [this.headLocal.x + this.localForwardX() * ahead, this.headLocal.z + this.localForwardZ() * ahead];
    this.orb.start();
    this.orb.setStage('designing', `"${text}"`);
    this.hud?.setStage('designing');
    this.hud?.say(`Building "${text}" ahead of you`);
    let parts = 0, title = text;
    try {
      const ok = await streamer.wish(text, at, (e) => {
        if (e.type === 'area') { title = e.title; this.orb.setDetail(e.title); }
        if (e.type === 'part') { parts++; this.orb.setStage('designing', `Building ${parts} · ${e.part.label ?? e.part.id}`); }
        if (e.type === 'error') this.hud?.say(e.message);
      });
      this.hud?.clearInput();
      if (ok) {
        this.orb.finish('Ready', `${title} · walk over and play it`);
        this.hud?.setStage('ready');
        this.hud?.say(`${title} · ${parts} parts`);
      } else {
        this.orb.finish('Could not build that', 'Try describing it differently', false);
        this.hud?.setStage('error');
      }
    } catch (err) {
      console.error('[conjure] wish failed', err);
      this.orb.finish('Offline', 'Start the Conjure server', false);
    }
  }

  /** Photograph the creation and let the Critic agent refine it (one round). */
  private async critique() {
    const spec = this.creation?.spec;
    if (!spec || spec.version !== 1) return;
    const controller = new AbortController();
    this.request?.abort();
    this.request = controller;
    let image: string;
    try {
      image = snapshotCreation(this.world.renderer, this.world.scene, this.anchor, [this.orb.root, this.orb.ghostsRoot]);
    } catch (err) {
      console.warn('[conjure] snapshot failed', err);
      return;
    }
    this.orb.start();
    this.orb.setStage('critiquing', 'Comparing with the real thing');
    this.hud?.setStage('critiquing');
    try {
      const ran = await streamCritique(
        { text: this.lastWish, spec, image, reference: this.lastReference },
        (e) => { if (this.request === controller) this.onServerEvent(e); },
        controller.signal,
      );
      if (!ran) this.orb.finish('Ready', `${spec.title} · play it!`);
      else if (this.orb.isBusy && this.request === controller) this.orb.finish('Ready', 'Critic: looks right');
    } catch (err) {
      if (!controller.signal.aborted) console.warn('[conjure] critique failed', err);
      if (this.orb.isBusy) this.orb.finish('Ready', `${spec.title} · play it!`);
    }
  }

  private onServerEvent(e: ConjureEvent) {
    switch (e.type) {
      case 'reference': {
        const r = e.reference;
        const detail = r && e.verified
          ? `Reference: ${r.subject} · ${e.origin === 'library' ? 'verified library' : `${r.sources.length} source(s)`}`
          : `No reference (${e.note}): designing from memory`;
        this.orb.setStage('researching', detail);
        this.hud?.say(detail);
        if (r && r.sources.length) console.info('[conjure] reference sources', r.sources.map((s) => s.url));
        break;
      }
      case 'critique':
        this.orb.setStage('critiquing', `Critic ${e.score}/10: ${e.verdict}`);
        this.hud?.say(`Critic ${e.score}/10 · ${e.verdict}${e.changes ? ` · refining ${e.changes} part(s)` : ''}`);
        break;
      case 'stage':
        this.hud?.setStage(e.stage);
        if (e.stage !== 'ready' && e.stage !== 'error') this.orb.setStage(e.stage, e.message);
        if (e.stage === 'designing' && !e.message) this.synth.ui('listen');
        break;
      case 'plan':
        this.beginStream(e.header);
        if (e.groups?.length) this.orb.showGhosts(e.groups);
        this.orb.setDetail(`${e.header.title}: ${e.header.narration.join(' · ')}`);
        this.hud?.say(`${e.header.title}${e.source === 'fixture' ? ' (replay)' : ''}`);
        break;
      case 'part':
        if (this.creation && this.creation.spec.version === 0) {
          this.attach(e.part, 0);
          this.streamedCount++;
          this.orb.partArrived(e.part.id);
          this.orb.setStage('designing', `Building ${this.streamedCount} · ${e.part.label ?? e.part.id}`);
          this.hud?.setStage('designing', `${this.streamedCount}`);
        }
        break;
      case 'playtest': {
        const failing = e.results.filter((r) => !r.ok).length;
        this.hud?.setStage('testing', failing ? `${failing} to fix` : 'all pass');
        break;
      }
      case 'say':
        this.hud?.say(e.text);
        this.orb.setDetail(e.text);
        break;
      case 'commit':
        this.applyCommit(e.spec);
        if (e.reference !== undefined) this.lastReference = e.reference ?? this.lastReference;
        // New live creations get one Critic round once they've assembled.
        if (e.spec.version === 1 && e.source === 'live' && e.spec.kind !== 'world') { this.critiquePending = true; this.critiqueReadyAt = 0; }
        // A new world: step inside it once it has assembled.
        if (e.spec.version === 1 && e.spec.kind === 'world' && NAV.autoEnter && this.nav.mode !== 'immersive') this.autoEnterPending = true;
        this.orb.finish('Ready', `${e.spec.title} · ${(e.ms / 1000).toFixed(1)}s · ${e.spec.kind === 'world' ? 'step inside: push the right stick up or press I' : 'play it!'}`);
        this.hud?.say(`${e.spec.title} v${e.spec.version} · ${(e.ms / 1000).toFixed(1)}s${e.repairs ? ` · ${e.repairs} repair round(s)` : ''}${e.source === 'fixture' ? ' · replay' : ''}`);
        break;
      case 'error':
        this.hud?.setStage('error');
        this.hud?.say(e.message);
        this.orb.finish('Something went wrong', e.message, false);
        this.synth.ui('error');
        break;
      case 'story':
        this.incomingStory = e.story;
        break;
      case 'edit':
      case 'area':
        break;
    }
  }

  /** A new creation is starting to stream in: clear the table. */
  private beginStream(header: CreationHeaderT) {
    this.mount({ id: 'streaming', version: 0, ...header, parts: [] });
    this.streamedCount = 0;
    this.readyChimePlayed = false;
  }

  /** Final spec from the server. Rebuild only if it differs from what's shown. */
  private applyCommit(spec: CreationT) {
    const rt = this.creation;
    const byId = new Map(spec.parts.map((p) => [p.id, JSON.stringify(p)]));
    const same = rt && rt.parts.length === spec.parts.length &&
      rt.parts.every((p) => byId.get(p.spec.id) === JSON.stringify(p.spec)) &&
      rt.spec.palette === spec.palette && rt.spec.style === spec.style &&
      JSON.stringify(rt.spec.terrain ?? null) === JSON.stringify(spec.terrain ?? null) &&
      JSON.stringify(rt.spec.ambient ?? null) === JSON.stringify(spec.ambient ?? null);
    if (same && rt) {
      rt.spec = { ...spec, parts: rt.parts.map((p) => p.spec) };
      return;
    }
    const changed = new Set(spec.parts.filter((p) => {
      const old = rt?.parts.find((o) => o.spec.id === p.id);
      return !old || JSON.stringify(old.spec) !== JSON.stringify(p);
    }).map((p) => p.id));
    this.load(spec, false);
    // Flash what changed so edits are visible.
    for (const p of this.creation?.parts ?? []) if (changed.has(p.spec.id)) triggerHitFx(p, 0.8);
    this.synth.ui('ready');
  }

  /** Replace the current creation with an empty one ready for parts. */
  private mount(spec: CreationT) {
    this.unload();
    const rt = createRuntime(spec);
    this.stage.setColor(PALETTE_COLORS[spec.palette].glow);
    const isWorld = spec.kind === 'world' && !!spec.terrain;
    if (isWorld) {
      this.worldEnv = new WorldEnv(spec.terrain!, spec.ambient, PALETTE_COLORS[spec.palette].accent);
      this.anchor.add(this.worldEnv.root);
      this.worldEntity = this.world.createTransformEntity(this.worldEnv.root, { parent: this.anchorEntity });
      // A new world gets a new endless land; an edit of the same world keeps what was discovered.
      if (spec.id !== 'streaming' && (!this.streamer || !this.streamer.sameWorld(spec))) {
        this.disposeStreamer();
        this.streamer = new WorldStreamer(this.streamHost, spec, PALETTE_COLORS[spec.palette].accent);
        this.anchor.add(this.streamer.field.root);
        this.player.add(this.streamer.field.sky);
        this.streamer.setActive(false);
        this.lastLight = '';
      }
      const inside = this.nav.mode === 'immersive';
      this.worldEnv.setImmersive(inside);
      this.streamer?.setActive(inside);
      // Big worlds shrink to fit the table; stepping inside lands at the world's spawn.
      const R = spec.terrain!.radius;
      this.nav.setTableScale(Math.min(1, 0.24 / R));
      this.nav.landing.set(spec.spawn?.[0] ?? 0, 0, spec.spawn?.[1] ?? R * 0.75);
    } else {
      this.disposeStreamer();
      if (this.nav.mode === 'immersive') this.nav.reset();
    }
    if (!isWorld) this.nav.setTableScale(1);
    this.stage.root.visible = !this.worldEnv;
    this.mountRuntime(rt);
    this.creation = rt;
    this.hud?.setInside(spec.id !== 'streaming', this.nav.mode === 'immersive');
    this.hud?.setWelcome(false);
  }

  /** Add a part to the current creation. */
  private attach(spec: PartT, appearDelay: number): PartRuntime | null {
    return this.creation ? this.attachPart(this.creation, spec, appearDelay) : null;
  }

  private unload() {
    if (this.worldEnv) {
      this.worldEntity?.dispose({ disposeResources: true });
      this.worldEnv.dispose();
      this.worldEnv = null;
      this.worldEntity = null;
      this.stage.root.visible = true;
    }
    if (!this.creation) return;
    this.unmountRuntime(this.creation);
    this.creation = null;
  }

  private disposeStreamer() {
    if (!this.streamer) return;
    this.streamer.dispose();
    this.streamer = null;
    this.world.scene.fog = null;
  }

  // ---------------------------------------------------------------------------
  // Runtimes: the creation, scattered props and AI areas all mount the same way.

  private mountRuntime(rt: CreationRuntime) {
    this.anchor.add(rt.root);
    const root = this.world.createTransformEntity(rt.root, { parent: this.anchorEntity });
    this.mounted.set(rt, { root, entities: [] });
    this.flatDirty = true;
  }

  private attachPart(rt: CreationRuntime, spec: PartT, appearDelay: number): PartRuntime | null {
    const m = this.mounted.get(rt);
    if (!m) return null;
    const p = addPart(rt, spec, appearDelay);
    const pivotEntity = this.world.createTransformEntity(p.pivot, { parent: m.root });
    const meshEntity = this.world.createTransformEntity(p.mesh, { parent: pivotEntity });
    if (p.zone.enabled) {
      meshEntity.addComponent(ConjurePart, { uid: p.uid });
      meshEntity.addComponent(RayInteractable);
      this.partsByUid.set(p.uid, { rt, part: p });
    }
    m.entities.push(meshEntity, pivotEntity);
    this.flatDirty = true;
    syncZones(rt);
    return p;
  }

  private unmountRuntime(rt: CreationRuntime) {
    const m = this.mounted.get(rt);
    if (!m) return;
    for (const e of m.entities) e.dispose({ disposeResources: true });
    m.root.dispose({ disposeResources: true });
    for (const p of rt.parts) this.partsByUid.delete(p.uid);
    disposeCreation(rt);
    this.mounted.delete(rt);
    this.flatDirty = true;
  }

  /** One list of every touchable zone, for the hand verbs. */
  private rebuildFlat() {
    this.flatDirty = false;
    this.flatParts.length = 0; this.flatOwners.length = 0; this.flatZones.length = 0;
    for (const rt of this.mounted.keys()) {
      for (const p of rt.parts) {
        p.zone.index = this.flatParts.length;
        this.flatParts.push(p); this.flatOwners.push(rt); this.flatZones.push(p.zone);
      }
    }
    this.verbs.resize(this.hands.tips.length, this.flatZones.length);
  }

  private streamHost = {
    mountRuntime: (rt: CreationRuntime) => this.mountRuntime(rt),
    attachPart: (rt: CreationRuntime, spec: PartT, delay: number) => this.attachPart(rt, spec, delay),
    unmountRuntime: (rt: CreationRuntime) => this.unmountRuntime(rt),
    playLocal: (sound: SoundRecipeT, velocity: number, x: number, y: number, z: number) => {
      this.tmp2.set(x, y, z);
      this.anchor.localToWorld(this.tmp2);
      this.synth.play(sound, velocity, this.tmp2.x, this.tmp2.y, this.tmp2.z);
    },
    chime: (x: number, y: number, z: number) => {
      this.tmp2.set(x, y, z);
      this.anchor.localToWorld(this.tmp2);
      this.synth.play({ voice: 'bell', pitch: 'E6', decay: 1.6, tone: 0.7, gain: 0.5 }, 0.7, this.tmp2.x, this.tmp2.y, this.tmp2.z);
      this.synth.play({ voice: 'bell', pitch: 'B6', decay: 1.8, tone: 0.7, gain: 0.35 }, 0.6, this.tmp2.x, this.tmp2.y, this.tmp2.z);
    },
    announce: (title: string, detail: string) => {
      // The story has the stage: places it didn't ask for stay quiet.
      if (this.orb.isBusy || this.story?.active) return;
      this.orb.finish(title, detail);
      this.hud?.say(`${title} · ${detail}`);
    },
  };

  // ---------------------------------------------------------------------------
  // Inside a world

  private onModeChange(inside: boolean) {
    this.hud?.setInside(true, inside);
    const panel = this.world.scene.getObjectByName('Welcome Panel') ?? this.world.scene.getObjectByName('welcome-panel');
    if (panel) panel.visible = !inside;
    this.worldEnv?.setImmersive(inside);
    this.streamer?.setActive(inside);
    const r = this.world.renderer;
    if (inside) { this.roomTone = { mapping: r.toneMapping, exposure: r.toneMappingExposure }; }
    else { this.world.scene.fog = null; r.toneMapping = this.roomTone.mapping as typeof NoToneMapping; r.toneMappingExposure = this.roomTone.exposure; }
    // The room's own lights are for the tabletop; inside, the world's sun and sky light it.
    for (const name of ['Key Light', 'Fill Light', 'key-light', 'fill-light']) {
      const l = this.world.scene.getObjectByName(name);
      if (l) l.visible = !inside;
    }
    this.synth.ui(inside ? 'listen' : 'place');
    if (inside) {
      const how = this.isXR()
        ? 'Walk: left stick or pinch-drag · Turn: right stick · Leave: right stick down'
        : 'Walk: W/S (Shift runs) · Turn: A/D or drag · Click things to play';
      this.orb.finish(this.creation?.spec.title ?? 'Inside', how);
      this.hud?.say(`Inside ${this.creation?.spec.title ?? 'the world'} · ${how} · type to build something ahead of you`);
      this.hud?.setPlaceholder('Build something ahead of you, e.g. a lighthouse that sings');
      void this.story.start();
    } else {
      this.hud?.say(`${this.creation?.spec.title ?? 'Back'} · back on the table`);
      this.hud?.setPlaceholder('Describe a world to step into…');
    }
  }

  private toggleInside(inside: boolean) {
    if (inside === (this.nav.mode === 'immersive')) return;
    if (inside && this.creation && !(this.creation.spec.kind === 'world' && this.streamer)) {
      // An instrument or object: set it on a meadow so it becomes a world you can walk around.
      this.load(objectToWorld(this.creation.spec), false);
    }
    this.nav.toggle({ head: this.headPos, floorY: 0, canEnter: !!this.streamer });
  }

  private updateStream(dt: number, time: number, inside: boolean) {
    const s = this.streamer;
    if (!s) return;
    if (this.worldEnv && this.worldEnv.light !== this.lastLight) {
      this.lastLight = this.worldEnv.light;
      s.field.setLight(this.worldEnv.light);
    }
    this.nav.headInWorld(this.headPos, this.headLocal);
    s.update(dt, time, this.headLocal, this.localForwardX(), this.localForwardZ());
    const r = this.world.renderer;
    if (!inside) return;
    if (r.toneMapping !== ACESFilmicToneMapping) r.toneMapping = ACESFilmicToneMapping;
    r.toneMappingExposure = s.field.exposure;
    this.worldEnv?.setFocus(this.headLocal.x, this.headLocal.z);
    if (s.skyOn) {
      this.fog.color.copy(s.field.horizon);
      this.world.scene.fog = this.fog;
    }
    this.soundscapeUpdate(time, s);
  }

  private soundscapeUpdate(time: number, s: WorldStreamer) {
    this.soundscape.update(time, {
      active: this.nav.mode === 'immersive',
      light: this.worldEnv?.light ?? 'day',
      particles: this.creation?.spec.ambient?.particles ?? 'none',
      waterNear: s.waterNear(this.headLocal.x, this.headLocal.z),
      moved: this.nav.moved,
      x: this.headPos.x, y: this.headPos.y, z: this.headPos.z,
      floorY: 0,
    });
  }

  /**
   * Landmarks are solid: if walking puts you inside a volcano, house or tree
   * trunk, the world is nudged so you stand just outside it.
   */
  private collide(scale: number) {
    const head = this.nav.headInWorld(this.headPos, this.tmp);
    const minReal = 0.35 / scale;
    for (const rt of this.mounted.keys()) {
      for (const p of rt.parts) {
        const s = p.spec.shape;
        // Walk-through things (gates, the start gantry) and hidden pieces never block you.
        if (s.kind !== 'asset' || s.type === 'cloud' || s.type === 'portal' || s.type === 'gantry' || !p.pivot.visible || p.spec.motion?.type === 'orbit' || p.spec.transform.pos[1] > 0.02) continue;
        const k = p.spec.transform.scale ?? 1;
        // Trees: only the trunk is solid. Everything else: most of its footprint.
        const tree = s.type === 'oak' || s.type === 'pine' || s.type === 'aspen' || s.type === 'ash' || s.type === 'palm';
        const r = (tree ? 0.4 / scale : assetDims(s.type, s.size).radius * 0.85 * k);
        if (r < minReal && !tree) continue;
        const dx = head.x - p.pivot.position.x, dz = head.z - p.pivot.position.z;
        const d = Math.hypot(dx, dz);
        if (d >= r || d < 1e-6) continue;
        const push = r - d, ux = dx / d, uz = dz / d;
        // Move the world the other way (local -> world: rotate by yaw, scale).
        const yaw = this.anchor.rotation.y, c = Math.cos(yaw), sn = Math.sin(yaw);
        this.anchor.position.x -= (c * ux * push + sn * uz * push) * scale;
        this.anchor.position.z -= (-sn * ux * push + c * uz * push) * scale;
        head.x += ux * push; head.z += uz * push;
      }
    }
  }

  /** Head forward expressed in world units (anchor-local). */
  private localForwardX() {
    const yaw = this.anchor.rotation.y;
    return Math.cos(yaw) * this.flatForward.x - Math.sin(yaw) * this.flatForward.z;
  }
  private localForwardZ() {
    const yaw = this.anchor.rotation.y;
    return Math.sin(yaw) * this.flatForward.x + Math.cos(yaw) * this.flatForward.z;
  }

  /** Inside a world the orb floats in front of you at human size. */
  private followOrb(inside: boolean, scale: number) {
    const root = this.orb.root;
    if (inside || scale > 1.6) {
      // Low and to the left, so it never blocks the view.
      this.tmp.copy(this.headPos).addScaledVector(this.flatForward, 0.9);
      this.tmp.x += this.flatForward.z * 0.38; this.tmp.z -= this.flatForward.x * 0.38;
      this.tmp.y -= 0.42;
      this.nav.headInWorld(this.tmp, this.tmp);
      root.position.lerp(this.tmp, 0.2);
      root.scale.setScalar(1 / scale);
      root.rotation.y = Math.atan2(-this.flatForward.x, -this.flatForward.z) - this.anchor.rotation.y;
    } else if (root.scale.x !== 1) {
      root.position.copy(this.orbHome);
      root.scale.setScalar(1);
      root.rotation.y = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Input

  private isXR() { return this.world.visibilityState.peek() !== VisibilityState.NonImmersive; }

  private readHead() {
    const xr = !!this.world.xrFrame;
    const obj = xr ? this.player.head : this.world.camera;
    obj.updateWorldMatrix(true, false);
    obj.matrixWorld.decompose(this.headPos, this.headQuat, this.tmp);
    this.forward.set(0, 0, -1).applyQuaternion(this.headQuat);
    this.flatForward.set(this.forward.x, 0, this.forward.z);
    if (this.flatForward.lengthSq() < 1e-4) this.flatForward.set(0, 0, -1);
    this.flatForward.normalize();
  }

  private readInputs(dt: number, xr: boolean) {
    const n = this.navInput;
    n.dt = dt;
    n.xr = xr;
    n.canEnter = this.creation?.spec.kind === 'world' && !!this.streamer;
    n.floorY = 0;
    n.stickL.x = n.stickL.y = n.stickR.x = n.stickR.y = 0;
    this.grabL.active = this.grabR.active = false;
    this.talkXR = false;
    n.palm = xr ? this.hands.palms.left : null;
    if (xr) {
      const pads = this.input.xr.gamepads;
      for (const side of ['left', 'right'] as const) {
        const gp = pads[side];
        const grab = side === 'left' ? this.grabL : this.grabR;
        if (gp && !gp.inputSource.hand && side === 'left' && (gp.getButtonPressed('x-button') || gp.getButtonPressed('y-button'))) this.talkXR = true;
        if (gp && !gp.inputSource.hand) {
          const axes = gp.getAxesValues('xr-standard-thumbstick');
          if (axes) { const st = side === 'left' ? n.stickL : n.stickR; st.x = axes.x; st.y = axes.y; }
          if (gp.getButtonPressed('xr-standard-squeeze')) {
            const grip = this.player.gripSpaces[side];
            grip.updateWorldMatrix(true, false);
            grip.getWorldPosition(this.tmp);
            grab.active = true; grab.x = this.tmp.x; grab.y = this.tmp.y; grab.z = this.tmp.z;
          }
        }
        // Hands: a pinch in the air grabs the world.
        const pinch = this.hands.pinch[side];
        // Left hand: a pinch held with the palm turned toward your face is "talk", not "grab".
        if (side === 'left' && pinch.active && this.isTalkPose()) { this.talkXR = true; continue; }
        if (!grab.active && pinch.active && this.hands.palms[side].valid) {
          grab.active = true; grab.x = pinch.x; grab.y = pinch.y; grab.z = pinch.z;
        }
      }
    }
    const now = performance.now();
    const k = { has: (key: string) => this.keysDown.has(key) || (this.keyHold.get(key) ?? 0) > now };
    const typing = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';
    // Keyboard works in the emulator too (outside Play mode the keys don't reach the controllers).
    n.keys.forward = typing ? 0 : (k.has('w') ? 1 : 0) - (k.has('s') ? 1 : 0);
    n.keys.turn = typing ? 0 : (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
    n.keys.run = k.has('shift');
    if (!xr) { n.keys.forward += (k.has('arrowup') ? 1 : 0) - (k.has('arrowdown') ? 1 : 0); n.keys.turn += (k.has('arrowright') ? 1 : 0) - (k.has('arrowleft') ? 1 : 0); }
  }

  /** Put the play zone in front of the user, facing them. */
  private place(immersive: boolean) {
    const pos = this.tmp2;
    if (immersive) {
      // Seated in XR: in front of and below the head, at desk height.
      const head = this.player.head;
      head.updateWorldMatrix(true, false);
      head.matrixWorld.decompose(this.headPos, this.headQuat, this.forward);
      this.forward.set(0, 0, -1).applyQuaternion(this.headQuat);
      this.forward.y = 0;
      if (this.forward.lengthSq() < 1e-4) this.forward.set(0, 0, -1);
      this.forward.normalize();
      pos.set(
        this.headPos.x + this.forward.x * PLACEMENT.immersive.forward,
        this.headPos.y - PLACEMENT.immersive.down,
        this.headPos.z + this.forward.z * PLACEMENT.immersive.forward,
      );
    } else {
      // Desktop: centre of the browser camera's view, so it's framed on screen.
      const cam = this.world.camera;
      cam.updateWorldMatrix(true, false);
      cam.getWorldPosition(this.headPos);
      cam.getWorldDirection(this.forward);
      pos.copy(this.headPos).addScaledVector(this.forward, PLACEMENT.desktop.forward);
      pos.y -= PLACEMENT.desktop.down;
      this.forward.y = 0;
      if (this.forward.lengthSq() < 1e-4) this.forward.set(0, 0, -1);
      this.forward.normalize();
    }
    // Local +Z of the anchor points back at the user.
    this.nav.setTable(pos, Math.atan2(-this.forward.x, -this.forward.z));
    if (this.creation) syncZones(this.creation);
  }

  private findPart(rt: CreationRuntime, id: string) {
    return rt.parts.find((q) => q.spec.id === id) ?? rt.parts.find((q) => q.spec.id.startsWith(`${id}-`));
  }

  /** World reactions: effects on the played part or on another (links). */
  private react(kind: NonNullable<PartT['react']>[number]['do'], t: PartRuntime, rt: CreationRuntime) {
    const env = this.worldEnv;
    const { x, y, z } = t.pivot.position;
    const glow = PALETTE_COLORS[rt.spec.palette].glow;
    t.pivot.getWorldPosition(this.tmp);
    t.asset?.trigger?.(kind);
    switch (kind) {
      case 'jump': case 'grow': case 'spin': triggerReaction(t, kind); break;
      case 'glow': t.flash = 1.6; break;
      case 'burst': env?.emit(x, y + 0.02, z, 'burst', glow); break;
      case 'bloom': triggerReaction(t, 'grow'); env?.emit(x, y + 0.02, z, 'bloom'); break;
      case 'erupt': {
        triggerReaction(t, 'grow');
        const top = t.spec.shape.kind === 'asset' ? t.spec.shape.size * 0.9 : 0.04;
        env?.emit(x, y + top, z, 'erupt');
        env?.emit(x, y + top, z, 'erupt');
        // A deep rumble plus a roar, loud enough to feel.
        this.synth.play({ voice: 'bass', pitch: 41, decay: 3, tone: 0.1, gain: 1.4 }, 1, this.tmp.x, this.tmp.y, this.tmp.z);
        this.synth.play({ voice: 'noise', pitch: 70, decay: 2.2, tone: 0.05, gain: 1.2 }, 1, this.tmp.x, this.tmp.y, this.tmp.z);
        this.synth.play({ voice: 'noise', pitch: 400, decay: 1.2, tone: 0.3, gain: 0.6 }, 0.8, this.tmp.x, this.tmp.y + 0.1, this.tmp.z);
        break;
      }
      case 'rain':
        env?.rain(5);
        this.synth.play({ voice: 'noise', pitch: 3000, decay: 2.5, tone: 0.95, gain: 0.35 }, 0.5, this.tmp.x, this.tmp.y, this.tmp.z);
        break;
      case 'daynight':
        env?.toggleDayNight();
        this.orb.setDetail(env?.light === 'night' ? 'Night falls' : 'Good morning');
        break;
    }
  }

  /** Click / far pinch / controller trigger on a part. */
  private hitPart(rt: CreationRuntime, p: PartRuntime, velocity: number) {
    const zone = p.zone;
    if (!zone.enabled || this.now < zone.cooldownUntil) return;
    zone.cooldownUntil = this.now + TUNING.cooldown;
    this.playPart(rt, p, velocity);
  }

  private playPart(rt: CreationRuntime, p: PartRuntime, velocity: number) {
    if (rt === this.creation) this.focusPartId = p.spec.id;
    this.story.onPlayed(rt, p);
    p.pivot.getWorldPosition(this.tmp);
    if (p.spec.sound) this.synth.play(p.spec.sound, velocity, this.tmp.x, this.tmp.y, this.tmp.z);
    triggerHitFx(p, velocity);
    for (const r of p.spec.react ?? []) this.react(r.do, (r.target && this.findPart(rt, r.target)) || p, rt);
  }

  /** Left palm up-ish and facing the head, like talking into your hand. */
  private isTalkPose() {
    const pm = this.hands.palms.left;
    if (!pm.valid) return false;
    const dx = this.headPos.x - pm.x, dy = this.headPos.y - pm.y, dz = this.headPos.z - pm.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    return (pm.nx * dx + pm.ny * dy + pm.nz * dz) / d > 0.6 && pm.ny < 0.6 && d < 0.5;
  }

  /** A short line in the headset (and the subtitles) for what voice heard or did. */
  private voiceCaption(who: string, text: string) {
    this.caption.line(who, text, 2.5, this.now);
    this.voiceCaptionUntil = this.now + 3;
    if (!this.isXR()) this.gameUI.line(text, who, 2.5);
  }

  /** Things and places you can go to by name, nearest first (anchor units). */
  private voiceTargets(): Map<string, [number, number]> {
    const here = this.headLocal;
    const found: { name: string; at: [number, number]; d: number }[] = [];
    for (const rt of this.mounted.keys()) {
      for (const p of rt.parts) {
        const name = p.spec.label;
        if (!name || /^(boulder|bush|flower|grass|rock|pine|oak|aspen|tree|street lamp|car|bench)$/i.test(name)) continue;
        const at: [number, number] = [p.base[0], p.base[2]];
        found.push({ name, at, d: Math.hypot(at[0] - here.x, at[1] - here.z) });
      }
    }
    for (const pl of this.story.places()) found.push({ name: pl.name, at: pl.at, d: -1 });
    found.sort((a, b) => a.d - b.d);
    const out = new Map<string, [number, number]>();
    for (const f of found) if (!out.has(f.name)) out.set(f.name, f.at);
    return out;
  }

  private voiceContext(): ListenContext {
    return {
      hasWorld: !!this.creation,
      inside: this.nav.mode === 'immersive',
      names: [...this.voiceTargets().keys()].slice(0, 60),
      options: this.story.options,
    };
  }

  /** Carry out a spoken command. */
  private runVoice(c: VoiceCommandT, transcript: string) {
    const inside = this.nav.mode === 'immersive';
    const canWalk = !!this.streamer;
    // Movement outside a world: step in first, then do it.
    const moveIntents = ['go', 'move', 'walk', 'turn', 'home', 'next'];
    if (moveIntents.includes(c.intent) && !inside) {
      if (!canWalk) { this.voiceCaption('Conjure', 'Make a world first, then we can walk in it.'); return; }
      this.toggleInside(true);
      setTimeout(() => this.runVoice(c, transcript), 2600);
      return;
    }
    const travel = (at: [number, number], standoff: number, label: string, face = true) => {
      if (this.nav.travelTo(this.headPos, this.flatForward, 0, at[0], at[1], standoff, face)) { this.synth.ui('place'); this.hud?.say(`Going to ${label}`); }
    };
    switch (c.intent) {
      case 'conjure':
        this.hud?.setPlaceholder(c.text);
        void this.ask(c.text);
        break;
      case 'go': {
        const targets = this.voiceTargets();
        const name = targets.has(c.target) ? c.target : matchName(c.target, [...targets.keys()]);
        if (!name) { this.voiceCaption('Conjure', `I can't see ${c.target} yet. Try "where next?" or build it.`); this.synth.ui('error'); break; }
        travel(targets.get(name)!, 0.05, name);
        break;
      }
      case 'move': {
        const step = 0.25; // about 10 m
        const here = this.headLocal, fx = this.localForwardX(), fz = this.localForwardZ();
        const v: Record<string, [number, number]> = {
          forward: [fx, fz], back: [-fx, -fz], left: [fz, -fx], right: [-fz, fx],
          north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0],
        };
        const [dx, dz] = v[c.direction];
        // Back and side steps keep you facing the same way.
        const face = !(c.direction === 'back' || c.direction === 'left' || c.direction === 'right');
        travel([here.x + dx * step, here.z + dz * step], 0, c.direction, face);
        break;
      }
      case 'walk': this.nav.autoWalk = 1; this.hud?.say('Walking… say "stop" to stop'); break;
      case 'stop': this.nav.stopVoice(); this.nav.boost = 1; this.hud?.say('Stopped'); break;
      case 'turn': this.nav.turnBy((Math.max(-180, Math.min(180, c.degrees)) * Math.PI) / 180); break;
      case 'speed': this.nav.boost = c.faster ? 2.2 : 0.6; if (!this.nav.autoWalk && c.faster) this.nav.autoWalk = 1; break;
      case 'home': travel([this.nav.landing.x, this.nav.landing.z], 0, 'the start'); break;
      case 'next': {
        const at = this.story.destination;
        if (at) { travel(at, 0.12, this.story.current?.title ?? 'the next place'); break; }
        // A home chapter: walk to its target.
        const goal = this.story.current?.target;
        const t = goal ? this.voiceTargets() : null;
        const name = goal && t ? (t.has(goal) ? goal : matchName(goal, [...t.keys()])) : null;
        if (name && t) travel(t.get(name)!, 0.05, name);
        else this.story.hint();
        break;
      }
      case 'inside': this.toggleInside(true); break;
      case 'outside': this.toggleInside(false); break;
      case 'hint': this.story.hint(); break;
      case 'repeat': this.narrator.repeat(); break;
      case 'choose': {
        const id = `g${this.story.chapter}-choice-${c.option}`;
        for (const rt of this.mounted.keys()) { const p = rt.parts.find((q) => q.spec.id === id); if (p) { this.playPart(rt, p, 0.8); return; } }
        this.voiceCaption('Conjure', 'Go to the choice first, then tell me which one.');
        break;
      }
      case 'none':
        if (!transcript) this.hud?.say("I didn't catch that.");
        break;
    }
  }

  private onKey(e: KeyboardEvent) {
    void this.synth.unlock();
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const key = e.key.toLowerCase();
    if (key === ' ') { e.preventDefault(); if (!e.repeat) this.talkKey = true; return; }
    this.keysDown.add(key);
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= PRESET_ORDER.length) {
      this.load(PRESETS[PRESET_ORDER[n - 1]]);
    } else if (key === 'p' && this.creation) {
      this.load(this.creation.spec);
    } else if (key === 'i') {
      this.toggleInside(this.nav.mode !== 'immersive');
    } else if (key === 't') {
      this.gameUI.toggleTranscript();
    } else if (key === 'h') {
      this.story.hint();
    } else if (key === 'k') {
      if (this.streamer) { this.streamer.setSky(!this.streamer.skyOn); if (!this.streamer.skyOn) this.world.scene.fog = null; }
    } else if (key === 'r') {
      this.place(this.isXR());
    }
  }
}
