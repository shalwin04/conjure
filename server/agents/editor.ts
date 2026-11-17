/** Editor: turns "make the snare red" into a few edit ops on the current spec. */
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { applyEdits } from '../../src/spec/edits.js';
import { Edit, PALETTES, STYLES, type CreationT, type EditT } from '../../src/spec/schema.js';
import { isFixture, structuredModel } from '../llm/models.js';
import { EDITOR_SYSTEM, editorUser } from '../prompts/editor.js';
import { emit, type NodeConfig, type State, type Update } from '../graph/state.js';

const EditorOut = z.object({
  ops: z.array(Edit).max(20),
  reply: z.string().max(120).nullable(),
});

/** Words in a wish beyond the blueprint's subject, e.g. "pink" and "14 tentacles". */
export function customisationOf(wish: string): string | null {
  const rest = wish.toLowerCase()
    .replace(/\b(a|an|the|me|my|please|build|make|create|conjure|give|i want|singing|glowing|playable|some|of|with|and)\b/g, ' ')
    .replace(/jelly ?fish|medusa|drum ?kit|drum set|drums|xylophone|marimba|glockenspiel|kalimba|thumb piano|volcano|island|isle|tiny|little|world|in my palm|on my hand/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  return rest.length >= 3 ? rest : null;
}

/** After a blueprint: apply the extra wishes as an edit of the blueprint. */
export async function customise(state: State, config: NodeConfig): Promise<Update> {
  const extra = customisationOf(state.request.text);
  if (!extra || !state.draft) return {};
  console.info(`[editor] customising blueprint with "${extra}"`);
  const sub = { ...state, request: { ...state.request, text: `make it ${extra}`, spec: state.draft }, targetPartId: null };
  return editor(sub, config);
}

export async function editor(state: State, config: NodeConfig): Promise<Update> {
  emit(config, { type: 'stage', stage: 'editing' });
  const spec = state.request.spec;
  if (!spec) throw new Error('Nothing on the table to edit yet.');
  const t0 = Date.now();

  let ops: EditT[];
  let reply: string | null;
  let source: 'live' | 'fixture' = 'live';
  const quick = isSimpleEdit(state.request.text) ? fixtureEdit(state.request.text, spec, state.targetPartId) : null;
  if (quick && quick.ops.length) {
    // Resize / recolour / restyle: rules are instant and exact, no model call needed.
    ops = quick.ops;
    reply = 'Done.';
    console.info(`[editor] fast path: ${ops.length} op(s), no model call`);
  } else if (isFixture('editor')) {
    ({ ops, reply } = fixtureEdit(state.request.text, spec, state.targetPartId));
    source = 'fixture';
  } else {
    const out = await structuredModel('editor', EditorOut, 'edit_creation').invoke(
      [new SystemMessage(EDITOR_SYSTEM), new HumanMessage(editorUser(state.request.text, spec, state.targetPartId))],
      { signal: config.signal },
    );
    ops = out.ops;
    reply = out.reply;
  }

  const result = applyEdits(spec, ops);
  console.info(`[editor] ${ops.length} op(s), ${result.applied} applied in ${Date.now() - t0}ms`);
  if (result.issues.length) console.info('[editor]', result.issues);
  emit(config, { type: 'edit', ops });
  if (reply) emit(config, { type: 'say', text: reply });
  if (result.applied === 0) emit(config, { type: 'say', text: "I couldn't apply that change. Try saying it another way." });
  return { draft: result.spec, reply, source };
}

/** Requests the rules can fully handle: size, colour, glow, palette, style, nothing structural. */
export function isSimpleEdit(text: string): boolean {
  return !/\b(add|remove|delete|replace|new|another|extra|more|fewer|less|move|swap|into|instead|turn|sound|pitch|note|louder|quieter|higher|lower|faster|slower)\b/i.test(text);
}

const COLOR_WORDS: Record<string, 'accentRed' | 'accentBlue' | 'accent' | 'glow'> = {
  red: 'accentRed', pink: 'accentRed', blue: 'accentBlue', cyan: 'accentBlue', gold: 'accent', yellow: 'accent', white: 'glow',
};

/** Replay mode: resize, recolour, restyle with simple rules. */
export function fixtureEdit(text: string, spec: CreationT, focus: string | null): { ops: EditT[]; reply: string | null } {
  const t = text.toLowerCase();
  const targets = spec.parts.filter((p) => (focus ? p.id === focus : p.verb !== 'none') || t.includes(p.id) || (p.label && t.includes(p.label.toLowerCase())));
  const chosen = targets.length ? targets : spec.parts.filter((p) => p.verb !== 'none');
  const ops: EditT[] = [];

  const scale = /\b(bigger|larger)\b/.test(t) ? 1.25 : /\bsmaller\b/.test(t) ? 0.8 : null;
  if (scale) for (const p of chosen) ops.push({ op: 'update', id: p.id, patch: { transform: { scale: Math.min(3, (p.transform.scale ?? 1) * scale) } } });

  const color = Object.keys(COLOR_WORDS).find((w) => t.includes(w));
  if (color) for (const p of chosen) ops.push({ op: 'update', id: p.id, patch: { material: { ...p.material, color: COLOR_WORDS[color], glow: 0.4 } } });
  if (/\bglow/.test(t)) for (const p of chosen) ops.push({ op: 'update', id: p.id, patch: { material: { ...p.material, glow: 0.8 } } });

  const palette = PALETTES.find((p) => t.includes(p));
  if (palette) ops.push({ op: 'set', field: 'palette', value: palette });
  const style = STYLES.find((s) => t.includes(s));
  if (style) ops.push({ op: 'set', field: 'style', value: style });

  return ops.length
    ? { ops, reply: 'Done.' }
    : { ops, reply: 'Replay mode can resize, recolour and restyle. Add an API key for more.' };
}
