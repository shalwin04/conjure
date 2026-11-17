/**
 * Area designer: one new patch of an endless world, streamed as NDJSON like
 * the Designer, so the user sees it grow while walking toward it. A single
 * fast model call (the Designer's model, Gemini in the hybrid profile): no
 * playtest/repair loop, because areas are explored at a distance first and
 * the engine already enforces sizes, sounds and reactions.
 */
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AreaRequest, ConjureEvent } from '../../src/spec/protocol.js';
import { parsePartLine, type PartT } from '../../src/spec/schema.js';
import { chatModel } from '../llm/models.js';
import { AREA_SYSTEM, areaUser } from '../prompts/area.js';
import { chunkText, NdjsonParser } from './util.js';

export const AREA_MAX_PARTS = 12;

export async function* designArea(req: AreaRequest, signal: AbortSignal): AsyncGenerator<ConjureEvent> {
  const t0 = Date.now();
  yield { type: 'stage', stage: 'designing', message: req.wish ? `Building "${req.wish}"` : 'Discovering a new area' };
  let titled = false;
  const parts: PartT[] = [];
  const out: ConjureEvent[] = [];

  const accept = (obj: unknown) => {
    if (!obj || typeof obj !== 'object') return;
    const rec = obj as Record<string, unknown>;
    if (rec.type === 'area' || (!('shape' in rec) && 'title' in rec)) {
      if (!titled) {
        titled = true;
        const narration = Array.isArray(rec.narration) ? rec.narration.filter((n): n is string => typeof n === 'string').slice(0, 3) : [];
        out.push({ type: 'area', title: String(rec.title ?? 'Somewhere new').slice(0, 40), narration });
      }
      return;
    }
    if (!titled) { titled = true; out.push({ type: 'area', title: req.wish?.slice(0, 40) ?? 'Somewhere new', narration: [] }); }
    const { type: _t, ...raw } = rec;
    const { parts: expanded } = parsePartLine(raw);
    for (const part of expanded) {
      if (parts.length >= AREA_MAX_PARTS) return;
      if (parts.some((p) => p.id === part.id)) part.id = `${part.id}-${parts.length}`;
      parts.push(part);
      out.push({ type: 'part', part, index: parts.length - 1 });
    }
  };

  const parser = new NdjsonParser();
  const stream = await chatModel('designer').stream([new SystemMessage(AREA_SYSTEM), new HumanMessage(areaUser(req))], { signal });
  let first = -1;
  for await (const chunk of stream) {
    const text = chunkText(chunk);
    if (text && first < 0) first = Date.now() - t0;
    for (const obj of parser.push(text)) accept(obj);
    while (out.length) yield out.shift()!;
  }
  for (const obj of parser.end()) accept(obj);
  while (out.length) yield out.shift()!;
  console.info(`[area] ${req.wish ? `wish "${req.wish}"` : `chunk ${req.chunk.x},${req.chunk.z}`}: ${parts.length} parts, first text ${first}ms, total ${Date.now() - t0}ms`);
  if (!parts.length) throw new Error('The world builder returned nothing usable.');
  yield { type: 'stage', stage: 'ready' };
}
