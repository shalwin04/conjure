/**
 * Apply Edit ops to a creation. Pure and shared: the server applies edits from
 * the Editor and Repairer agents; the headset can replay them for undo/redo.
 */
import { PALETTES, STYLES, parsePart, type CreationT, type EditT, type PartT } from './schema.js';

export interface EditResult {
  spec: CreationT;
  applied: number;
  issues: string[];
}

export function applyEdits(spec: CreationT, ops: readonly EditT[]): EditResult {
  const next: CreationT = structuredClone(spec);
  const issues: string[] = [];
  let applied = 0;

  for (const op of ops) {
    switch (op.op) {
      case 'add': {
        if (!op.part) { issues.push('add: missing part'); break; }
        const { part, errors, fixes } = parsePart(op.part);
        if (!part) { issues.push(`add ${op.part.id ?? '?'}: ${errors.join('; ')}`); break; }
        let id = part.id;
        let n = 2;
        while (next.parts.some((p) => p.id === id)) id = `${part.id}-${n++}`;
        part.id = id;
        next.parts.push(part);
        issues.push(...fixes);
        applied++;
        break;
      }
      case 'update': {
        const target = next.parts.find((p) => p.id === op.id);
        if (!target || !op.patch) { issues.push(`update: no part "${op.id}"`); break; }
        const merged = mergePart(target, op.patch);
        const { part, errors, fixes } = parsePart(merged);
        if (!part) { issues.push(`update ${op.id}: ${errors.join('; ')}`); break; }
        next.parts[next.parts.indexOf(target)] = part;
        issues.push(...fixes);
        applied++;
        break;
      }
      case 'remove': {
        const before = next.parts.length;
        next.parts = next.parts.filter((p) => p.id !== op.id);
        if (next.parts.length === before) issues.push(`remove: no part "${op.id}"`);
        else applied++;
        break;
      }
      case 'set': {
        if (op.field === 'title' && op.value) { next.title = op.value.slice(0, 60); applied++; }
        else if (op.field === 'palette' && (PALETTES as readonly string[]).includes(op.value ?? '')) {
          next.palette = op.value as CreationT['palette']; applied++;
        } else if (op.field === 'style' && (STYLES as readonly string[]).includes(op.value ?? '')) {
          next.style = op.value as CreationT['style']; applied++;
        } else issues.push(`set: invalid ${op.field}=${op.value}`);
        break;
      }
    }
  }
  if (next.parts.length === 0) {
    issues.push('edits would remove every part; kept the last version');
    return { spec, applied: 0, issues };
  }
  return { spec: next, applied, issues };
}

function mergePart(base: PartT, patch: NonNullable<EditT['patch']>): unknown {
  return {
    ...base,
    ...(patch.label !== undefined ? { label: patch.label } : {}),
    ...(patch.shape ? { shape: patch.shape } : {}),
    ...(patch.verb ? { verb: patch.verb } : {}),
    ...(patch.fx ? { fx: patch.fx } : {}),
    ...(patch.motion ? { motion: { ...(base.motion ?? {}), ...stripUndefined(patch.motion) } } : {}),
    transform: { ...base.transform, ...stripUndefined(patch.transform ?? {}) },
    material: { ...(base.material ?? {}), ...stripUndefined(patch.material ?? {}) },
    sound: patch.sound ? { ...(base.sound ?? { voice: 'bell' }), ...stripUndefined(patch.sound) } : base.sound,
  };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
