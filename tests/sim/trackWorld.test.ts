import { describe, expect, it } from 'vitest';
import surfacesFile from '../../data/surfaces.json';
import { SIM_DT } from '../../src/sim/constants';
import { step } from '../../src/sim/step';
import { loadSurfaces, type SurfacesFile } from '../../src/sim/surfaces';
import { TrackWorld, type SurfaceLayout, type TrackData } from '../../src/sim/trackWorld';
import { initialState } from '../../src/sim/types';
import { params } from './helpers';

const table = loadSurfaces(surfacesFile as unknown as SurfacesFile);

/** A 1 km circle, radius ~159 m, driven anticlockwise (turning left), 12 m wide. */
function circleTrack(bankDeg = 0): TrackData {
  const n = 500, R = 1000 / (2 * Math.PI);
  const points: number[][] = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * 2 * Math.PI;
    // Start at (R, 0) heading -Z, turning left (towards -X): centre at origin.
    const x = R * Math.cos(th), z = -R * Math.sin(th);
    const heading = th; // forward (-sin h, -cos h) = (-sin th, -cos th) = tangent
    points.push([x, z, heading, 1 / R, 6, 6, (bankDeg * Math.PI) / 180, 0, 0]);
  }
  return { name: 'circle', length_m: 1000, ds_m: 2, columns: ['x', 'z', 'heading', 'kappa', 'w_left', 'w_right', 'bank', 'elev', 'race_d'], points };
}

const layout: SurfaceLayout = {
  edgeLine: { width: 0.2, surface: 'paint' },
  verge: 'grass',
  wallGap: 3,
  wallMin: 10,
  bands: [
    { s_start: 100, s_end: 200, side: 'left', offset: 0, width: 1.5, surface: 'kerb_flat' },
    { s_start: 950, s_end: 50, side: 'right', offset: 0, width: 20, surface: 'gravel' }, // wraps the lap seam
  ],
};

describe('track world', () => {
  const w = new TrackWorld(circleTrack(), layout, table);

  it('projects a point back to its track coordinates', () => {
    for (const [s, d] of [[0, 0], [123, 3], [500, -4.5], [990, 2]] as const) {
      const pt = w.point(s, d);
      const pr = w.project(pt.x, pt.z);
      expect(pr.s).toBeCloseTo(s, 0);
      expect(pr.d).toBeCloseTo(d, 1);
    }
  });

  it('finds surfaces from bands, edge lines, verge and walls', () => {
    expect(w.surfaceAt(300, 0).name).toBe('asphalt');
    expect(w.surfaceAt(300, 5.9).name).toBe('paint');
    expect(w.surfaceAt(150, 6.5).name).toBe('kerb_flat');
    expect(w.surfaceAt(300, 6.5).name).toBe('grass');
    expect(w.surfaceAt(10, -10).name).toBe('gravel'); // band across the lap seam
    expect(w.surfaceAt(300, 6 + 25).name).toBe('wall');
  });

  it('walls sit beyond the outermost band', () => {
    expect(w.wallAt(0, false)).toBeGreaterThanOrEqual(20 + layout.wallGap - 0.01);
    expect(w.wallAt(500, true)).toBeCloseTo(layout.wallMin, 1);
  });

  it('banking raises the left edge', () => {
    const banked = new TrackWorld(circleTrack(5), layout, table);
    expect(banked.heightAt(300, 5).h).toBeGreaterThan(0.3);
    expect(banked.heightAt(300, -5).h).toBeLessThan(-0.3);
    expect(banked.heightAt(300, 40).h).toBe(0); // verge blends back to flat
  });

  it('a car driven straight at the wall is stopped by it', () => {
    const p = params('sim');
    // Start on the centreline, aimed at the outside (right) wall at 25 m/s.
    const pos = w.point(300, 0);
    let s = { ...initialState({ x: pos.x, y: 0, z: pos.z, yaw: w.headingAt(300) - Math.PI / 2 }, p.idleRpm), u: 25 };
    let maxDepth = 0;
    for (let i = 0; i < 4000; i++) {
      s = step(s, { steer: 0, throttle: 0, brake: 0 }, p, SIM_DT, w);
      const pr = w.project(s.x, s.z);
      maxDepth = Math.max(maxDepth, -pr.d - 6 - w.wallAt(pr.s, false));
    }
    expect(maxDepth).toBeLessThan(1.5); // CG never far past the wall line (wheels hit first)
    expect(Math.abs(s.u)).toBeLessThan(5);
  });
});
