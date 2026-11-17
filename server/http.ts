/**
 * Framework-agnostic handlers using web-standard Request/Response, shared by
 * the local dev server and Vercel functions.
 */
import { listen, listenAvailable } from './listen.js';
import type { ListenContext } from '../src/spec/voice.js';
import './env.js';
import { encodeEvent, type AreaRequest, type ConjureEvent, type ConjureRequest } from '../src/spec/protocol.js';
import { Terrain, Ambient, PALETTES, STYLES } from '../src/spec/schema.js';
import { designArea } from './agents/area.js';
import { directStory } from './agents/story.js';
import { speak, ttsAvailable } from './tts.js';
import type { StoryRequest } from '../src/spec/story.js';
import { validateCreation } from '../src/spec/schema.js';
import { conjureGraph, critiqueGraph } from './graph/graph.js';
import { ReferenceCard } from './research/reference.js';
import { describeModels, isFixture } from './llm/models.js';

/** Whole-request budget; the headset shows progress throughout. */
export const REQUEST_BUDGET_MS = Number(process.env.REQUEST_BUDGET_MS ?? 90_000);
export const CRITIQUE_BUDGET_MS = Number(process.env.CRITIQUE_BUDGET_MS ?? 75_000);
export const AREA_BUDGET_MS = Number(process.env.AREA_BUDGET_MS ?? 40_000);

/** Areas are generated as the user walks: cap them so a wandering user can't run up a bill. */
const AREA_LIMIT = { perWindow: Number(process.env.AREA_RATE ?? 40), windowMs: 10 * 60_000 };
let areaWindow = { start: Date.now(), count: 0 };
function areaAllowed() {
  if (Date.now() - areaWindow.start > AREA_LIMIT.windowMs) areaWindow = { start: Date.now(), count: 0 };
  return ++areaWindow.count <= AREA_LIMIT.perWindow;
}

function parseArea(body: unknown): AreaRequest | string {
  if (!body || typeof body !== 'object') return 'Body must be JSON.';
  const b = body as Record<string, unknown>;
  const w = (b.world ?? {}) as Record<string, unknown>;
  const chunk = (b.chunk ?? {}) as Record<string, unknown>;
  if (typeof chunk.x !== 'number' || typeof chunk.z !== 'number') return 'chunk {x, z} required.';
  const terrain = Terrain.safeParse(w.terrain);
  const ambient = Ambient.safeParse(w.ambient);
  const strings = (v: unknown, n: number) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').map((s) => s.slice(0, 40)).slice(0, n) : []);
  const wish = typeof b.wish === 'string' ? b.wish.trim().slice(0, 300) : '';
  return {
    world: {
      title: typeof w.title === 'string' ? w.title.slice(0, 60) : 'A world',
      palette: (PALETTES as readonly string[]).includes(w.palette as string) ? (w.palette as AreaRequest['world']['palette']) : 'aurora',
      style: (STYLES as readonly string[]).includes(w.style as string) ? (w.style as AreaRequest['world']['style']) : 'clay',
      terrain: terrain.success ? terrain.data : undefined,
      ambient: ambient.success ? ambient.data : undefined,
    },
    kit: strings(b.kit, 16),
    chunk: { x: Math.round(chunk.x), z: Math.round(chunk.z) },
    neighbors: strings(b.neighbors, 8),
    wish: wish || null,
    story: b.story && typeof b.story === 'object' ? {
      chapter: String((b.story as Record<string, unknown>).chapter ?? '').slice(0, 60),
      place: String((b.story as Record<string, unknown>).place ?? '').slice(0, 240),
      target: String((b.story as Record<string, unknown>).target ?? '').slice(0, 40),
    } : null,
  };
}

