/**
 * Voice input: a push-to-talk clip in, a transcript and one command out.
 * One Gemini call hears the audio AND decides what it means (no separate
 * speech-to-text step), so a spoken wish acts in about a second.
 */
import { DEFAULT_GEMINI_MODEL } from './llm/providers/gemini.js';
import { parseLocal, VoiceCommand, type ListenContext, type ListenResult } from '../src/spec/voice.js';

export const listenAvailable = () => !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) && process.env.VOICE !== 'off';

const MODELS = [...new Set([process.env.GEMINI_LISTEN_MODEL, DEFAULT_GEMINI_MODEL, 'gemini-2.5-flash'].filter(Boolean) as string[])];

function instruction(ctx: ListenContext) {
  return `You are the ears of Conjure, a cozy VR app where people describe worlds, walk inside them and play a story.
Listen to the clip (any language; write the transcript in the language spoken) and return JSON:
{"transcript": "...", "command": {...}} where command is ONE of:
  {"intent":"conjure","text":"<the wish in English>"}  make or change something: a new world ("a snowy village"),
       something to add ("put a windmill here", "add more trees"), or a change ("make it night", "make the tower taller").
  {"intent":"go","target":"<one of the NAMES, exactly>"}  travel to a thing or place ("take me to the fountain").
  {"intent":"move","direction":"forward|back|left|right|north|south|east|west"}  walk a little that way.
  {"intent":"walk"} keep walking.   {"intent":"stop"} stop moving.
  {"intent":"turn","degrees":<-180..180, + is right>}   {"intent":"speed","faster":true|false}
  {"intent":"home"} back to the start.   {"intent":"next"} go to where the story continues ("where next?", "take me there").
  {"intent":"inside"} step into the world.   {"intent":"outside"} step out of it.
  {"intent":"hint"} help with the story.   {"intent":"repeat"} say the last line again.
  {"intent":"choose","option":0|1} pick one of the OPTIONS.
  {"intent":"none"} silence, noise, or not meant for the app.
STATE: ${ctx.hasWorld ? (ctx.inside ? 'standing inside a world' : 'looking at a world on the table') : 'no world yet (most speech is a new world wish)'}.
NAMES: ${ctx.names.slice(0, 60).join(' | ') || '(none)'}
${ctx.options?.length ? `OPTIONS: 0 = ${ctx.options[0]} | 1 = ${ctx.options[1]}` : ''}`;
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcript: { type: 'STRING' },
    command: {
      type: 'OBJECT',
      properties: {
        intent: { type: 'STRING', enum: ['conjure', 'go', 'move', 'walk', 'stop', 'turn', 'speed', 'home', 'next', 'inside', 'outside', 'hint', 'repeat', 'choose', 'none'] },
        text: { type: 'STRING' }, target: { type: 'STRING' }, direction: { type: 'STRING' },
        degrees: { type: 'NUMBER' }, faster: { type: 'BOOLEAN' }, option: { type: 'INTEGER' },
      },
      required: ['intent'],
    },
  },
  required: ['transcript', 'command'],
};

export async function listen(audio: Uint8Array, mime: string, ctx: ListenContext, signal?: AbortSignal): Promise<ListenResult> {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
  let lastErr = '';
  for (const model of MODELS) {
    for (const think of [true, false]) {
      const t0 = Date.now();
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: instruction(ctx) }] },
          contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime, data: Buffer.from(audio).toString('base64') } }] }],
          generationConfig: {
            responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0,
            ...(think ? { thinkingConfig: model.startsWith('gemini-2') ? { thinkingBudget: 0 } : { thinkingLevel: 'LOW' } } : {}),
          },
        }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        lastErr = `${model}: ${res.status} ${(await res.text()).slice(0, 160)}`;
        if (res.status === 400 && think) continue; // the model may not take thinking settings
        break;
      }
      const body = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      try {
        const raw = JSON.parse(text) as { transcript?: string; command?: Record<string, unknown> };
        const transcript = (raw.transcript ?? '').trim().slice(0, 300);
        const result = toResult(transcript, raw.command, ctx);
        console.info(`[listen] ${model} ${Date.now() - t0}ms "${transcript}" -> ${result.command.intent}`);
        return result;
      } catch (err) {
        lastErr = `${model}: bad reply ${err instanceof Error ? err.message : ''}`;
        break;
      }
    }
  }
  throw new Error(`listen failed: ${lastErr}`);
}

/** Validate the model's command; the local grammar wins for plain control phrases. */
export function toResult(transcript: string, cmd: Record<string, unknown> | undefined, ctx: ListenContext): ListenResult {
  const local = parseLocal(transcript, ctx);
  if (local && local.intent !== 'none') return { transcript, command: local };
  const parsed = VoiceCommand.safeParse(cmd ?? {});
  if (parsed.success) {
    const c = parsed.data;
    if (c.intent === 'conjure' && !c.text.trim()) return { transcript, command: transcript ? { intent: 'conjure', text: transcript } : { intent: 'none' } };
    return { transcript, command: c };
  }
  return { transcript, command: transcript ? { intent: 'conjure', text: transcript } : { intent: 'none' } };
}
