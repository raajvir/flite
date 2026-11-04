/**
 * Low-poly track mesh, generated from the same TrackWorld the physics uses,
 * so what you see is exactly what the tires feel.
 *
 * Layers:
 *   base     road, verges (with camber heights), raised sausage kerbs, walls
 *   overlay  edge lines, kerbs, gravel, astroturf, run-off, pit lane (drawn on top
 *            with a polygon offset so they never flicker against the base)
 * Flat-shaded triangles with vertex colours, no textures.
 */
import * as THREE from 'three';
import type { Surface } from '../sim/surfaces';
import type { SurfaceBand, TrackWorld } from '../sim/trackWorld';
import { Builder } from './meshBuilder';

const STEP = 2; // m between cross-sections along the track
/** Points this far along the track from the one being drawn count as "another part of the track", m. */
const OTHER_SECTION_GAP = 40;
/** Draw a retaining wall when the verge is this far above the terrain, m. */
const SKIRT_MIN = 0.8;
const SKIRT_COLOR = '#9aa39a';
/** Slightly varied greens so the low-poly terrain facets read. */
const TERRAIN_SHADES = ['#78c066', '#7cc46a', '#74bb62', '#80c86e'];
const OVERLAY_LIFT = 0.02; // m
const KERB_LIFT = 0.012; // m: kerbs drawn a hair above the road so their inner edge doesn't flicker
const GROUND_DROP = 2; // m: the endless plane sits this far below the lowest terrain
const GROUND_SIZE = 8000; // m

/** Sample distances from s0 to s1 (wrapping), every STEP, including both ends. */
function samples(world: TrackWorld, s0: number, s1: number): number[] {
  const span = world.wrap(s1 - s0) || world.length;
  const out: number[] = [];
  for (let d = 0; d < span; d += STEP) out.push(s0 + d);
  out.push(s0 + span);
  return out;
}

