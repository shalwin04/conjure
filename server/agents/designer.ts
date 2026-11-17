/**
 * Designer: turns a wish into a creation, streaming NDJSON. Each line is
 * validated and sent to the headset immediately, so parts appear while the
 * model is still writing. Plain-text NDJSON works the same on every provider.
 */
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { PRESETS, blueprintFor } from '../../src/spec/presets.js';
import { CreationHeader, PALETTES, STYLES, parsePartLine, validateCreation, type CreationHeaderT, type CreationT, type PartT } from '../../src/spec/schema.js';
import { chatModel, isFixture } from '../llm/models.js';
import { designerSystemFor, designerUser } from '../prompts/designer.js';
import { isWorldWish } from '../prompts/catalogue.js';
import { formatCard } from '../research/reference.js';
import { emit, type NodeConfig, type State, type Update } from '../graph/state.js';
import { chunkText, NdjsonParser, sleep } from './util.js';

const newId = () => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** A world wish always gets a world, even if the model forgot the terrain. */
function asWorld(h: CreationHeaderT): CreationHeaderT {
  if (h.kind === 'world' && h.terrain) return h;
  return { ...h, kind: 'world', terrain: h.terrain ?? { style: 'island', radius: 0.22, height: 0.06, roughness: 0.5, water: true }, ambient: h.ambient ?? { particles: 'none', light: 'day' } };
}

function normalizeHeader(raw: Record<string, unknown>): CreationHeaderT {
  const parsed = CreationHeader.safeParse({ narration: [], ...raw });
  if (parsed.success) return parsed.data;
  return {
    title: typeof raw.title === 'string' ? raw.title.slice(0, 60) : 'Creation',
    palette: (PALETTES as readonly string[]).includes(raw.palette as string) ? (raw.palette as CreationHeaderT['palette']) : 'aurora',
    style: (STYLES as readonly string[]).includes(raw.style as string) ? (raw.style as CreationHeaderT['style']) : 'glass',
    narration: [],
  };
}

export async function designer(state: State, config: NodeConfig): Promise<Update> {
  emit(config, { type: 'stage', stage: 'designing' });
  if (isFixture('designer')) return fixtureDesign(state, config);
  const bp = process.env.BLUEPRINTS === 'off' ? null : blueprintFor(state.request.text);
  if (bp) return blueprintDesign(state, config, bp);

  let header: CreationHeaderT | null = null;
  const parts: PartT[] = [];
  const notes: string[] = [];
  const world = isWorldWish(state.request.text);

  const accept = (obj: unknown) => {
    if (!obj || typeof obj !== 'object') return;
    const rec = obj as Record<string, unknown>;
    if (rec.type === 'header' || (!('shape' in rec) && 'palette' in rec)) {
      if (!header) {
        header = normalizeHeader(rec);
        if (world) header = asWorld(header);
        emit(config, { type: 'plan', header, source: 'live' });
      }
      return;
    }
    if (!header) {
      header = normalizeHeader({});
      if (world) header = asWorld(header);
      emit(config, { type: 'plan', header, source: 'live' });
    }
    const { type: _type, ...partRaw } = rec;
    const { parts: expanded, errors, fixes } = parsePartLine(partRaw);
    if (!expanded.length) { notes.push(`skipped part ${String(rec.id ?? '?')}: ${errors.join('; ')}`); return; }
    notes.push(...fixes);
    for (const part of expanded) {
      if (parts.length >= 24) return;
      if (parts.some((p) => p.id === part.id)) part.id = `${part.id}-${parts.length}`;
      parts.push(part);
      emit(config, { type: 'part', part, index: parts.length - 1 });
    }
  };

  const t0 = Date.now();
  let firstChunkMs = -1, chunks = 0, chars = 0;
  const parser = new NdjsonParser();
  const stream = await chatModel('designer').stream(
    [new SystemMessage(designerSystemFor(state.request.text)), new HumanMessage(designerUser(state.request.text, state.reference ? formatCard(state.reference) : null))],
    { signal: config.signal },
  );
  console.info(`[designer] stream opened after ${Date.now() - t0}ms (model thinking)`);
  for await (const chunk of stream) {
    const text = chunkText(chunk);
    chunks++;
    chars += text.length;
    if (firstChunkMs < 0 && text) {
      firstChunkMs = Date.now() - t0;
      console.info(`[designer] first text after ${firstChunkMs}ms`);
    }
    const before = parts.length;
    for (const obj of parser.push(text)) accept(obj);
    if (parts.length > before) console.info(`[designer] part ${parts.length} at ${Date.now() - t0}ms`);
  }
  for (const obj of parser.end()) accept(obj);
  console.info(`[designer] done in ${Date.now() - t0}ms: ${chunks} chunks, ${chars} chars, ${parts.length} parts, ${parser.bad.length} bad lines`);

  // Last resort: the model returned one JSON document instead of NDJSON.
  if (parts.length === 0) {
    const whole = parser.text.slice(parser.text.indexOf('{'), parser.text.lastIndexOf('}') + 1);
    try {
      const doc = JSON.parse(whole);
      const v = validateCreation({ id: newId(), version: 1, narration: [], ...doc });
      if (v.ok && v.creation) {
        emit(config, { type: 'plan', header: normalizeHeader(doc), source: 'live' });
        v.creation.parts.forEach((p, i) => emit(config, { type: 'part', part: p, index: i }));
        return { draft: v.creation };
      }
    } catch { /* fall through */ }
    throw new Error('The designer did not produce any playable parts. Try describing it differently.');
  }

  if (notes.length) console.info('[designer]', notes);
  const h = header as CreationHeaderT | null ?? normalizeHeader({});
  const draft: CreationT = { id: newId(), version: 1, ...h, parts };
  return { draft };
}

/**
 * Blueprint fast path: a hand-tuned design for a known subject streams in
 * immediately (no model call). Extra wishes ("pink, with 14 tentacles") are
 * applied afterwards by the Editor and the Critic.
 */
async function blueprintDesign(state: State, config: NodeConfig, key: keyof typeof PRESETS): Promise<Update> {
  const preset = structuredClone(PRESETS[key]);
  const v = validateCreation(preset);
  const spec = v.creation!;
  console.info(`[designer] blueprint "${key}" (no model call)`);
  emit(config, { type: 'plan', header: { title: spec.title, palette: spec.palette, style: spec.style, narration: spec.narration, kind: spec.kind, terrain: spec.terrain, ambient: spec.ambient }, source: 'live' });
  for (const [i, part] of spec.parts.entries()) {
    await sleep(60, config.signal);
    emit(config, { type: 'part', part, index: i });
  }
  return { draft: { ...spec, id: newId(), version: 1 }, blueprint: key };
}

/** Replay mode (no API key): stream a matching preset like the model would. */
async function fixtureDesign(state: State, config: NodeConfig): Promise<Update> {
  const text = state.request.text.toLowerCase();
  const key = /jelly|medusa|sea|ocean/.test(text) ? 'jellyfish' : /drum|beat|kit|percussion|bongo|tom/.test(text) ? 'drums' : 'kalimba';
  const preset = structuredClone(PRESETS[key]);
  emit(config, { type: 'say', text: 'Replay mode (no API key): showing a built-in creation.' });
  emit(config, { type: 'plan', header: { title: preset.title, palette: preset.palette, style: preset.style, narration: preset.narration }, source: 'fixture' });
  for (const [i, part] of preset.parts.entries()) {
    await sleep(140, config.signal);
    emit(config, { type: 'part', part, index: i });
  }
  return { draft: { ...preset, id: newId(), version: 1 }, source: 'fixture' };
}
