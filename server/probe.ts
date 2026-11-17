/**
 * Compare the configured providers directly (no agent graph), in parallel.
 *   npm run probe
 * For each provider with a key: a tiny reply, and the real Designer prompt
 * streamed for two wishes. Shows which provider each role uses.
 */
import './env.js';
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { chunkText } from './agents/util.js';
import { DEFAULT_META_MODEL, describeModels } from './llm/models.js';
import { geminiProvider, DEFAULT_GEMINI_MODEL } from './llm/providers/gemini.js';
import { metaProvider } from './llm/providers/meta.js';
import { designerSystemFor, designerUser } from './prompts/designer.js';
import { parsePartLine } from '../src/spec/schema.js';
import type { ProviderAdapter } from './llm/types.js';

const providers: [ProviderAdapter, string][] = [];
if (metaProvider.available()) providers.push([metaProvider, process.env.LLM_DEFAULT?.split(':')[1] || DEFAULT_META_MODEL]);
if (geminiProvider.available()) providers.push([geminiProvider, DEFAULT_GEMINI_MODEL]);
if (!providers.length) { console.error('No MODEL_API_KEY or GOOGLE_API_KEY set.'); process.exit(1); }

const tasks: [string, BaseMessage[]][] = [
  ['tiny', [new HumanMessage('Reply with exactly: ok')]],
  ['axolotl', [new SystemMessage(designerSystemFor('a singing axolotl')), new HumanMessage(designerUser('a singing axolotl'))]],
  ['volcano isle', [new SystemMessage(designerSystemFor('a tiny volcano island you can play')), new HumanMessage(designerUser('a tiny volcano island you can play'))]],
];

/** Parse the NDJSON the way the Designer does: lines, parts after `repeat` expansion, rejected lines. */
function countParts(text: string) {
  let lines = 0, parts = 0, bad = 0;
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (!l.startsWith('{')) continue;
    lines++;
    try {
      const rec = JSON.parse(l);
      if (rec.type === 'header' || (!('shape' in rec) && 'palette' in rec)) continue;
      const { type: _t, ...part } = rec;
      const r = parsePartLine(part);
      parts += r.parts.length; if (r.errors.length) bad++;
    } catch { bad++; }
  }
  return { 'json lines': lines, parts, rejected: bad };
}

async function run([p, model]: [ProviderAdapter, string], [task, messages]: [string, BaseMessage[]]) {
  const llm = p.create(model, { reasoning: 'minimal', temperature: 0.7, maxTokens: 4000 });
  const t0 = Date.now();
  let first = -1, text = '';
  try {
    for await (const c of await llm.stream(messages, { signal: AbortSignal.timeout(120_000) })) {
      const t = chunkText(c);
      if (t && first < 0) first = Date.now() - t0;
      text += t;
    }
    return { provider: p.id, model, task, 'first text s': (first / 1000).toFixed(1), 'total s': ((Date.now() - t0) / 1000).toFixed(1),
      ...countParts(text), preview: text.slice(0, 50).replace(/\n/g, ' ') };
  } catch (err) {
    return { provider: p.id, model, task, 'total s': ((Date.now() - t0) / 1000).toFixed(1), preview: `FAILED: ${(err instanceof Error ? err.message : String(err)).slice(0, 90)}` };
  }
}

console.log('Role routing:');
console.table(describeModels());
console.log(`Probing ${providers.map(([p, m]) => `${p.id}:${m}`).join(', ')} in parallel...`);
console.table(await Promise.all(providers.flatMap((p) => tasks.map((t) => run(p, t)))));