export function buildTrackMesh(world: TrackWorld): THREE.Group {
  const group = new THREE.Group();
  const sf = world.surfaces.byName;
  const base = new Builder();
  const overlay = new Builder();
  const walls = new Builder();

  const P = (s: number, d: number, lift = 0): number[] => {
    const p = world.point(s, d);
    return [p.x, world.heightAt(s, d).h + lift, p.z];
  };
  const edge = (s: number, left: boolean) => world.at(left ? world.wl : world.wr, s);
  /** Lateral coordinate for an offset beyond the edge on a side. */
  const D = (s: number, left: boolean, off: number) => (left ? 1 : -1) * (edge(s, left) + off);

  /**
   * Strip between two offsets (from the edge) along [s0, s1].
   * Winding is chosen so faces point up on both sides.
   */
  const strip = (
    b: Builder,
    s0: number,
    s1: number,
    left: boolean,
    offIn: (s: number) => number,
    offOut: (s: number) => number,
    color: (s: number) => string,
    lift = 0,
    skipOverlap = false,
  ) => {
    const ss = samples(world, s0, s1);
    for (let k = 0; k < ss.length - 1; k++) {
      const a = ss[k]!, c = ss[k + 1]!;
      if (skipOverlap && (overOther(a, D(a, left, offOut(a))) || overOther(c, D(c, left, offOut(c))))) continue;
      const ai = P(a, D(a, left, offIn(a)), lift), ao = P(a, D(a, left, offOut(a)), lift);
      const ci = P(c, D(c, left, offIn(c)), lift), co = P(c, D(c, left, offOut(c)), lift);
      if (left) b.quad(ai, ci, co, ao, color((a + c) / 2));
      else b.quad(ao, co, ci, ai, color((a + c) / 2));
    }
  };

  /**
   * Is the point (s, d) actually over a DIFFERENT part of the track (e.g. under a bridge, or
   * where two stretches run close)? Then the verge there must not be drawn.
   */
  const overOther = (s: number, d: number): boolean => {
    const p = world.point(s, d);
    const pr = world.project(p.x, p.z);
    let ds = Math.abs(pr.s - world.wrap(s));
    ds = Math.min(ds, world.length - ds);
    if (ds < OTHER_SECTION_GAP) return false;
    const l = pr.d >= 0;
    return Math.abs(pr.d) < world.at(l ? world.wl : world.wr, pr.s) + world.wallAt(pr.s, l);
  };

  const stripes = (s: Surface) => (pos: number) =>
    s.colorAlt && s.stripe && Math.floor(world.wrap(pos) / s.stripe) % 2 === 1 ? s.colorAlt : s.color;

  // --- Road (full lap).
  {
    const ss = samples(world, 0, world.length);
    for (let k = 0; k < ss.length - 1; k++) {
      const a = ss[k]!, c = ss[k + 1]!;
      const al = P(a, edge(a, true)), ar = P(a, -edge(a, false));
      const cl = P(c, edge(c, true)), cr = P(c, -edge(c, false));
      base.quad(al, ar, cr, cl, sf.asphalt!.color); // wound so the face points up
    }
  }

  // --- Verges: grass from the edge out past the walls, split so the camber blend shows.
  for (const left of [true, false]) {
    const wallOff = (s: number) => world.wallAt(s, left);
    // Offsets from the edge where the verge is split (always increasing, even if the wall is close).
    const cuts: ((s: number) => number)[] = [
      () => 0,
      (s) => Math.min(2, wallOff(s)),
      (s) => Math.min(17, wallOff(s)),
      wallOff,
    ];
    for (let k = 0; k < cuts.length - 1; k++) {
      strip(base, 0, world.length, left, cuts[k]!, cuts[k + 1]!, () => sf[world.layout.verge]!.color, 0, true);
    }
    // Painted edge line just inside the edge.
    const ew = world.layout.edgeLine.width;
    strip(overlay, 0, world.length, left, () => -ew, () => 0, () => sf[world.layout.edgeLine.surface]!.color, OVERLAY_LIFT * 0.5);
  }

  // --- Start line across the road.
  {
    const s0 = 0, s1 = 1.2;
    const a = [P(s0, edge(s0, true), OVERLAY_LIFT), P(s1, edge(s1, true), OVERLAY_LIFT), P(s1, -edge(s1, false), OVERLAY_LIFT), P(s0, -edge(s0, false), OVERLAY_LIFT)];
    overlay.quad(a[0]!, a[1]!, a[2]!, a[3]!, '#ffffff');
  }

  // --- Surface bands.
  for (const band of world.layout.bands as SurfaceBand[]) {
    const s = sf[band.surface]!;
    const left = band.side === 'left';
    if (s.profile !== 'none') {
      kerbMesh(base, world, band, s, D, left, stripes(s));
      continue;
    }
    strip(overlay, band.s_start, band.s_end, left, () => band.offset, () => band.offset + band.width, stripes(s), OVERLAY_LIFT);
  }

  // --- Walls: vertical striped barriers at the wall line on both sides.
  const wallS = sf.wall!;
  const wallH = wallS.height ?? 1;
  for (const left of [true, false]) {
    const ss = samples(world, 0, world.length);
    for (let k = 0; k < ss.length - 1; k++) {
      const a = ss[k]!, c = ss[k + 1]!;
      const da = D(a, left, world.wallAt(a, left)), dc = D(c, left, world.wallAt(c, left));
      const pa = P(a, da);
      const pc = P(c, dc);
      const color = stripes(wallS)((a + c) / 2);
      walls.quad(pa, pc, [pc[0]!, pc[1]! + wallH, pc[2]!], [pa[0]!, pa[1]! + wallH, pa[2]!], color);
      // Retaining wall from the verge down to the terrain where the track is raised (bridges, embankments).
      const ta = world.terrainAt(pa[0]!, pa[2]!), tc = world.terrainAt(pc[0]!, pc[2]!);
      if (pa[1]! - ta > SKIRT_MIN || pc[1]! - tc > SKIRT_MIN) {
        if (!overOther(a, da) && !overOther(c, dc)) walls.quad([pa[0]!, ta, pa[2]!], [pc[0]!, tc, pc[2]!], pc, pa, SKIRT_COLOR);
      }
    }
  }

  const baseMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const overlayMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const wallMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  group.add(base.mesh(baseMat), overlay.mesh(overlayMat));
  const wallMesh = walls.mesh(wallMat);
  wallMesh.castShadow = true;
  group.add(wallMesh);

  // Terrain around the track (built by tools/track_builder.py), plus an endless plane beyond it.
  const t = world.track.terrain;
  let minH = 0;
  if (t) {
    const tb = new Builder();
    const H = (i: number, j: number) => t.h[j * t.nx + i]!;
    minH = Math.min(...t.h);
    for (let j = 0; j < t.nz - 1; j++) {
      for (let i = 0; i < t.nx - 1; i++) {
        const x0 = t.x0 + i * t.cell, z0 = t.z0 + j * t.cell, x1 = x0 + t.cell, z1 = z0 + t.cell;
        const shade = TERRAIN_SHADES[(i * 7 + j * 13) % TERRAIN_SHADES.length]!;
        tb.quad([x0, H(i, j), z0], [x0, H(i, j + 1), z1], [x1, H(i + 1, j + 1), z1], [x1, H(i + 1, j), z0], shade);
      }
    }
    group.add(tb.mesh(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide })));
  }
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new THREE.MeshLambertMaterial({ color: sf[world.layout.verge]!.color }),
  );
  ground.rotation.x = -Math.PI / 2;
  let cx = 0, cz = 0;
  for (let i = 0; i < world.n; i++) {
    cx += world.x[i]! / world.n;
    cz += world.z[i]! / world.n;
  }
  ground.position.set(cx, minH - GROUND_DROP, cz);
  ground.receiveShadow = true;
  group.add(ground);
  return group;
}

/**
 * Kerb with its real cross-section (same profile the physics uses): a ramp with a
 * rounded outer edge for flat kerbs, a hump for sausage kerbs, tapering in at both ends.
 */
function kerbMesh(
  b: Builder,
  world: TrackWorld,
  band: SurfaceBand,
  s: Surface,
  D: (s: number, left: boolean, off: number) => number,
  left: boolean,
  color: (s: number) => string,
): void {
  const us = s.profile === 'ramp' ? [0, 0.85, 1] : [0, 0.15, 0.35, 0.5, 0.65, 0.85, 1];
  const point = (sv: number, u: number): number[] => {
    const d = D(sv, left, band.offset + u * band.width);
    const p = world.point(sv, d);
    const info = world.surfaceInfo(sv, d);
    return [p.x, world.heightAt(sv, d).h + info.kerb + KERB_LIFT, p.z];
  };
  const ss = samples(world, band.s_start, band.s_end);
  for (let k = 0; k < ss.length - 1; k++) {
    const a = ss[k]!, c = ss[k + 1]!;
    const col = color((a + c) / 2);
    for (let j = 0; j < us.length - 1; j++) {
      const ai = point(a, us[j]! + 1e-4), ao = point(a, us[j + 1]! - 1e-4);
      const ci = point(c, us[j]! + 1e-4), co = point(c, us[j + 1]! - 1e-4);
      if (left) b.quad(ai, ci, co, ao, col);
      else b.quad(ao, co, ci, ai, col);
    }
  }
}
