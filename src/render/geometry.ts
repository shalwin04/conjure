/**
 * Procedural geometry for the organic shapes the AI can ask for. Each takes a
 * few numbers and returns a smooth mesh, so a two-line spec becomes a bell or
 * a curling tentacle. Centred like the hit zones in engine/verbs.ts.
 */
import { BufferGeometry, CatmullRomCurve3, LatheGeometry, SphereGeometry, TubeGeometry, Vector2, Vector3 } from '@iwsdk/core';

/** Spin a side outline [radius, height] (bottom to top) around y, centred vertically. */
export function latheGeometry(profile: [number, number][]): BufferGeometry {
  const ys = profile.map((p) => p[1]);
  const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
  // Smooth the outline with a curve through the points.
  const curve = new CatmullRomCurve3(profile.map(([r, y]) => new Vector3(Math.max(0.0005, r), y - mid, 0)));
  const pts = curve.getPoints(Math.max(24, profile.length * 8)).map((p) => new Vector2(Math.max(0, p.x), p.y));
  const geo = new LatheGeometry(pts, 48);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Tapering tube hanging down from the origin to -length, with optional curl
 * (a spiral) and wave (side-to-side), tip thinner by `taper`.
 */
export function tubeGeometry(length: number, radius: number, taper = 0.5, curl = 0, wave = 0): BufferGeometry {
  const n = 12;
  const points: Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const turn = t * Math.PI * 2 * (0.5 + curl * 1.5);
    const spiral = curl * 0.25 * length * t;
    const sway = wave * 0.12 * length * Math.sin(t * Math.PI * 3);
    points.push(new Vector3(Math.sin(turn) * spiral + sway, -t * length, Math.cos(turn) * spiral - spiral));
  }
  const curve = new CatmullRomCurve3(points);
  const tubular = 48, radial = 10;
  const geo = new TubeGeometry(curve, tubular, radius, radial, false);
  // Taper: pull each ring toward the curve as it nears the tip.
  const pos = geo.attributes.position;
  const centre = new Vector3();
  const v = new Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, centre);
    const k = 1 - taper * t;
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, idx).sub(centre).multiplyScalar(k).add(centre);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** A soft, lumpy sphere. Deterministic noise so the same spec looks the same. */
export function blobGeometry(radius: number, lumps = 0.3, squash = 1, seed = 1): BufferGeometry {
  const geo = new SphereGeometry(radius, 40, 28);
  const pos = geo.attributes.position;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const bump =
      Math.sin(n.x * 5.1 + seed) * Math.sin(n.y * 4.3 + seed * 2) * Math.sin(n.z * 4.7 + seed * 3) +
      0.5 * Math.sin(n.x * 9.7 + n.y * 8.1 + seed);
    v.multiplyScalar(1 + lumps * 0.18 * bump);
    v.y *= squash;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Stable small integer from a string (for blob seeds). */
export function hashSeed(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (Math.abs(h) % 1000) / 100;
}
