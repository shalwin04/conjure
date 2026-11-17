/**
 * Minimal pure-TS transforms (no three.js) so the server can compute part
 * poses exactly like the headset: position + XYZ euler (degrees) + uniform scale.
 * Matrices are column-major like three.js Matrix4.elements.
 */
import type { CreationT, PartT } from '../spec/schema.js';
import { groundY } from './terrain.js';

/** Position in the play zone. In worlds, pos.y is height above the ground at (x, z). */
export function resolvePos(creation: Pick<CreationT, 'kind' | 'terrain'> | null | undefined, part: PartT): [number, number, number] {
  const [x, y, z] = part.transform.pos;
  if (creation?.kind === 'world' && creation.terrain) return [x, groundY(creation.terrain, x, z) + y, z];
  return [x, y, z];
}

export function partMatrix(part: PartT, out = new Float64Array(16), creation?: Pick<CreationT, 'kind' | 'terrain'> | null): Float64Array {
  const [px, py, pz] = resolvePos(creation, part);
  const [rx, ry, rz] = (part.transform.rot ?? [0, 0, 0]).map((d) => (d * Math.PI) / 180);
  const s = part.transform.scale ?? 1;
  const a = Math.cos(rx), b = Math.sin(rx), c = Math.cos(ry), d = Math.sin(ry), e = Math.cos(rz), f = Math.sin(rz);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  // Same as three.js Matrix4.makeRotationFromEuler for order 'XYZ'.
  out[0] = c * e * s;            out[4] = -c * f * s;           out[8] = d * s;       out[12] = px;
  out[1] = (af + be * d) * s;    out[5] = (ae - bf * d) * s;    out[9] = -b * c * s;  out[13] = py;
  out[2] = (bf - ae * d) * s;    out[6] = (be + af * d) * s;    out[10] = a * c * s;  out[14] = pz;
  out[3] = 0;                    out[7] = 0;                    out[11] = 0;          out[15] = 1;
  return out;
}

/** Inverse of a rotation * uniform-scale + translation matrix. */
export function invertRigidScaled(m: ArrayLike<number>, out = new Float64Array(16)): Float64Array {
  const s2 = m[0] * m[0] + m[1] * m[1] + m[2] * m[2] || 1;
  // Upper 3x3 inverse = transpose / s^2
  out[0] = m[0] / s2; out[4] = m[1] / s2; out[8] = m[2] / s2;
  out[1] = m[4] / s2; out[5] = m[5] / s2; out[9] = m[6] / s2;
  out[2] = m[8] / s2; out[6] = m[9] / s2; out[10] = m[10] / s2;
  out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
  out[12] = -(out[0] * m[12] + out[4] * m[13] + out[8] * m[14]);
  out[13] = -(out[1] * m[12] + out[5] * m[13] + out[9] * m[14]);
  out[14] = -(out[2] * m[12] + out[6] * m[13] + out[10] * m[14]);
  return out;
}
