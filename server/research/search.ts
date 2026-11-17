/**
 * Web-grounded research calls, one per provider.
 *  - Meta: Responses API with the built-in {"type":"web_search"} tool.
 *  - Gemini: generateContent with the google_search grounding tool.
 * Both return plain text plus the URLs the model cited.
 */
import OpenAI from 'openai';
import { META_BASE_URL } from '../llm/providers/meta.js';
import type { ModelChoice } from '../llm/types.js';

export interface GroundedResult { text: string; sources: { title?: string; url: string }[]; grounded: boolean }

export async function groundedSearch(choice: ModelChoice, system: string, user: string, signal: AbortSignal): Promise<GroundedResult> {
  if (choice.provider === 'meta') return metaSearch(choice.model, system, user, signal);
  if (choice.provider === 'gemini') return geminiSearch(choice.model, system, user, signal);
  throw new Error('No research provider configured');
}

async function metaSearch(model: string, system: string, user: string, signal: AbortSignal): Promise<GroundedResult> {
  const client = new OpenAI({ apiKey: process.env.MODEL_API_KEY, baseURL: META_BASE_URL, timeout: 60_000, maxRetries: 0 });
  const run = (tools: boolean) => client.responses.create({
    model,
    instructions: system,
    input: user,
    reasoning: { effort: 'minimal' },
    ...(tools ? { tools: [{ type: 'web_search' } as never] } : {}),
  }, { signal });
  let grounded = true;
  let res;
  try {
    res = await run(true);
  } catch (err) {
    if (signal.aborted) throw err;
    console.warn('[research] web_search unavailable, using model knowledge:', err instanceof Error ? err.message : err);
    grounded = false;
    res = await run(false);
  }
  const sources: GroundedResult['sources'] = [];
  for (const item of (res.output ?? []) as unknown as { type: string; content?: { annotations?: { type: string; url?: string; title?: string }[] }[] }[]) {
    if (item.type !== 'message') continue;
    for (const c of item.content ?? []) for (const a of c.annotations ?? []) {
      if (a.type === 'url_citation' && a.url && !sources.some((s) => s.url === a.url)) sources.push({ url: a.url, title: a.title });
    }
  }
  return { text: res.output_text ?? '', sources, grounded };
}

async function geminiSearch(model: string, system: string, user: string, signal: AbortSignal): Promise<GroundedResult> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GOOGLE_API_KEY ?? '' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      tools: [{ google_search: {} }],
    }),
  });
  if (!res.ok) throw new Error(`Gemini research failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] } }[];
  };
  const cand = json.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  const sources = (cand?.groundingMetadata?.groundingChunks ?? [])
    .map((c) => ({ url: c.web?.uri ?? '', title: c.web?.title }))
    .filter((s) => s.url);
  return { text, sources, grounded: sources.length > 0 };
}
