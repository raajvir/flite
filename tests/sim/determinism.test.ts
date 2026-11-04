import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/sim/constants';
import { step } from '../../src/sim/step';
import type { CarState, DriverInputs } from '../../src/sim/types';
import { loadCarParams } from '../../src/sim/params';
import { CAR, params, start } from './helpers';

/** A fixed, varied input sequence (no randomness). */
function inputsAt(i: number): DriverInputs {
  const t = i * SIM_DT;
  const phase = Math.floor(t / 4) % 3;
  return { steer: Math.sin(t * 0.7) * 0.9, throttle: phase === 2 ? 0 : 1, brake: phase === 2 ? 0.8 : 0 };
}

function simulate(set: 'feel' | 'sim', steps: number): CarState[] {
  const p = params(set);
  let s = start(p);
  const trace: CarState[] = [];
  for (let i = 0; i < steps; i++) {
    s = step(s, inputsAt(i), p, SIM_DT);
    if (i % 1000 === 0) trace.push(s);
  }
  trace.push(s);
  return trace;
}

describe.each(['feel', 'sim'] as const)('determinism (%s)', (set) => {
  it('same inputs give bit-identical states (60 s at 1000 Hz)', () => {
    const a = simulate(set, 60_000);
    const b = simulate(set, 60_000);
    expect(b).toEqual(a);
    expect(a[a.length - 1]!.distance).toBeGreaterThan(300); // sanity: the car actually drove
  });

  it('step() does not mutate its input state', () => {
    const p = params(set);
    const s = start(p);
    const copy = structuredClone(s);
    step(s, { steer: 1, throttle: 1, brake: 0 }, p, SIM_DT);
    expect(s).toEqual(copy);
  });
});

describe('parameter sets', () => {
  it('feel inherits everything from sim and only overrides what it lists', () => {
    const sim = params('sim');
    const feel = params('feel');
    expect(feel.mass).toBe(sim.mass); // inherited
    expect(feel.tireShapeC).toBeLessThan(sim.tireShapeC); // overridden: gentler tire peak
    expect(feel.stabilityAssist).toBeGreaterThan(sim.stabilityAssist); // overridden: more yaw damping
  });
});

describe('parameter overrides (tuning panel)', () => {
  it('override replaces the value and derived values are recomputed', () => {
    const base = params('feel');
    const p = loadCarParams(CAR, 'feel', { weightFront: 0.5, tireShapeC: 1.6, brakeBiasFront: 0.62 });
    expect(p.brakeBiasFront).toBe(0.62);
    expect(p.derived.a).toBeCloseTo(p.wheelbase * 0.5, 12);
    expect(p.derived.tire.B).not.toBe(base.derived.tire.B);
  });

  it('rejects unknown or non-finite overrides', () => {
    expect(() => loadCarParams(CAR, 'feel', { nope: 1 } as never)).toThrow(/Unknown/);
    expect(() => loadCarParams(CAR, 'feel', { mass: Number.NaN })).toThrow(/finite/);
  });
});
