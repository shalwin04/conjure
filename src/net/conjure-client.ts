/**
 * Talks to the agent server: POST /api/conjure, then reads server-sent events
 * from the response body (fetch, not EventSource, because we POST a body).
 */
import type { ListenContext, ListenResult } from '../spec/voice.js';
import type { AreaRequest, ConjureEvent, ConjureRequest, CritiqueRequest } from '../spec/protocol.js';
import type { StoryRequest, StoryT } from '../spec/story.js';

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

export function streamConjure(request: ConjureRequest, onEvent: (e: ConjureEvent) => void, signal?: AbortSignal) {
  return streamEvents('/api/conjure', request, onEvent, signal);
}

/** Returns false if the server has no critic (replay mode / disabled). */
export async function streamCritique(request: CritiqueRequest, onEvent: (e: ConjureEvent) => void, signal?: AbortSignal) {
  return streamEvents('/api/critique', request, onEvent, signal, true);
}

/** One new area of an endless world. Returns false if the server can't build areas (replay mode). */
export function streamArea(request: AreaRequest, onEvent: (e: ConjureEvent) => void, signal?: AbortSignal) {
  return streamEvents('/api/area', request, onEvent, signal, true);
}

/** The story a world is played through, or null if the server can't be reached. */
export async function fetchStory(request: StoryRequest, signal?: AbortSignal): Promise<{ story: StoryT; source: string } | null> {
  try {
    const res = await fetch(`${API_BASE}/api/story`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal });
    if (!res.ok) return null;
    return (await res.json()) as { story: StoryT; source: string };
  } catch { return null; }
}

let voiceMissing = false;
/** Narration audio (WAV bytes), or null when the server has no voice. */
export async function fetchSpeech(text: string, who: 'narrator' | 'character', signal?: AbortSignal): Promise<ArrayBuffer | null> {
  if (voiceMissing) return null;
  try {
    const res = await fetch(`${API_BASE}/api/speak`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, who }), signal });
    if (res.status === 404) { voiceMissing = true; return null; }
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch { return null; }
}

/** Send a push-to-talk clip: transcript + command, or null if voice input is unavailable. */
export async function fetchListen(wavBase64: string, context: ListenContext, signal?: AbortSignal): Promise<ListenResult | { error: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/listen`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audio: wavBase64, mime: 'audio/wav', context }), signal });
    if (res.status === 404) return { error: 'Voice needs the server (npm run server) with a Gemini key.' };
    const body = await res.json() as ListenResult | { error: string };
    return res.ok ? body : { error: 'error' in body ? body.error : 'Could not hear that.' };
  } catch {
    return { error: 'Could not reach the server.' };
  }
}

async function streamEvents(
  path: string,
  request: unknown,
  onEvent: (e: ConjureEvent) => void,
  signal?: AbortSignal,
  quietIfMissing = false,
): Promise<boolean> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });
  if (quietIfMissing && res.status === 404) return false;
  if (!res.ok || !res.body) {
    let message = `Server error (${res.status})`;
    try { message = ((await res.json()) as { error?: string }).error ?? message; } catch { /* not json */ }
    onEvent({ type: 'error', message });
    return false;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
      if (!data) continue;
      try { onEvent(JSON.parse(data) as ConjureEvent); } catch { /* ignore malformed event */ }
    }
  }
  return true;
}