/** POST /api/story: the story a world is played through (JSON). */
export async function handleStory(req: Request): Promise<Response> {
  let body: Record<string, unknown> | null = null;
  try { body = await req.json(); } catch { /* invalid */ }
  const w = (body?.world ?? {}) as Record<string, unknown>;
  const terrain = Terrain.safeParse(w.terrain), ambient = Ambient.safeParse(w.ambient);
  const parts = Array.isArray(body?.parts) ? (body!.parts as Record<string, unknown>[]).slice(0, 24).map((p) => ({
    id: String(p.id ?? '').slice(0, 40), label: String(p.label ?? p.id ?? '').slice(0, 40), kind: String(p.kind ?? '').slice(0, 20),
  })).filter((p) => p.id) : [];
  const sreq: StoryRequest = {
    world: {
      title: typeof w.title === 'string' ? w.title.slice(0, 60) : 'A world',
      palette: (PALETTES as readonly string[]).includes(w.palette as string) ? (w.palette as StoryRequest['world']['palette']) : 'aurora',
      style: (STYLES as readonly string[]).includes(w.style as string) ? (w.style as StoryRequest['world']['style']) : 'clay',
      terrain: terrain.success ? terrain.data : undefined,
      ambient: ambient.success ? ambient.data : undefined,
    },
    parts,
    wish: typeof body?.wish === 'string' ? body.wish.slice(0, 300) : null,
  };
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(30_000)]);
  try {
    return Response.json(await directStory(sreq, signal));
  } catch {
    return Response.json({ error: 'story failed' }, { status: 500 });
  }
}

/** POST /api/speak { text, who }: narration audio (WAV). 404 when no voice is configured. */
export async function handleSpeak(req: Request): Promise<Response> {
  if (!ttsAvailable()) return Response.json({ error: 'no voice' }, { status: 404 });
  let body: Record<string, unknown> | null = null;
  try { body = await req.json(); } catch { /* invalid */ }
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 400) : '';
  if (!text) return Response.json({ error: 'text required' }, { status: 400 });
  const who = body?.who === 'character' ? 'character' : 'narrator';
  try {
    const audio = await speak(text, who, req.signal);
    return new Response(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer, { headers: { 'content-type': 'audio/wav', 'cache-control': 'no-store' } });
  } catch (err) {
    console.warn('[tts]', err instanceof Error ? err.message : err);
    return Response.json({ error: 'voice failed' }, { status: 502 });
  }
}

/** POST /api/listen: a push-to-talk clip (base64) and what the headset can see -> transcript + command. */
export async function handleListen(req: Request): Promise<Response> {
  if (!listenAvailable()) return Response.json({ error: 'no voice input' }, { status: 404 });
  let body: Record<string, unknown> | null = null;
  try { body = await req.json(); } catch { /* invalid */ }
  const audio = typeof body?.audio === 'string' ? Buffer.from(body.audio, 'base64') : null;
  const mime = typeof body?.mime === 'string' && /^audio\/[a-z0-9.+-]+/i.test(body.mime) ? body.mime.split(';')[0] : 'audio/webm';
  if (!audio || audio.length < 800) return Response.json({ transcript: '', command: { intent: 'none' } });
  if (audio.length > 2_000_000) return Response.json({ error: 'clip too long' }, { status: 413 });
  const c = (body?.context ?? {}) as Partial<ListenContext>;
  const ctx: ListenContext = {
    hasWorld: !!c.hasWorld, inside: !!c.inside,
    names: Array.isArray(c.names) ? c.names.filter((n): n is string => typeof n === 'string').map((n) => n.slice(0, 40)).slice(0, 80) : [],
    options: Array.isArray(c.options) ? c.options.filter((n): n is string => typeof n === 'string').map((n) => n.slice(0, 40)).slice(0, 2) : undefined,
  };
  try {
    return Response.json(await listen(audio, mime, ctx, req.signal));
  } catch (err) {
    console.warn('[listen]', err instanceof Error ? err.message : err);
    return Response.json({ error: 'could not hear that' }, { status: 502 });
  }
}

