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

const STEP = 2; // m between cross-sections along the track
const VERGE_BEYOND_WALL = 40; // m of grass drawn outside the walls
const OVERLAY_LIFT = 0.02; // m
const GROUND_DROP = 0.25; // m: infinite ground plane sits this far below
const GROUND_SIZE = 8000; // m

class Builder {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  private readonly c = new THREE.Color();

  tri(a: number[], b: number[], c: number[], color: string): void {
    this.c.set(color);
    for (const p of [a, b, c]) {
      this.pos.push(p[0]!, p[1]!, p[2]!);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
  }

  /** Quad a-b-c-d (counter-clockwise seen from above/outside). */
  quad(a: number[], b: number[], c: number[], d: number[], color: string): void {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  mesh(material: THREE.Material): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    return m;
  }
}

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
  ) => {
    const ss = samples(world, s0, s1);
    for (let k = 0; k < ss.length - 1; k++) {
      const a = ss[k]!, c = ss[k + 1]!;
      const ai = P(a, D(a, left, offIn(a)), lift), ao = P(a, D(a, left, offOut(a)), lift);
      const ci = P(c, D(c, left, offIn(c)), lift), co = P(c, D(c, left, offOut(c)), lift);
      if (left) b.quad(ai, ci, co, ao, color((a + c) / 2));
      else b.quad(ao, co, ci, ai, color((a + c) / 2));
    }
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
      (s) => wallOff(s) + VERGE_BEYOND_WALL,
    ];
    for (let k = 0; k < cuts.length - 1; k++) {
      strip(base, 0, world.length, left, cuts[k]!, cuts[k + 1]!, () => sf[world.layout.verge]!.color);
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
    if (s.name === 'kerb_sausage') {
      sausage(base, world, band, s, P, D, left, stripes(s));
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
      const pa = P(a, D(a, left, world.wallAt(a, left)));
      const pc = P(c, D(c, left, world.wallAt(c, left)));
      const color = stripes(wallS)((a + c) / 2);
      walls.quad(pa, pc, [pc[0]!, pc[1]! + wallH, pc[2]!], [pa[0]!, pa[1]! + wallH, pa[2]!], color);
    }
  }

  const baseMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const overlayMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const wallMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  group.add(base.mesh(baseMat), overlay.mesh(overlayMat));
  const wallMesh = walls.mesh(wallMat);
  wallMesh.castShadow = true;
  group.add(wallMesh);

  // Endless ground below everything.
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
  ground.position.set(cx, -GROUND_DROP, cz);
  ground.receiveShadow = true;
  group.add(ground);
  return group;
}

/** Raised sausage kerb: a striped box along the band. */
function sausage(
  b: Builder,
  world: TrackWorld,
  band: SurfaceBand,
  s: Surface,
  P: (s: number, d: number, lift?: number) => number[],
  D: (s: number, left: boolean, off: number) => number,
  left: boolean,
  color: (s: number) => string,
): void {
  const h = s.height ?? 0.1;
  const ss = samples(world, band.s_start, band.s_end);
  for (let k = 0; k < ss.length - 1; k++) {
    const a = ss[k]!, c = ss[k + 1]!;
    const ai = P(a, D(a, left, band.offset), h), ao = P(a, D(a, left, band.offset + band.width), h);
    const ci = P(c, D(c, left, band.offset), h), co = P(c, D(c, left, band.offset + band.width), h);
    const col = color((a + c) / 2);
    if (left) b.quad(ai, ci, co, ao, col);
    else b.quad(ao, co, ci, ai, col);
    // Inner and outer faces.
    const down = (p: number[]) => [p[0]!, p[1]! - h, p[2]!];
    b.quad(down(ai), down(ci), ci, ai, col);
    b.quad(ao, co, down(co), down(ao), col);
  }
}
