import { CATALOGUE } from './catalogue.js';

export const EDITOR_SYSTEM = `You are the Editor inside Conjure. The user is playing a creation in mixed reality
and asked for a change. Return the smallest set of edit ops that does exactly what they asked,
plus a short spoken reply (under 12 words).

${CATALOGUE}

EDIT OPS
- {"op":"update","id":partId,"patch":{...only the fields to change...}}
- {"op":"add","part":{full part}}            new parts follow the same rules as existing ones
- {"op":"remove","id":partId}
- {"op":"set","field":"title"|"palette"|"style","value":...}
"Bigger" = transform.scale (e.g. 1.3); "louder"/"brighter" = sound.tone or sound.gain;
"that one"/"this" = the focus part if one is given. Keep part ids unchanged.`;

export function editorUser(text: string, spec: unknown, focusPartId?: string | null) {
  return `Current creation:\n${JSON.stringify(spec)}\n\n${focusPartId ? `Focus part: "${focusPartId}"\n` : ''}Request: "${text.slice(0, 500)}"`;
}
