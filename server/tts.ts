/**
 * Narration voice: Gemini text-to-speech (the Quest browser has no Web Speech
 * voices). Returns a WAV the headset decodes and plays. Cached per line, so
 * replaying a story costs nothing.
 */
const MODELS = [process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'];
export const VOICES = { narrator: 'Kore', character: 'Puck' } as const;
const cache = new Map<string, Uint8Array>();

export const ttsAvailable = () => !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) && process.env.TTS !== 'off';

function wav(pcm: Uint8Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

export async function speak(text: string, who: keyof typeof VOICES, signal?: AbortSignal): Promise<Uint8Array> {
  const key = `${who}:${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
  const style = who === 'narrator' ? 'Read warmly and slowly, like a storyteller by a fire' : 'Say it like a friendly, slightly mysterious villager';
  let lastErr = '';
  for (const model of MODELS) {
    const t0 = Date.now();
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${style}: ${text}` }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICES[who] } } } },
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000),
    });
    if (!res.ok) { lastErr = `${model}: ${res.status} ${(await res.text()).slice(0, 160)}`; continue; }
    const body = await res.json() as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[] };
    const inline = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
    if (!inline?.data) { lastErr = `${model}: no audio`; continue; }
    const rate = Number(/rate=(\d+)/.exec(inline.mimeType ?? '')?.[1] ?? 24000);
    const out = wav(Buffer.from(inline.data, 'base64'), rate);
    console.info(`[tts] ${model} ${text.length} chars in ${Date.now() - t0}ms`);
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
    cache.set(key, out);
    return out;
  }
  throw new Error(`TTS failed: ${lastErr}`);
}
