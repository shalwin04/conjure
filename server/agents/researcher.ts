/**
 * Researcher + Verify: before designing, find out what the real object looks
 * like. Order: verified library -> cache -> web-grounded search (Meta
 * web_search or Gemini google_search). Verify checks the card is about the
 * wish and usable; otherwise the Designer works from its own knowledge.
 */
import { parseJsonFromText } from '../llm/structured.js';
import { isFixture, resolveRole } from '../llm/models.js';
import { RESEARCHER_SYSTEM, researcherUser } from '../prompts/researcher.js';
import { ReferenceCard, fromCache, fromLibrary, remember, verifyCard, type ReferenceCardT } from '../research/reference.js';
import { groundedSearch } from '../research/search.js';
import { emit, type NodeConfig, type State, type Update } from '../graph/state.js';

const RESEARCH_TIMEOUT_MS = Number(process.env.RESEARCH_TIMEOUT_MS ?? 25_000);

export async function researcher(state: State, config: NodeConfig): Promise<Update> {
  const wish = state.request.text;
  if (process.env.RESEARCH === 'off') return { reference: null, referenceOrigin: 'none' };
  emit(config, { type: 'stage', stage: 'researching', message: 'looking up the real thing' });
  const t0 = Date.now();

  const lib = fromLibrary(wish);
  if (lib) return { reference: lib, referenceOrigin: 'library' };
  const cached = fromCache(wish);
  if (cached) return { reference: cached, referenceOrigin: 'cache' };
  if (isFixture('researcher')) return { reference: null, referenceOrigin: 'none' };

  const signal = AbortSignal.any([config.signal ?? new AbortController().signal, AbortSignal.timeout(RESEARCH_TIMEOUT_MS)]);
  try {
    const result = await groundedSearch(resolveRole('researcher'), RESEARCHER_SYSTEM, researcherUser(wish), signal);
    let card: ReferenceCardT | null = null;
    try {
      const parsed = ReferenceCard.safeParse(parseJsonFromText(result.text));
      if (parsed.success) card = parsed.data;
    } catch { /* not JSON */ }
    // A text answer is still useful as a loose reference.
    card ??= result.text.trim() ? { subject: wish.slice(0, 80), summary: result.text.trim().slice(0, 600), parts: [], proportions: [], sources: [] } : null;
    if (card) card.sources = result.sources.slice(0, 8);
    console.info(`[researcher] ${card ? 'card' : 'nothing'} in ${Date.now() - t0}ms, ${result.sources.length} source(s), grounded=${result.grounded}`);
    return { reference: card, referenceOrigin: result.grounded ? 'web' : 'model' };
  } catch (err) {
    if (config.signal?.aborted) throw err;
    console.warn(`[researcher] failed after ${Date.now() - t0}ms:`, err instanceof Error ? err.message : err);
    return { reference: null, referenceOrigin: 'none' };
  }
}

export async function verify(state: State, config: NodeConfig): Promise<Update> {
  const origin = state.referenceOrigin ?? 'none';
  const card = state.reference;
  if (!card) {
    emit(config, { type: 'reference', reference: null, origin: 'none', verified: false, note: 'designing from model knowledge' });
    return { reference: null };
  }
  const check = verifyCard(card, state.request.text);
  if (!check.ok) {
    console.info(`[verify] rejected reference: ${check.reason}`);
    emit(config, { type: 'reference', reference: null, origin: origin, verified: false, note: check.reason });
    return { reference: null };
  }
  if (origin === 'web' || origin === 'model') remember(state.request.text, card);
  emit(config, { type: 'reference', reference: card, origin: origin, verified: true, note: check.reason });
  return { reference: card };
}
