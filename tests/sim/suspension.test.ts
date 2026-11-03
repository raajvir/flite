import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/sim/constants';
import { suspensionStep } from '../../src/sim/step';
import { FULL_BRAKE, FULL_THROTTLE, kmh, params, run, runUntil, start } from './helpers';

const p = params('sim');

describe('suspension body motion', () => {
  it('settles to the steady angle for a constant acceleration, with a small overshoot', () => {
    let s = { pitch: 0, pitchRate: 0, roll: 0, rollRate: 0 };
    let peak = 0;
    for (let i = 0; i < 3000; i++) {
      s = suspensionStep(p, s, -20, 15, SIM_DT);
      peak = Math.max(peak, s.pitch);
    }
    expect(s.pitch).toBeCloseTo(p.bodyPitchGradient * 20, 6);
    expect(s.roll).toBeCloseTo(p.bodyRollGradient * 15, 6);
    expect(peak).toBeGreaterThan(s.pitch * 1.05); // underdamped: visible overshoot
    expect(peak).toBeLessThan(s.pitch * 1.4);
  });

  it('nose dives under braking and squats under acceleration', () => {
    const accel = run(p, start(p), FULL_THROTTLE, 1.0);
    expect(accel.pitch).toBeLessThan(0);
    const [fast] = runUntil(p, start(p), FULL_THROTTLE, (s) => kmh(s.u) >= 200, 20);
    const braking = run(p, fast, FULL_BRAKE, 0.5);
    expect(braking.pitch).toBeGreaterThan(0.01);
  });

  it('body leans to the outside of a left turn (right side down)', () => {
    const [fast] = runUntil(p, start(p), FULL_THROTTLE, (s) => kmh(s.u) >= 120, 20);
    const s = run(p, fast, { steer: 0.8, throttle: 0.4, brake: 0 }, 1.5);
    expect(s.roll).toBeGreaterThan(0.01);
  });
});
