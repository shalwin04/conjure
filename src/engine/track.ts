/**
 * Race tracks: a closed loop around the world (a twisty circuit or an oval),
 * shared by the layout solver (keep things off it, line cars up on the grid,
 * grandstands beside it), the renderer (asphalt with kerbs) and the story
 * (checkpoint gates around the lap). Index 0 is the start line, on the east
 * side, where the track runs north: you land on the grid looking down the straight.
 */
export type TrackKind = 'circuit' | 'oval';
export interface TrackOwner { track?: TrackKind; radius: number; seed?: number }

/** Track width in world units (about 10 m at the immersive scale). */
export const TRACK_WIDTH = 0.24;
const N = 220;
const cache = new Map<string, [number, number][]>();

export function trackLoop(t: TrackOwner): [number, number][] | null {
  if (!t.track) return null;
  const key = `${t.track}:${t.radius}:${t.seed ?? 1}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const R = Math.max(0.5, t.radius * 1.45);
  const s = ((t.seed ?? 1) % 7) * 0.7;
  const pts: [number, number][] = [];
  for (let k = 0; k < N; k++) {
    const th = Math.PI / 2 + (k / N) * Math.PI * 2;
    if (t.track === 'oval') {
      // A stadium oval: long straights, round ends (a squared ellipse).
      const c = Math.cos(th), sn = Math.sin(th);
      const e = 0.35;
      const x = Math.sign(sn) * Math.pow(Math.abs(sn), e) * R * 1.25;
      const z = Math.sign(c) * Math.pow(Math.abs(c), e) * R * 0.75;
      pts.push([x, z]);
    } else {
      // A circuit: wobbles make hairpins, sweepers and a long straight.
      const r = R * (1 + 0.2 * Math.sin(2 * th + s) + 0.09 * Math.sin(3 * th + 2 * s) + 0.05 * Math.sin(5 * th + s));
      pts.push([Math.sin(th) * r, Math.cos(th) * r]);
    }
  }
  cache.set(key, pts);
  return pts;
}

/** Distance from (x, z) to the track's centre line. */
export function trackDistance(pts: readonly [number, number][], x: number, z: number) {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz || 1e-9;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const d = Math.hypot(ax + dx * u - x, az + dz * u - z);
    if (d < best) best = d;
  }
  return best;
}

/** Point k of the loop with its heading (yaw in degrees that turns +z along the track) and outward normal. */
export function trackFrame(pts: readonly [number, number][], k: number) {
  const n = pts.length, i = ((k % n) + n) % n;
  const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % n];
  const tx = bx - ax, tz = bz - az, l = Math.hypot(tx, tz) || 1;
  // Outward = the side away from the middle.
  let nx = tz / l, nz = -tx / l;
  if (nx * ax + nz * az < 0) { nx = -nx; nz = -nz; }
  return { x: ax, z: az, yaw: (Math.atan2(tx, tz) * 180) / Math.PI, nx, nz };
}

const WORDS = /\b(circuit|formula ?(1|one)|f1|grand prix|race ?track|racing|racecourse|race course|speedway|karting|go-?kart|nascar|indy|silverstone|monza|le mans|spa|suzuka|monaco|daytona|rally)\b/i;
export function guessTrack(text: string): TrackKind | null {
  if (!WORDS.test(text)) return null;
  return /\b(oval|speedway|nascar|indy|daytona)\b/i.test(text) ? 'oval' : 'circuit';
}
