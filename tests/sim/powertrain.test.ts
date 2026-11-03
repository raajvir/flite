import { describe, expect, it } from 'vitest';
import { chooseGear, engineTorque, engineTorqueAt, splitDiff, totalRatio, wheelRpm } from '../../src/sim/powertrain';
import { params } from './helpers';

const p = params('sim');

describe('engine', () => {
  it('interpolates the torque curve and clamps at the ends', () => {
    const c: [number, number][] = [[1000, 100], [2000, 200]];
    expect(engineTorqueAt(c, 1500)).toBe(150);
    expect(engineTorqueAt(c, 500)).toBe(100);
    expect(engineTorqueAt(c, 3000)).toBe(200);
  });

  it('closed throttle gives engine braking above idle, none at idle', () => {
    expect(engineTorque(p, 0, p.revLimitRpm - 1)).toBeLessThan(0);
    expect(engineTorque(p, 0, p.idleRpm)).toBeCloseTo(0, 9);
  });

  it('rev limiter cuts drive torque', () => {
    expect(engineTorque(p, 1, p.revLimitRpm)).toBeLessThanOrEqual(0);
    expect(engineTorque(p, 1, p.revLimitRpm - 100)).toBeGreaterThan(0);
  });

  it('rpm follows wheel speed through the gear ratio', () => {
    const omega = 50;
    const rpm = wheelRpm(p, 3, omega);
    expect(rpm).toBeCloseTo((omega * totalRatio(p, 3) * 60) / (2 * Math.PI), 9);
    expect(wheelRpm(p, -1, -omega)).toBeGreaterThan(0); // reverse: rpm positive going backwards
  });
});

describe('gearbox (automatic)', () => {
  it('upshifts on throttle above upshiftRpm, then waits for the shift to finish', () => {
    const d = chooseGear(p, 3, 0, 40, p.upshiftRpm + 1, 1, 0);
    expect(d).toEqual({ gear: 4, shiftTimer: p.shiftTime });
    expect(chooseGear(p, 4, 0.01, 40, p.upshiftRpm + 1, 1, 0).gear).toBe(4);
  });

  it('does not upshift past top gear', () => {
    const top = p.gearRatios.length;
    expect(chooseGear(p, top, 0, 90, p.upshiftRpm + 500, 1, 0).gear).toBe(top);
  });

  it('downshifts below downshiftRpm but not below 1st', () => {
    expect(chooseGear(p, 5, 0, 30, p.downshiftRpm - 1, 0, 1).gear).toBe(4);
    expect(chooseGear(p, 1, 0, 1, 0, 0, 0).gear).toBe(1);
  });

  it('upshift and downshift points do not hunt (hysteresis)', () => {
    for (let g = 1; g < p.gearRatios.length; g++) {
      const after = (p.upshiftRpm * p.gearRatios[g]!) / p.gearRatios[g - 1]!;
      expect(after).toBeGreaterThan(p.downshiftRpm);
    }
  });

  it('brake at standstill selects reverse; throttle at standstill selects 1st', () => {
    expect(chooseGear(p, 1, 0, 0, 0, 0, 1).gear).toBe(-1);
    expect(chooseGear(p, -1, 0, 0, 0, 1, 0).gear).toBe(1);
    expect(chooseGear(p, 2, 0, 20, 9000, 0, 1).gear).toBe(2); // moving: brake is just a brake
  });
});

describe('limited-slip differential', () => {
  it('splits evenly when wheels match', () => {
    expect(splitDiff(p, 1000, 50, 50)).toEqual([500, 500]);
  });
  it('moves torque to the slower wheel, capped', () => {
    const [l, r] = splitDiff(p, 1000, 60, 50);
    expect(r).toBeGreaterThan(l);
    expect(l + r).toBeCloseTo(1000, 9);
    const [l2] = splitDiff(p, 1000, 1000, 0);
    expect(l2).toBeCloseTo(500 - p.diffMaxLockTorque, 9);
  });
});