/** POST /api/area: one new area of an endless world (streamed parts). */
export async function handleArea(req: Request): Promise<Response> {
  if (isFixture('designer')) return Response.json({ error: 'area builder unavailable in replay mode' }, { status: 404 });
  let body: unknown;
  try { body = await req.json(); } catch { body = null; }
  const parsed = parseArea(body);
  if (typeof parsed === 'string') return Response.json({ error: parsed }, { status: 400 });
  if (!areaAllowed()) return Response.json({ error: 'Too many new areas, slow down a little.' }, { status: 429 });
  return sse(req, 'area', AREA_BUDGET_MS, async (signal) => designArea(parsed, signal));
}

function parseRequest(body: unknown): ConjureRequest | string {
  if (!body || typeof body !== 'object') return 'Body must be JSON.';
  const b = body as Record<string, unknown>;
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (!text) return 'Say what you want to build.';
  if (text.length > 500) return 'That request is too long.';
  const spec = b.spec ? validateCreation(b.spec) : null;
  return {
    text,
    spec: spec?.ok ? spec.creation ?? null : null,
    focusPartId: typeof b.focusPartId === 'string' ? b.focusPartId : null,
  };
}

export async function handleConjure(req: Request): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { body = null; }
  const parsed = parseRequest(body);
  if (typeof parsed === 'string') return Response.json({ error: parsed }, { status: 400 });
  return sse(req, 'conjure', REQUEST_BUDGET_MS, (signal) => conjureGraph.stream({ request: parsed, startedAt: Date.now() }, { streamMode: 'custom', signal }));
}

/** POST /api/critique { text, spec, image, reference }: Critic refinement round. */
export async function handleCritique(req: Request): Promise<Response> {
  if (process.env.CRITIC === 'off' || isFixture('critic')) return Response.json({ error: 'critic unavailable' }, { status: 404 });
  let body: Record<string, unknown> | null = null;
  try { body = await req.json(); } catch { /* invalid */ }
  const spec = body?.spec ? validateCreation(body.spec) : null;
  const image = typeof body?.image === 'string' && body.image.startsWith('data:image/') && body.image.length < 3_000_000 ? body.image : null;
  if (!spec?.ok || !spec.creation) return Response.json({ error: 'spec required' }, { status: 400 });
  const reference = body?.reference ? ReferenceCard.safeParse(body.reference) : null;
  const request = { text: typeof body?.text === 'string' ? body.text.slice(0, 500) : spec.creation.title, spec: spec.creation };
  return sse(req, 'critique', CRITIQUE_BUDGET_MS, (signal) => critiqueGraph.stream(
    { request, startedAt: Date.now(), intent: 'edit', image, reference: reference?.success ? reference.data : null, draft: null },
    { streamMode: 'custom', signal },
  ));
}

function sse(req: Request, name: string, budgetMs: number, run: (signal: AbortSignal) => Promise<AsyncIterable<unknown>>): Response {
  const encoder = new TextEncoder();
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(budgetMs)]);
  const t0 = Date.now();
  const timeline: string[] = [];
  const mark = (e: ConjureEvent) => {
    if (e.type === 'stage') timeline.push(`${e.stage} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  };
  const report = (outcome: string) => console.info(`[timeline:${name}] ${timeline.join(' → ')} | ${outcome} at ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ConjureEvent) => {
        mark(e);
        try { controller.enqueue(encoder.encode(encodeEvent(e))); } catch { /* client gone */ }
      };
      try {
        for await (const event of await run(signal)) send(event as ConjureEvent);
        report('done');
      } catch (err) {
        const stage = timeline.at(-1)?.split(' ')[0] ?? 'start';
        const timedOut = signal.aborted && !req.signal.aborted;
        const message = timedOut
          ? `Timed out during "${stage}" after ${Math.round(budgetMs / 1000)}s.`
          : err instanceof Error ? err.message : 'Something went wrong.';
        report(timedOut ? `TIMEOUT in ${stage}` : req.signal.aborted ? 'cancelled by client' : `error in ${stage}`);
        if (!req.signal.aborted && !timedOut) console.error('[conjure]', err);
        send({ type: 'error', message });
        send({ type: 'stage', stage: 'error' });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}

export function handleHealth(): Response {
  return Response.json({ ok: true, models: describeModels() });
}
