/**
 * A real circuit as a World.
 *
 * Track coordinates: s = distance along the centreline (0..length, wraps),
 * d = lateral offset, positive to the LEFT of the driving direction.
 *
 * - project(x, z) -> (s, d): nearest centreline segment, found via a coarse
 *   spatial grid that lists the segments near each cell (fast enough for
 *   several queries per car per 1 ms step).
 * - Surfaces come from authored bands (data/tracks/<name>/surfaces.json):
 *   s range, side, offset from the track edge, width, surface type.
 * - Ground height = camber (banking) across the road and kerbs, blending back
 *   to flat ground over the verge. Elevation along s is supported (zero for now).
 *
 * Pure and deterministic: built once from JSON, then read-only.
 */
import { profileAt, type Surface, type SurfaceTable } from './surfaces';
import type { GroundQuery, World } from './world';

export interface TrackData {
  name: string;
  length_m: number;
  ds_m: number;
  columns: string[];
  points: number[][];
  corners?: { s_start: number; s_end: number; s_apex: number; direction: string; min_radius_m: number }[];
  crossovers?: { s_over?: number; s_under?: number; clearance_m: number }[];
  terrain?: { x0: number; z0: number; cell: number; nx: number; nz: number; h: number[] };
}

export interface SurfaceBand {
  s_start: number;
  s_end: number;
  side: 'left' | 'right';
  /** Distance from the track edge to the band's inner edge, m (negative = on the road) */
  offset: number;
  width: number;
  surface: string;
  note?: string;
}

export interface SurfaceLayout {
  /** Painted edge line just inside each track edge */
  edgeLine: { width: number; surface: string };
  /** Surface beyond the edge where no band says otherwise */
  verge: string;
  /** Walls sit this far beyond the outermost band, but never closer than wallMin to the edge */
  wallGap: number;
  wallMin: number;
  bands: SurfaceBand[];
}

/** Camber applies across the road plus this much beyond each edge (kerbs), m. */
const CAMBER_EXTENSION = 2.0;
/** Beyond that, the camber height blends back to flat ground over this distance, m. */
const CAMBER_BLEND = 15.0;
/** Spatial grid cell size and how far from the centreline a cell lists segments, m. */
const GRID_CELL = 16;
const GRID_REACH = 70;
/** Bands are indexed in s-bins of this size, m. */
const BAND_BIN = 10;
/** Wall offsets are smoothed with a rolling max over +-this many metres, then ramped. */
const WALL_SMOOTH = 30;
/** With a height hint, 1 m of height difference counts like this many metres of distance
 * when choosing the nearest piece of track (so a bridge and the road under it don't mix up). */
const VERT_WEIGHT = 3;

export interface Projection {
  s: number;
  d: number;
  /** Segment index and fraction along it */
  i: number;
  t: number;
}

export class TrackWorld implements World {
  readonly length: number;
  readonly n: number;
  readonly x: Float64Array;
  readonly z: Float64Array;
  readonly heading: Float64Array;
  readonly wl: Float64Array;
  readonly wr: Float64Array;
  readonly bank: Float64Array;
  readonly elev: Float64Array;
  readonly raceD: Float64Array;
  readonly s: Float64Array;
  /** Elevation slope (dz/ds) and curvature (d2z/ds2) along the track */
  readonly elevD1: Float64Array;
  readonly elevD2: Float64Array;
  /** Wall offset from the edge at each sample, per side */
  readonly wallL: Float64Array;
  readonly wallR: Float64Array;
  private readonly grid = new Map<number, Int32Array>();
  private readonly gridX0: number;
  private readonly gridZ0: number;
  private readonly gridW: number;
  private readonly bandBins: { left: number[][]; right: number[][] };
  private readonly bands: (SurfaceBand & { surf: Surface })[];

