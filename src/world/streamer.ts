/**
 * Streams an endless world around the user once they step inside it.
 *
 * Three layers, so there is never empty land and never a wait:
 *   1. ground   instant: every chunk samples the same seeded height field
 *   2. props    instant: the world's own kit (its trees, creatures, rocks) scattered
 *               deterministically, plus fillers; each chunk is tuned to its own key
 *   3. areas    a few seconds: the AI designs a landmark for nearby chunks
 *               ("Singing Tide Pools", "The Frozen Bell Tower"), streamed in part by part
 * Wishes made while inside ("a lighthouse") become areas right where you look.
 * Areas are remembered: walk away and come back, they are still there.
 */
import type { Vector3 } from '@iwsdk/core';
import { NAV } from './navigator.js';
import { cityChunk, onRoad } from '../engine/city.js';
import { TRACK_WIDTH, trackDistance, trackLoop } from '../engine/track.js';
import { biomeOf, guessBiome } from '../engine/biome.js';
import { CHUNK, chunkCenter, chunkKey, chunkOf, extractKit, hashString, placeArea, ringKeys, scatterChunk, type KitItem } from '../engine/chunks.js';
import { groundY, waterLevel, terrainHeight, type TerrainT } from '../engine/terrain.js';
import { streamArea } from '../net/conjure-client.js';
import { createRuntime, type CreationRuntime, type PartRuntime } from '../render/build.js';
import { ChunkField } from '../render/field.js';
import type { AreaRequest, ConjureEvent } from '../spec/protocol.js';
import type { CreationT, PartT, SoundRecipeT } from '../spec/schema.js';

export interface StreamerHost {
  mountRuntime(rt: CreationRuntime): void;
  attachPart(rt: CreationRuntime, spec: PartT, appearDelay: number): PartRuntime | null;
  unmountRuntime(rt: CreationRuntime): void;
  /** Play a sound at a point in world units (anchor-local). */
  playLocal(sound: SoundRecipeT, velocity: number, x: number, y: number, z: number): void;
  chime(x: number, y: number, z: number): void;
  announce(title: string, detail: string): void;
}

export const STREAM = {
  /** Rings of chunks with ground around the user. */
  groundRings: 3,
  /** Rings that get props and AI areas. */
  contentRings: 1,
  /** Max AI areas per world per session (cost guard). */
  areaLimit: 24,
  maxInFlight: 2,
  /** Set false to keep the endless land but skip AI areas. */
  aiAreas: true,
};

type AreaStatus = 'pending' | 'ready' | 'failed';
interface Area {
  id: string; key: string; center: [number, number]; title: string; parts: PartT[];
  status: AreaStatus; wish: string | null; discovered: boolean; nextCall: number;
}
interface ChunkContent { scatter: CreationRuntime | null; areas: Map<string, CreationRuntime> }

export class WorldStreamer {
  readonly field: ChunkField;
  readonly terrain: TerrainT;
  private kit: KitItem[];
  private content = new Map<string, ChunkContent>();
  private areas = new Map<string, Area>();
  private requested = new Set<string>();
  private inFlight = 0;
  private aiCount = 0;
  private wishCount = 0;
  private current = '';
  private queue: { ix: number; iz: number; key: string }[] = [];
  private aborts = new Set<AbortController>();
  private seed: string;
  private aiUnavailable = false;
  active = false;

  constructor(private host: StreamerHost, readonly world: CreationT, accent: number) {
    this.terrain = { ...(world.terrain ?? { style: 'island', radius: 0.2, height: 0.05, water: true }), field: true };
    this.kit = extractKit(world);
    this.seed = `${world.title}:${world.terrain?.seed ?? 1}`;
    const named = guessBiome(world.title);
    this.terrain.biome = world.terrain?.biome ?? (named !== 'meadow' ? named : biomeOf(world));
    this.field = new ChunkField(this.terrain, accent, world.ambient?.light ?? 'day', world.ambient?.particles === 'snow', NAV.immersiveScale);
  }

  /** Same world (an edit), so keep what has been discovered. */
  sameWorld(spec: CreationT) {
    return spec.title === this.world.title && JSON.stringify(spec.terrain ?? null) === JSON.stringify(this.world.terrain ?? null);
  }

