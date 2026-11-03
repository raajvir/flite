import { describe, expect, it } from 'vitest';
import carFile from '../../data/cars/box.json';
import { SIM_DT } from '../../src/sim/constants';
import { loadCarParams, type CarFile } from '../../src/sim/params';
import { step } from '../../src/sim/step';
import { initialState, type CarState, type DriverInputs } from '../../src/sim/types';

/** A fixed, varied input sequence (no randomness). */
function inputsAt(i: number): DriverInputs {
  const t = i * SIM_DT;
  return {
    steer: Math.sin(t * 0.7) * 0.9,
    throttle: (Math.floor(t / 4) % 3) === 2 ? 0 : 1,
    brake: (Math.floor(t / 4) % 3) === 2 ? 0.8 : 0,
  };
}

function simulate(steps: number): CarState[] {
  const p = loadCarParams(carFile as CarFile, 'feel');
  let s = initialState({ x: 0, y: 0, z: 0, yaw: 0 });
  const trace: CarState[] = [];
  for (let i = 0; i < steps; i++) {
    s = step(s, inputsAt(i), p, SIM_DT);
    if (i % 1000 === 0) trace.push(s);
  }
  trace.push(s);
  return trace;
}

describe('determinism', () => {
  it('same inputs give bit-identical states (60 s at 1000 Hz)', () => {
    const a = simulate(60_000);
    const b = simulate(60_000);
    expect(b).toEqual(a);
    // Sanity: the car actually did something.
    expect(a[a.length - 1]!.distance).toBeGreaterThan(500);
  });

  it('step() does not mutate its input state', () => {
    const p = loadCarParams(carFile as CarFile, 'feel');
    const s = initialState({ x: 1, y: 0, z: 2, yaw: 0.3 });
    const copy = { ...s };
    step(s, { steer: 1, throttle: 1, brake: 0 }, p, SIM_DT);
    expect(s).toEqual(copy);
  });
});