  constructor(
    readonly track: TrackData,
    readonly layout: SurfaceLayout,
    readonly surfaces: SurfaceTable,
  ) {
    const col = (name: string) => {
      const k = track.columns.indexOf(name);
      if (k < 0) throw new Error(`track.json missing column "${name}"`);
      return Float64Array.from(track.points, (p) => p[k]!);
    };
    this.n = track.points.length;
    this.length = track.length_m;
    this.x = col('x');
    this.z = col('z');
    this.heading = col('heading');
    this.wl = col('w_left');
    this.wr = col('w_right');
    this.bank = col('bank');
    this.elev = col('elev');
    this.raceD = col('race_d');
    this.s = Float64Array.from({ length: this.n }, (_, i) => (i * this.length) / this.n);
    const ds = this.length / this.n;
    this.elevD1 = new Float64Array(this.n);
    this.elevD2 = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const prev = this.elev[(i - 1 + this.n) % this.n]!, next = this.elev[(i + 1) % this.n]!;
      this.elevD1[i] = (next - prev) / (2 * ds);
      this.elevD2[i] = (next - 2 * this.elev[i]! + prev) / (ds * ds);
    }

    this.bands = layout.bands.map((b) => {
      const surf = surfaces.byName[b.surface];
      if (!surf) throw new Error(`Surface band uses unknown surface "${b.surface}"`);
      return { ...b, surf };
    });
    for (const name of [layout.edgeLine.surface, layout.verge]) {
      if (!surfaces.byName[name]) throw new Error(`Track layout uses unknown surface "${name}"`);
    }
    this.bandBins = { left: this.binBands('left'), right: this.binBands('right') };
    this.wallL = this.wallOffsets('left');
    this.wallR = this.wallOffsets('right');