  /** Ground (or sea surface) height in world units at x, z. */
  groundAt(x: number, z: number) { return groundY(this.terrain, x, z); }

  /** 0..1, how close to the sea the user is (for the waves). */
  waterNear(x: number, z: number) {
    if (!this.terrain.water) return 0;
    const wl = waterLevel(this.terrain);
    let near = 0;
    for (const [dx, dz] of [[0, 0], [0.08, 0], [-0.08, 0], [0, 0.08], [0, -0.08]]) {
      if (terrainHeight(this.terrain, x + dx, z + dz) <= wl) near += dx === 0 && dz === 0 ? 0.6 : 0.1;
    }
    return Math.min(1, near);
  }

  setActive(on: boolean) {
    this.active = on;
    this.field.root.visible = on;
    this.field.sky.visible = on;
    this.field.setSkyVisible(this.skyOn);
    if (!on) {
      for (const key of [...this.content.keys()]) this.dropContent(key);
      for (const key of [...this.field.keys()]) this.field.remove(key);
      this.current = '';
      this.queue = [];
    }
  }

  skyOn = true;
  setSky(on: boolean) { this.skyOn = on; this.field.setSkyVisible(on); }

  /** Per frame. `head` and `forward` in world units (anchor-local). */
  update(dt: number, time: number, head: Vector3, forwardX: number, forwardZ: number) {
    this.field.update(dt, time);
    if (!this.active) return;
    this.field.setFocus(head.x, head.z);
    const [ix, iz] = chunkOf(head.x, head.z);
    const key = chunkKey(ix, iz);
    if (key !== this.current) {
      this.current = key;
      this.refresh(ix, iz);
    }
    // Build at most one chunk's props per frame, nearest first: no hitches.
    const next = this.queue.shift();
    if (next && !this.content.has(next.key)) this.buildContent(next.ix, next.iz, next.key);

    this.requestAreas(ix, iz, forwardX, forwardZ);
    this.listen(time, head);
  }

  /** Story chapter: build its place at `center` (and keep auto areas away from that chunk). */
  storyArea(id: string, center: [number, number], story: NonNullable<AreaRequest['story']>, onEvent?: (e: ConjureEvent) => void) {
    const [ix, iz] = chunkOf(center[0], center[1]);
    this.requested.add(chunkKey(ix, iz));
    return this.requestArea(ix, iz, id, center, null, onEvent, story);
  }

  /** An area built without the AI (story fallback when the builder can't be reached). */
  placeLocalArea(id: string, center: [number, number], title: string, parts: PartT[]) {
    const [ix, iz] = chunkOf(center[0], center[1]);
    const key = chunkKey(ix, iz);
    this.requested.add(key);
    const area: Area = { id, key, center, title, parts: placeArea(parts, center, id), status: 'ready', wish: null, discovered: true, nextCall: 0 };
    this.areas.set(id, area);
    this.clearAround(key);
    const c = this.content.get(key);
    if (c) this.mountArea(area, c, true);
  }

  /** Status and parts of an area (story chapters look up their goal). */
  areaInfo(id: string) {
    const a = this.areas.get(id);
    return a ? { status: a.status, center: a.center, parts: a.parts, title: a.title } : null;
  }

  /** The user asked for something while inside: build it where they look. */
  async wish(text: string, at: [number, number], onEvent: (e: ConjureEvent) => void): Promise<boolean> {
    const id = `w${++this.wishCount}`;
    const [ix, iz] = chunkOf(at[0], at[1]);
    return this.requestArea(ix, iz, id, at, text, onEvent);
  }

  dispose() {
    for (const a of this.aborts) a.abort();
    this.setActive(false);
    this.field.dispose();
  }

  // ---------------------------------------------------------------------------

  private refresh(ix: number, iz: number) {
    const ground = ringKeys(ix, iz, STREAM.groundRings);
    const wanted = new Set(ground.map((c) => c.key));
    for (const c of ground) this.field.add(c.key, c.ix, c.iz);
    // Hysteresis: drop chunks one ring beyond what is wanted.
    for (const k of [...this.field.keys()]) if (!wanted.has(k) && this.ringDist(k, ix, iz) > STREAM.groundRings + 1) this.field.remove(k);
    for (const k of [...this.content.keys()]) if (this.ringDist(k, ix, iz) > STREAM.contentRings + 1) this.dropContent(k);
    this.queue = ringKeys(ix, iz, STREAM.contentRings).filter((c) => !this.content.has(c.key));
  }

