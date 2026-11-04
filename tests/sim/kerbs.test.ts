import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/sim/constants';
import { step } from '../../src/sim/step';
import { surfaceTable } from '../../src/sim/tracks';
import { TrackWorld, type SurfaceLayout, type TrackData } from '../../src/sim/trackWorld';
import { initialState, type CarState } from '../../src/sim/types';
import { params } from './helpers';

const table = surfaceTable();
const p = params('sim');

/** A 2 km circle driven anticlockwise (left-hander), 12 m wide. */
function circle(): TrackData {
  const n = 1000, R = 2000 / (2 * Math.PI);
  const points: number[][] = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * 2 * Math.PI;
    points.push([R * Math.cos(th), -R * Math.sin(th), th, 1 / R, 6, 6, 0, 0, 0]);
  }
  return { name: 'circle', length_m: 2000, ds_m: 2, columns: ['x', 'z', 'heading', 'kappa', 'w_left', 'w_right', 'bank', 'elev', 'race_d'], points };
}

const world = (bands: SurfaceLayout['bands']) =>
  new TrackWorld(circle(), { edgeLine: { width: 0.2, surface: 'paint' }, verge: 'grass', wallGap: 4, wallMin: 14, bands }, table);

const kerb = (surface: string, width: number) => [{ s_start: 100, s_end: 600, side: 'left' as const, offset: 0, width, surface }];

/** Car at track position (s, d), pointing along the track at speed u. */
function carAt(w: TrackWorld, s: number, d: number, u: number): CarState {
  const pt = w.point(s, d);
  return { ...initialState({ x: pt.x, y: 0, z: pt.z, yaw: w.headingAt(s) }, p.idleRpm), u };
}

describe('kerb profiles', () => {
  it('flat kerbs ramp up outwards, sausages are humps, both taper at the ends', () => {
    const flat = world(kerb('kerb_flat', 1.5));
    expect(flat.surfaceInfo(300, 6 + 0.1).kerb).toBeLessThan(0.01);
    expect(flat.surfaceInfo(300, 6 + 1.2).kerb).toBeCloseTo(0.05 * (1.2 / 1.5) / 0.85, 4);
    expect(flat.surfaceInfo(300, 6 + 1.49).kerb).toBeLessThan(0.01); // rounded outer edge
    expect(flat.surfaceInfo(300, 6 + 1.0).kerbDhdd).toBeGreaterThan(0); // rises away from the track (left side)
    expect(flat.surfaceInfo(101, 6 + 1.4).kerb).toBeLessThan(0.03); // tapering in
    const sausage = world(kerb('kerb_sausage', 0.5));
    expect(sausage.surfaceInfo(300, 6 + 0.25).kerb).toBeCloseTo(0.12, 3);
  });
});

describe('kerbs push and unsettle the car', () => {
  it('an angled kerb pushes the wheels on it back towards the track', () => {
    // First step, before the tires have built any side force: the only side force is the kerb's.
    const firstStepV = (bands: SurfaceLayout['bands']) => {
      const w = world(bands);
      return step(carAt(w, 300, 6.4, 25), { steer: 0, throttle: 0, brake: 0 }, p, SIM_DT, w).v;
    };
    expect(firstStepV(kerb('kerb_flat', 1.5))).toBeLessThan(-1e-4); // pushed right = onto the road
    expect(Math.abs(firstStepV(kerb('runoff', 1.5)))).toBeLessThan(1e-6); // a flat strip doesn't push
  });

  it('hitting a sausage kerb throws the wheel loads around far more than a flat kerb', () => {
    const swing = (surface: string) => {
      const w = world(kerb(surface, 0.5));
      // Left wheels just inside the edge, car angled 8 degrees towards the kerb at 30 m/s.
      const start = carAt(w, 300, 6 - p.trackFront / 2 - 0.3, 30);
      let s = { ...start, yaw: start.yaw + 0.14 };
      let worst = 0;
      for (let i = 0; i < 150; i++) {
        s = step(s, { steer: 0, throttle: 0, brake: 0 }, p, SIM_DT, w);
        const loads = s.wheels.map((wh) => wh.load);
        worst = Math.max(worst, Math.max(...loads) - Math.min(...loads));
      }
      return worst;
    };
    const sausage = swing('kerb_sausage');
    const flat = swing('kerb_flat');
    expect(sausage).toBeGreaterThan(flat * 1.5);
    expect(sausage).toBeGreaterThan(4000); // N between the most- and least-loaded wheel
  });
});