    // Spatial grid.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.n; i++) {
      minX = Math.min(minX, this.x[i]!);
      maxX = Math.max(maxX, this.x[i]!);
      minZ = Math.min(minZ, this.z[i]!);
      maxZ = Math.max(maxZ, this.z[i]!);
    }
    this.gridX0 = minX - GRID_REACH;
    this.gridZ0 = minZ - GRID_REACH;
    this.gridW = Math.ceil((maxX - minX + 2 * GRID_REACH) / GRID_CELL) + 1;
    const lists = new Map<number, number[]>();
    for (let i = 0; i < this.n; i++) {
      const j = (i + 1) % this.n;
      const x0 = Math.min(this.x[i]!, this.x[j]!) - GRID_REACH, x1 = Math.max(this.x[i]!, this.x[j]!) + GRID_REACH;
      const z0 = Math.min(this.z[i]!, this.z[j]!) - GRID_REACH, z1 = Math.max(this.z[i]!, this.z[j]!) + GRID_REACH;
      for (let cx = this.cellX(x0); cx <= this.cellX(x1); cx++) {
        for (let cz = this.cellZ(z0); cz <= this.cellZ(z1); cz++) {
          const key = cz * this.gridW + cx;
          let l = lists.get(key);
          if (!l) lists.set(key, (l = []));
          l.push(i);
        }
      }
    }
    for (const [k, l] of lists) this.grid.set(k, Int32Array.from(l));
  }

  private cellX(x: number): number {
    return Math.floor((x - this.gridX0) / GRID_CELL);
  }
  private cellZ(z: number): number {
    return Math.floor((z - this.gridZ0) / GRID_CELL);
  }

  private binBands(side: 'left' | 'right'): number[][] {
    const bins: number[][] = Array.from({ length: Math.ceil(this.length / BAND_BIN) }, () => []);
    this.bands.forEach((b, idx) => {
      if (b.side !== side) return;
      const span = this.wrap(b.s_end - b.s_start);
      for (let ds = 0; ds <= span + BAND_BIN; ds += BAND_BIN) {
        const bin = Math.floor(this.wrap(b.s_start + Math.min(ds, span)) / BAND_BIN) % bins.length;
        if (!bins[bin]!.includes(idx)) bins[bin]!.push(idx);
      }
    });
    return bins;
  }

  private wallOffsets(side: 'left' | 'right'): Float64Array {
    const raw = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) {
      let outer = 0;
      for (const idx of this.bandBins[side][Math.floor(this.s[i]! / BAND_BIN) % this.bandBins[side].length]!) {
        const b = this.bands[idx]!;
        if (this.inBand(b, this.s[i]!)) outer = Math.max(outer, b.offset + b.width);
      }
      raw[i] = Math.max(this.layout.wallMin, outer + this.layout.wallGap);
    }
    // Rolling max then a moving average: walls step out smoothly around run-off areas.
    const k = Math.round(WALL_SMOOTH / (this.length / this.n));
    const maxed = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) {
      let m = 0;
      for (let j = -k; j <= k; j++) m = Math.max(m, raw[(i + j + this.n) % this.n]!);
      maxed[i] = m;
    }
    const out = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) {
      let sum = 0;
      for (let j = -k; j <= k; j++) sum += maxed[(i + j + this.n) % this.n]!;
      out[i] = sum / (2 * k + 1);
    }
    return out;
  }

  wrap(s: number): number {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  private inBand(b: SurfaceBand, s: number): boolean {
    return this.wrap(s - b.s_start) <= this.wrap(b.s_end - b.s_start);
  }

  /** Linear interpolation of a per-sample array at distance s. */
  at(arr: Float64Array, s: number): number {
    const f = (this.wrap(s) / this.length) * this.n;
    const i = Math.floor(f) % this.n;
    const t = f - Math.floor(f);
    return arr[i]! + (arr[(i + 1) % this.n]! - arr[i]!) * t;
  }

  /** Heading at s (handles the unwrapped heading jump at the lap seam). */
  headingAt(s: number): number {
    const f = (this.wrap(s) / this.length) * this.n;
    const i = Math.floor(f) % this.n;
    const t = f - Math.floor(f);
    const h0 = this.heading[i]!;
    let dh = this.heading[(i + 1) % this.n]! - h0;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    return h0 + dh * t;
  }

  /** World position of track coordinate (s, d). */
  point(s: number, d: number): { x: number; z: number } {
    const f = (this.wrap(s) / this.length) * this.n;
    const i = Math.floor(f) % this.n;
    const j = (i + 1) % this.n;
    const t = f - Math.floor(f);
    const h = this.headingAt(s);
    const cx = this.x[i]! + (this.x[j]! - this.x[i]!) * t;
    const cz = this.z[i]! + (this.z[j]! - this.z[i]!) * t;
    // Left normal of heading h: (-cos h, sin h)
    return { x: cx - Math.cos(h) * d, z: cz + Math.sin(h) * d };
  }

  /**
   * Nearest point on the centreline. With a height hint y, height difference also counts,
   * so where the track crosses itself the level the car is on wins.
   */
  project(x: number, z: number, y?: number): Projection {
    const cand = this.grid.get(this.cellZ(z) * this.gridW + this.cellX(x));
    let best = Infinity, bi = 0, bt = 0;
    const consider = (i: number) => {
      const j = (i + 1) % this.n;
      const ax = this.x[i]!, az = this.z[i]!;
      const ex = this.x[j]! - ax, ez = this.z[j]! - az;
      const len2 = ex * ex + ez * ez;
      let t = ((x - ax) * ex + (z - az) * ez) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + ex * t - x, pz = az + ez * t - z;
      let d2 = px * px + pz * pz;
      if (y !== undefined) {
        const dh = (this.elev[i]! + (this.elev[j]! - this.elev[i]!) * t - y) * VERT_WEIGHT;
        d2 += dh * dh;
      }
      if (d2 < best) {
        best = d2;
        bi = i;
        bt = t;
      }
    };
    if (cand) for (let k = 0; k < cand.length; k++) consider(cand[k]!);
    else for (let i = 0; i < this.n; i++) consider(i); // far off the map: brute force (rare)
    const j = (bi + 1) % this.n;
    const ax = this.x[bi]!, az = this.z[bi]!;
    const ex = this.x[j]! - ax, ez = this.z[j]! - az;
    const len = Math.hypot(ex, ez);
    // d = signed distance to the left: left normal = (ez, -ex)/len for direction (ex, ez)
    const d = ((x - ax) * ez - (z - az) * ex) / len;
    return { s: this.wrap(this.s[bi]! + bt * len), d, i: bi, t: bt };
  }

  /** Surface at track coordinates. */
  surfaceAt(s: number, d: number): Surface {
    return this.surfaceInfo(s, d).surface;
  }

  /**
   * Surface plus kerb profile at track coordinates: kerb height on top of the road and its
   * slope across the track (dh/dd). Kerb profiles taper in over contact.kerbTaper at each end.
   */
  surfaceInfo(s: number, d: number): { surface: Surface; kerb: number; kerbDhdd: number } {
    const left = d >= 0;
    const edge = this.at(left ? this.wl : this.wr, s);
    const off = Math.abs(d) - edge;
    if (off >= this.at(left ? this.wallL : this.wallR, s)) return { surface: this.surfaces.byName.wall!, kerb: 0, kerbDhdd: 0 };
    const bins = left ? this.bandBins.left : this.bandBins.right;
    const bin = bins[Math.floor(this.wrap(s) / BAND_BIN) % bins.length]!;
    for (let k = bin.length - 1; k >= 0; k--) {
      const b = this.bands[bin[k]!]!;
      if (off >= b.offset && off < b.offset + b.width && this.inBand(b, s)) {
        if (b.surf.profile === 'none') return { surface: b.surf, kerb: 0, kerbDhdd: 0 };
        const u = (off - b.offset) / b.width;
        const pr = profileAt(b.surf, u);
        const taper = this.bandTaper(b, s);
        // off grows with |d|, so dh/dd = sign(d) * dh/doff.
        return { surface: b.surf, kerb: pr.h * taper, kerbDhdd: (left ? 1 : -1) * (pr.dhdu / b.width) * taper };
      }
    }
    if (off < 0) {
      const surface =
        off > -this.layout.edgeLine.width ? this.surfaces.byName[this.layout.edgeLine.surface]! : this.surfaces.byName.asphalt!;
      return { surface, kerb: 0, kerbDhdd: 0 };
    }
    return { surface: this.surfaces.byName[this.layout.verge]!, kerb: 0, kerbDhdd: 0 };
  }

  /** 0..1 ramp-in of a band's profile near its ends. */
  bandTaper(b: SurfaceBand, s: number): number {
    const T = this.surfaces.contact.kerbTaper;
    const into = this.wrap(s - b.s_start);
    const left = this.wrap(b.s_end - s);
    return Math.max(0, Math.min(1, into / T, left / T));
  }

  /** Ground height and its derivative across the track (dh/dd). */
  heightAt(s: number, d: number): { h: number; dhdd: number } {
    const tb = Math.tan(this.at(this.bank, s));
    const lim = (d >= 0 ? this.at(this.wl, s) : this.at(this.wr, s)) + CAMBER_EXTENSION;
    const elev = this.at(this.elev, s);
    const ad = Math.abs(d);
    if (ad <= lim) return { h: elev + d * tb, dhdd: tb };
    const edgeH = Math.sign(d) * lim * tb;
    const k = 1 - (ad - lim) / CAMBER_BLEND;
    if (k <= 0) return { h: elev, dhdd: 0 };
    return { h: elev + edgeH * k, dhdd: (-edgeH / CAMBER_BLEND) * Math.sign(d) };
  }

  /** Wall offset from the edge at s on a side. */
  wallAt(s: number, left: boolean): number {
    return this.at(left ? this.wallL : this.wallR, s);
  }

  /** Terrain height around the track (bilinear on the built grid; 0 if none). */
  terrainAt(x: number, z: number): number {
    const t = this.track.terrain;
    if (!t) return 0;
    const fx = Math.max(0, Math.min(t.nx - 1.001, (x - t.x0) / t.cell));
    const fz = Math.max(0, Math.min(t.nz - 1.001, (z - t.z0) / t.cell));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const h = (a: number, b: number) => t.h[b * t.nx + a]!;
    return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
  }

  query(x: number, z: number, y?: number): GroundQuery {
    const p = this.project(x, z, y);
    const h = this.heightAt(p.s, p.d);
    const head = this.headingAt(p.s);
    // Left normal (world) = (-cos h, sin h); forward (world) = (-sin h, -cos h)
    const nx = -Math.cos(head), nz = Math.sin(head);
    const slope = this.at(this.elevD1, p.s);
    const left = p.d >= 0;
    const off = Math.abs(p.d) - this.at(left ? this.wl : this.wr, p.s);
    const wallDepth = Math.max(0, off - this.wallAt(p.s, left));
    const side = left ? 1 : -1;
    const info = this.surfaceInfo(p.s, p.d);
    return {
      surface: info.surface,
      height: h.h + info.kerb,
      kerb: info.kerb,
      gradX: h.dhdd * nx - slope * Math.sin(head),
      gradZ: h.dhdd * nz - slope * Math.cos(head),
      vertCurv: this.at(this.elevD2, p.s),
      kerbGradX: info.kerbDhdd * nx,
      kerbGradZ: info.kerbDhdd * nz,
      wallDepth,
      wallNx: side * nx,
      wallNz: side * nz,
    };
  }
}
