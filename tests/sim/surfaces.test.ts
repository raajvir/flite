import { describe, expect, it } from 'vitest';
import surfacesFile from '../../data/surfaces.json';
import { SIM_DT } from '../../src/sim/constants';
import { step } from '../../src/sim/step';
import { loadSurfaces, REQUIRED_SURFACES, type SurfacesFile } from '../../src/sim/surfaces';
import type { CarState, DriverInputs } from '../../src/sim/types';
import { FlatWorld, type World } from '../../src/sim/world';
import { FULL_THROTTLE, kmh, params, runUntil, start } from './helpers';

const table = loadSurfaces(surfacesFile as unknown as SurfacesFile);
const p = params('sim');

function runIn(world: World, s: CarState, inputs: DriverInputs, seconds: number, onStep?: (s: CarState) => void): CarState {
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
    s = step(s, inputs, p, SIM_DT, world);
    onStep?.(s);
  }
  return s;
}

/** Car at 100 km/h on asphalt, at the origin heading -Z. */
function cruising(): CarState {
  const [s] = runUntil(p, start(p), FULL_THROTTLE, (x) => kmh(x.u) >= 100, 20);
  return { ...s, x: 0, z: 0, distance: 0 };
}

describe('surface table', () => {
  it('has every required surface with valid numbers', () => {
    for (const name of REQUIRED_SURFACES) expect(table.byName[name]).toBeDefined();
    for (const s of table.list) expect(s.grip).toBeGreaterThanOrEqual(0);
  });
});

describe('surfaces reach the tire model', () => {
  it('the wheel records which surface it is on', () => {
    const s = runIn(new FlatWorld(table, 'gravel'), start(p), FULL_THROTTLE, 0.01);
    for (const w of s.wheels) expect(w.surface).toBe(table.byName.gravel!.id);
  });

  it('peak cornering g scales with surface grip', () => {
    const peakAy = (surface: string) => {
      let peak = 0;
      runIn(new FlatWorld(table, surface), cruising(), { steer: 1, throttle: 0.3, brake: 0 }, 1.5, (s) => {
        peak = Math.max(peak, Math.abs(s.ayFiltered));
      });
      return peak;
    };
    const asphalt = peakAy('asphalt');
    const grass = peakAy('grass');
    expect(grass).toBeLessThan(asphalt * 0.6);
  });

  it('gravel drags the car down much faster than asphalt when coasting', () => {
    const coast = { steer: 0, throttle: 0, brake: 0 };
    const a = runIn(new FlatWorld(table, 'asphalt'), cruising(), coast, 2);
    const g = runIn(new FlatWorld(table, 'gravel'), cruising(), coast, 2);
    expect(g.u).toBeLessThan(a.u - 10);
  });

  it('one side on grass under braking pulls the car towards the grass (per-wheel lookup)', () => {
    // Grass for x < -0.2 (the car's left wheels), asphalt elsewhere. Brake hard without ABS.
    const world = new FlatWorld(table, 'asphalt', [{ x0: -1e4, x1: -0.2, z0: -1e4, z1: 1e4, surface: 'grass' }]);
    const first = step(cruising(), { steer: 0, throttle: 0, brake: 0.6 }, p, SIM_DT, world);
    expect(first.wheels[0].surface).toBe(table.byName.grass!.id); // FL
    expect(first.wheels[2].surface).toBe(table.byName.grass!.id); // RL
    expect(first.wheels[1].surface).toBe(table.byName.asphalt!.id); // FR
    const s = runIn(world, first, { steer: 0, throttle: 0, brake: 0.6 }, 0.4);
    // Less braking grip on the left -> right side brakes harder -> car yaws right (negative).
    expect(s.yaw).toBeLessThan(-0.005);
  });

  it('sausage kerbs shake the wheel loads', () => {
    let minL = Infinity, maxL = 0;
    runIn(new FlatWorld(table, 'kerb_sausage'), cruising(), { steer: 0, throttle: 0.5, brake: 0 }, 0.5, (s) => {
      minL = Math.min(minL, s.wheels[0].load);
      maxL = Math.max(maxL, s.wheels[0].load);
    });
    expect(maxL / minL).toBeGreaterThan(3);
  });
});

describe('camber', () => {
  it('a car rolling straight on a road banked up to the left drifts to the right', () => {
    const tilt = Math.tan((5 * Math.PI) / 180);
    // Left of the car (heading -Z) is -X; left higher => height falls as x grows: gradX = -tilt.
    const world = new FlatWorld(table, 'asphalt', [], { x: -tilt, z: 0 });
    const s = runIn(world, cruising(), { steer: 0, throttle: 0.4, brake: 0 }, 3);
    const flat = runIn(new FlatWorld(table), cruising(), { steer: 0, throttle: 0.4, brake: 0 }, 3);
    expect(s.slopeL).toBeCloseTo(tilt, 6);
    expect(Math.abs(flat.x)).toBeLessThan(1e-6);
    expect(s.x).toBeGreaterThan(0.1); // drifted right (+X), downhill
  });
});
