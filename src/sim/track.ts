// A track is a closed centerline (Catmull-Rom through control points), resampled every ~2 m.
// Karts find themselves on it with `locate`, which gives distance along the lap and the
// sideways offset from the middle. Everything here is plain data so the server can use it.

import type { TrackDef, EdgeKind } from './tracks';

export const SAMPLE = 2; // meters between samples

export interface Locate {
  i: number; // sample index of the segment start
  s: number; // distance along the lap, 0..length
  lat: number; // sideways offset from the centerline (+ = right)
  y: number; // road height here
  half: number; // half road width here
  edge: EdgeKind;
}

export class Track {
  readonly def: TrackDef;
  readonly n: number;
  readonly length: number;
  // Per-sample arrays.
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly z: Float64Array;
  readonly tx: Float64Array; // unit tangent (x,z)
  readonly tz: Float64Array;
  readonly w: Float64Array; // full road width
  readonly s: Float64Array; // distance along at this sample
  readonly edge: EdgeKind[];
  readonly bridge: boolean[];

  constructor(def: TrackDef) {
    this.def = def;
    const pts = def.points;
    const m = pts.length;
    // Dense Catmull-Rom (centripetal-ish via uniform with many steps), then resample by length.
    const dense: { x: number; y: number; z: number; w: number; k: number }[] = [];
    const STEPS = 40;
    for (let k = 0; k < m; k++) {
      const p0 = pts[(k - 1 + m) % m], p1 = pts[k], p2 = pts[(k + 1) % m], p3 = pts[(k + 2) % m];
      for (let j = 0; j < STEPS; j++) {
        const t = j / STEPS;
        dense.push({
          x: cr(p0[0], p1[0], p2[0], p3[0], t),
          z: cr(p0[1], p1[1], p2[1], p3[1], t),
          y: cr(p0[2], p1[2], p2[2], p3[2], t),
          w: p1[3] + (p2[3] - p1[3]) * t,
          k,
        });
      }
    }
    // Cumulative length of the dense polyline.
    const dl = new Float64Array(dense.length + 1);
    for (let i = 0; i < dense.length; i++) {
      const a = dense[i], b = dense[(i + 1) % dense.length];
      dl[i + 1] = dl[i] + Math.hypot(b.x - a.x, b.z - a.z);
    }
    const total = dl[dense.length];
    const n = Math.max(16, Math.round(total / SAMPLE));
    this.n = n;
    this.length = total;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.z = new Float64Array(n);
    this.tx = new Float64Array(n);
    this.tz = new Float64Array(n);
    this.w = new Float64Array(n);
    this.s = new Float64Array(n);
    this.edge = [];
    this.bridge = [];
    let j = 0;
    for (let i = 0; i < n; i++) {
      const target = (i / n) * total;
      while (dl[j + 1] < target) j++;
      const a = dense[j], b = dense[(j + 1) % dense.length];
      const f = (target - dl[j]) / Math.max(1e-9, dl[j + 1] - dl[j]);
      this.x[i] = a.x + (b.x - a.x) * f;
      this.y[i] = a.y + (b.y - a.y) * f;
      this.z[i] = a.z + (b.z - a.z) * f;
      this.w[i] = a.w + (b.w - a.w) * f;
      this.s[i] = target;
      const cp = pts[a.k];
      this.edge.push(cp[4] ?? def.edge);
      this.bridge.push(!!cp[5]);
    }
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      const dx = this.x[b] - this.x[a], dz = this.z[b] - this.z[a];
      const d = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / d;
      this.tz[i] = dz / d;
    }
  }

  /** Heading (radians) of the road at sample i. Forward is (cos h, sin h) in x,z. */
  heading(i: number): number {
    return Math.atan2(this.tz[i], this.tx[i]);
  }

  /** Index of the sample at distance s along the lap. */
  indexAt(s: number): number {
    s = ((s % this.length) + this.length) % this.length;
    return Math.min(this.n - 1, Math.floor((s / this.length) * this.n));
  }

  /** World position at distance s along the lap and sideways offset lat. */
  pointAt(s: number, lat = 0): { x: number; y: number; z: number; h: number } {
    s = ((s % this.length) + this.length) % this.length;
    const f = (s / this.length) * this.n;
    const i = Math.floor(f) % this.n, k = (i + 1) % this.n, t = f - Math.floor(f);
    const x = this.x[i] + (this.x[k] - this.x[i]) * t;
    const z = this.z[i] + (this.z[k] - this.z[i]) * t;
    const y = this.y[i] + (this.y[k] - this.y[i]) * t;
    // Right-hand normal is (-tz, tx).
    return { x: x - this.tz[i] * lat, y, z: z + this.tx[i] * lat, h: this.heading(i) };
  }

  /**
   * Find the closest road point. With a hint (last index) only nearby samples are searched,
   * which keeps karts on the right level where the road crosses over itself.
   */
  locate(px: number, pz: number, hint = -1, py = NaN): Locate {
    const n = this.n;
    let best = -1, bestD = Infinity;
    const check = (i: number) => {
      const dx = px - this.x[i], dz = pz - this.z[i];
      let d = dx * dx + dz * dz;
      if (!Number.isNaN(py)) {
        const dy = py - this.y[i];
        if (Math.abs(dy) > 4) d += dy * dy * 40;
      }
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    };
    if (hint >= 0) for (let o = -30; o <= 30; o++) check((hint + o + n) % n);
    else for (let i = 0; i < n; i++) check(i);
    // Project onto the segment best -> best+1 or best-1 -> best, whichever is closer.
    const i0 = best, i1 = (best + 1) % n, im = (best - 1 + n) % n;
    let seg = i0;
    let t = projT(px, pz, this.x[i0], this.z[i0], this.x[i1], this.z[i1]);
    if (t <= 0) {
      seg = im;
      t = projT(px, pz, this.x[im], this.z[im], this.x[i0], this.z[i0]);
    }
    t = Math.max(0, Math.min(1, t));
    const k = (seg + 1) % n;
    const cx = this.x[seg] + (this.x[k] - this.x[seg]) * t;
    const cz = this.z[seg] + (this.z[k] - this.z[seg]) * t;
    const lat = (px - cx) * -this.tz[seg] + (pz - cz) * this.tx[seg];
    const sk = k === 0 ? this.length : this.s[k];
    return {
      i: seg,
      s: this.s[seg] + (sk - this.s[seg]) * t,
      lat,
      y: this.y[seg] + (this.y[k] - this.y[seg]) * t,
      half: this.w[seg] / 2,
      edge: this.edge[seg],
    };
  }

  /** Signed curvature-ish turn over the next `ahead` meters from sample i (radians). */
  turnAhead(i: number, ahead: number): number {
    const j = (i + Math.max(1, Math.round(ahead / (this.length / this.n)))) % this.n;
    let d = this.heading(j) - this.heading(i);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  }
}

function cr(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function projT(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax, vz = bz - az;
  const l = vx * vx + vz * vz || 1;
  return ((px - ax) * vx + (pz - az) * vz) / l;
}

/** How far past the road edge the shoulder runs for each edge kind, in meters. */
export const SHOULDER: Record<EdgeKind, number> = { wall: 1.2, grass: 11, kill: 2.5 };

const cache = new Map<string, Track>();
export function getTrack(def: TrackDef): Track {
  let t = cache.get(def.id);
  if (!t) cache.set(def.id, (t = new Track(def)));
  return t;
}
