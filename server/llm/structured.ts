/**
 * Provider-tolerant structured output.
 *
 * LangChain's "functionCalling" mode forces a named tool_choice, which Meta's
 * Model API rejects (only "auto" is supported). So each provider declares a
 * preferred mode, and if the provider rejects it at runtime we drop to "text"
 * mode for the rest of the process: ask for JSON in the prompt, parse it, and
 * validate it with zod (one retry with the validation error).
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { chunkText } from '../agents/util.js';
import type { Capabilities } from './types.js';

export type StructuredMode = Capabilities['structuredOutput'];

/** Remember per provider:model when a mode was rejected. */
const downgraded = new Map<string, StructuredMode>();

export function isUnsupportedFeatureError(err: unknown): boolean {
  const e = err as { status?: number; message?: string; error?: { message?: string } };
  const msg = `${e?.message ?? ''} ${e?.error?.message ?? ''}`;
  return (e?.status === 400 || /\b400\b/.test(msg)) && /tool_choice|response_format|json_schema|schema|structured|strict|function/i.test(msg);
}

/** Pull the first JSON object out of model text (tolerates fences and prose). */
export function parseJsonFromText(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in model output');
  return JSON.parse(body.slice(start, end + 1));
}

export function jsonInstruction(schema: z.ZodTypeAny, name: string): string {
  const jsonSchema = z.toJSONSchema(schema, { unrepresentable: 'any' });
  return `Respond with ONLY a JSON object for "${name}" matching this JSON Schema. No prose, no code fences.\n${JSON.stringify(jsonSchema)}`;
}

/**
 * Add an instruction to the system prompt. Some providers (Gemini) only accept a
 * single system message, and only as the first message, so never append one.
 */
export function withSystemInstruction(messages: BaseMessage[], instruction: string): BaseMessage[] {
  const [first, ...rest] = messages;
  if (first && first.getType() === 'system') {
    const text = typeof first.content === 'string' ? first.content : chunkText(first);
    return [new SystemMessage(`${text}\n\n${instruction}`), ...rest];
  }
  return [new SystemMessage(instruction), ...messages];
}

/** Text mode: prompt for JSON, parse, validate, retry once with the error. */
export async function textStructured<T extends z.ZodTypeAny>(
  model: BaseChatModel, schema: T, name: string, messages: BaseMessage[], signal?: AbortSignal,
): Promise<z.infer<T>> {
  const withInstruction = withSystemInstruction(messages, jsonInstruction(schema, name));
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const convo = attempt === 0 ? withInstruction
      : [...withInstruction, new HumanMessage(`Your last reply was invalid: ${lastError}. Reply with corrected JSON only.`)];
    const ai = await model.invoke(convo, { signal });
    try {
      const parsed = schema.safeParse(parseJsonFromText(chunkText(ai)));
      if (parsed.success) return parsed.data;
      lastError = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(`Model did not return valid ${name}: ${lastError}`);
}

/** Structured call with the provider's preferred mode, downgrading to text if rejected. */
export async function invokeStructured<T extends z.ZodTypeAny>(
  key: string, model: BaseChatModel, preferred: StructuredMode, schema: T, name: string,
  messages: BaseMessage[], signal?: AbortSignal,
): Promise<z.infer<T>> {
  const mode = downgraded.get(key) ?? preferred;
  if (mode !== 'text') {
    try {
      const raw = await model.withStructuredOutput(schema, { name, method: mode }).invoke(messages, { signal });
      return schema.parse(raw) as z.infer<T>;
    } catch (err) {
      if (signal?.aborted) throw err;
      if (isUnsupportedFeatureError(err)) {
        console.warn(`[llm] ${key} rejected structured mode "${mode}"; using text mode from now on`);
        downgraded.set(key, 'text');
      } else {
        // Malformed or failed structured reply: try text mode once for this call.
        console.warn(`[llm] ${key} structured call failed (${err instanceof Error ? err.message.slice(0, 120) : err}); retrying in text mode`);
      }
    }
  }
  return textStructured(model, schema, name, messages, signal);
}