  private ringDist(key: string, ix: number, iz: number) {
    const [x, z] = key.split(',').map(Number);
    return Math.max(Math.abs(x - ix), Math.abs(z - iz));
  }

  private runtime(id: string): CreationRuntime {
    return createRuntime({
      id, version: 1, kind: 'world', title: this.world.title, palette: this.world.palette, style: this.world.style,
      terrain: this.terrain, ambient: this.world.ambient, narration: [],
    });
  }

  private buildContent(ix: number, iz: number, key: string) {
    const c: ChunkContent = { scatter: null, areas: new Map() };
    this.content.set(key, c);
    this.field.addGrass(key, ix, iz);
    this.mountScatter(ix, iz, key, c);
    for (const area of this.areas.values()) if (area.key === key) this.mountArea(area, c, false);
  }

  /** The procedural props of a chunk, kept clear of any story place or AI area in it. */
  private mountScatter(ix: number, iz: number, key: string, c: ChunkContent) {
    const city = this.terrain.biome === 'city';
    let parts = city
      ? [...cityChunk(ix, iz, this.seed, this.terrain), ...scatterChunk(this.kit, this.terrain, ix, iz, this.seed, 0.2).filter((p) => !onRoad(p.transform.pos[0], p.transform.pos[2], 0.02))]
      : scatterChunk(this.kit, this.terrain, ix, iz, this.seed);
    const loop = trackLoop(this.terrain);
    if (loop) parts = parts.filter((p) => trackDistance(loop, p.transform.pos[0], p.transform.pos[2]) > TRACK_WIDTH / 2 + 0.04);
    const spots = [...this.areas.values()].filter((a) => a.key === key).map((a) => a.center);
    if (spots.length) {
      parts = parts.filter((p) => spots.every(([x, z]) => Math.hypot(p.transform.pos[0] - x, p.transform.pos[2] - (z + 0.02)) > 0.24));
    }
    if (parts.length) {
      const rt = this.runtime(`scatter:${key}`);
      this.host.mountRuntime(rt);
      parts.forEach((p, n) => this.host.attachPart(rt, p, 0.15 + n * 0.04));
      c.scatter = rt;
    }
  }

  /** A place was just claimed in this chunk: move the props out of its way. */
  private clearAround(key: string) {
    const c = this.content.get(key);
    if (!c || !c.scatter) return;
    this.host.unmountRuntime(c.scatter);
    c.scatter = null;
    const [ix, iz] = key.split(',').map(Number);
    this.mountScatter(ix, iz, key, c);
  }

  private dropContent(key: string) {
    const c = this.content.get(key);
    if (!c) return;
    if (c.scatter) this.host.unmountRuntime(c.scatter);
    for (const rt of c.areas.values()) this.host.unmountRuntime(rt);
    this.content.delete(key);
    this.field.removeGrass(key);
  }

  private mountArea(area: Area, c: ChunkContent, animate: boolean) {
    if (c.areas.has(area.id)) return c.areas.get(area.id)!;
    const rt = this.runtime(`area:${area.id}`);
    this.host.mountRuntime(rt);
    c.areas.set(area.id, rt);
    area.parts.forEach((p, n) => this.addAreaPart(rt, area, p, animate ? n * 0.08 : -1));
    return rt;
  }

  private addAreaPart(rt: CreationRuntime, area: Area, spec: PartT, delay: number) {
    const p = this.host.attachPart(rt, spec, delay);
    if (p) p.center = area.center;
  }

