/**
 * The world as the car sees it: what's under a point on the ground.
 * Implemented by FlatWorld (test area) and TrackWorld (real circuits).
 * Everything here is pure and deterministic.
 */
import type { Surface, SurfaceTable } from './surfaces';

export interface GroundQuery {
  surface: Surface;
  /** Ground height, m */
  height: number;
  /** Ground gradient dh/dx and dh/dz (world axes) */
  gradX: number;
  gradZ: number;
  /** How far the point is past the wall (m, 0 = not touching) and the wall's outward normal (world XZ) */
  wallDepth: number;
  wallNx: number;
  wallNz: number;
}

export interface World {
  readonly surfaces: SurfaceTable;
  query(x: number, z: number): GroundQuery;
}

export interface SurfacePatch {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  surface: string;
}

/** Flat ground, a default surface, optional rectangular patches of other surfaces, optional slope. No walls. */
export class FlatWorld implements World {
  constructor(
    readonly surfaces: SurfaceTable,
    private readonly base = 'asphalt',
    private readonly patches: SurfacePatch[] = [],
    /** Constant ground gradient (for camber tests): h = gradX * x + gradZ * z */
    private readonly grad = { x: 0, z: 0 },
  ) {}

  query(x: number, z: number): GroundQuery {
    let name = this.base;
    for (const p of this.patches) if (x >= p.x0 && x < p.x1 && z >= p.z0 && z < p.z1) name = p.surface;
    return {
      surface: this.surfaces.byName[name]!,
      height: this.grad.x * x + this.grad.z * z,
      gradX: this.grad.x,
      gradZ: this.grad.z,
      wallDepth: 0,
      wallNx: 0,
      wallNz: 0,
    };
  }
}