  private requestAreas(ix: number, iz: number, fx: number, fz: number) {
    if (!STREAM.aiAreas || this.aiUnavailable || this.inFlight >= STREAM.maxInFlight || this.aiCount >= STREAM.areaLimit) return;
    // Prefer the chunks the user is facing.
    const candidates = ringKeys(ix, iz, STREAM.contentRings)
      .filter((c) => !(c.ix === 0 && c.iz === 0) && !this.requested.has(c.key))
      .map((c) => {
        const [cx, cz] = chunkCenter(c.ix, c.iz);
        const dx = cx - ix * CHUNK, dz = cz - iz * CHUNK, len = Math.hypot(dx, dz) || 1;
        return { ...c, score: c.d - 0.6 * ((dx * fx + dz * fz) / len) };
      })
      .sort((a, b) => a.score - b.score);
    const pick = candidates[0];
    if (!pick) return;
    this.requested.add(pick.key);
    this.aiCount++;
    void this.requestArea(pick.ix, pick.iz, `a${pick.ix}_${pick.iz}`, chunkCenter(pick.ix, pick.iz), null);
  }

  private async requestArea(ix: number, iz: number, id: string, center: [number, number], wish: string | null, onEvent?: (e: ConjureEvent) => void, story?: AreaRequest['story']): Promise<boolean> {
    const key = chunkKey(ix, iz);
    const area: Area = { id, key, center, title: wish ?? story?.chapter ?? '…', parts: [], status: 'pending', wish, discovered: !!wish || !!story, nextCall: 0 };
    this.areas.set(id, area);
    this.clearAround(key);
    const req: AreaRequest = {
      world: { title: this.world.title, palette: this.world.palette, style: this.world.style, terrain: this.world.terrain, ambient: this.world.ambient },
      kit: [...new Set([...this.kit.map((k) => k.name), ...this.world.parts.map((p) => p.label ?? p.id)])],
      chunk: { x: ix, z: iz },
      neighbors: [...this.areas.values()].filter((a) => a !== area && a.status === 'ready').map((a) => a.title).slice(-8),
      wish,
      story: story ?? null,
    };
    const abort = new AbortController();
    this.aborts.add(abort);
    this.inFlight++;
    let ok = false;
    try {
      ok = await streamArea(req, (e) => {
        onEvent?.(e);
        if (e.type === 'area') area.title = e.title;
        if (e.type === 'part') {
          const [spec] = placeArea([e.part], area.center, id);
          area.parts.push(spec);
          const c = this.content.get(key);
          if (c) {
            const rt = c.areas.get(id) ?? this.mountArea({ ...area, parts: [] } as Area, c, true);
            if (!c.areas.has(id)) c.areas.set(id, rt);
            this.addAreaPart(rt, area, spec, 0);
          }
        }
        if (e.type === 'error') area.status = 'failed';
      }, abort.signal);
      if (!ok) this.aiUnavailable = !wish && !story; // replay mode: stop asking for areas
      if (ok && area.status !== 'failed' && area.parts.length) {
        area.status = 'ready';
        const [x, z] = area.center;
        if (wish) this.host.chime(x, this.groundAt(x, z) + 0.05, z);
      } else area.status = 'failed';
    } catch (err) {
      if (!abort.signal.aborted) console.warn('[conjure] area failed', err);
      area.status = 'failed';
    } finally {
      this.inFlight--;
      this.aborts.delete(abort);
    }
    return area.status === 'ready';
  }

  /** Areas sing as you approach, and announce themselves the first time. */
  private listen(time: number, head: Vector3) {
    for (const area of this.areas.values()) {
      if (area.status !== 'ready') continue;
      const d = Math.hypot(head.x - area.center[0], head.z - area.center[1]);
      if (d > 0.42) continue;
      const [x, z] = area.center;
      if (!area.discovered && d < 0.3) {
        area.discovered = true;
        this.host.chime(x, this.groundAt(x, z) + 0.05, z);
        this.host.announce(area.title, 'Discovered · tap things to play');
        area.nextCall = time + 3;
        continue;
      }
      if (time < area.nextCall) continue;
      area.nextCall = time + 5 + (hashString(area.id + Math.floor(time)) % 50) / 10;
      const voice = area.parts.find((p) => p.sound && p.verb !== 'none');
      if (!voice?.sound) continue;
      const [px, py, pz] = voice.transform.pos;
      this.host.playLocal(voice.sound, 0.3, px, this.groundAt(px, pz) + py, pz);
    }
  }
}
