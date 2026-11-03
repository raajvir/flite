import { describe, expect, it } from 'vitest';
import { AIR_DENSITY, GRAVITY } from '../../src/sim/constants';
import { steerLock, wheelLoads } from '../../src/sim/step';
import { params } from './helpers';

const p = params('sim');
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe('wheel loads: weight transfer + aero', () => {
  it('at rest, loads sum to weight with the right front/rear split', () => {
    const [fl, fr, rl, rr] = wheelLoads(p, 0, 0, 0);
    expect(fl + fr + rl + rr).toBeCloseTo(p.mass * GRAVITY, 6);
    expect((fl + fr) / (p.mass * GRAVITY)).toBeCloseTo(p.weightFront, 9);
    expect(fl).toBeCloseTo(fr, 9);
  });

  it('downforce grows with speed squared', () => {
    const w = p.mass * GRAVITY;
    const d50 = sum(wheelLoads(p, 50, 0, 0)) - w;
    const d100 = sum(wheelLoads(p, 100, 0, 0)) - w;
    expect(d50).toBeCloseTo(0.5 * AIR_DENSITY * p.liftArea * 2500, 6);
    expect(d100 / d50).toBeCloseTo(4, 9);
  });

  it('braking moves load to the front, accelerating to the rear, total unchanged', () => {
    const rest = wheelLoads(p, 0, 0, 0);
    const brk = wheelLoads(p, 0, -20, 0);
    const acc = wheelLoads(p, 0, 8, 0);
    expect(brk[0] + brk[1]).toBeGreaterThan(rest[0] + rest[1]);
    expect(acc[2] + acc[3]).toBeGreaterThan(rest[2] + rest[3]);
    expect(sum(brk)).toBeCloseTo(sum(rest), 6);
  });

  it('turning left (ay > 0) loads the right-hand wheels', () => {
    const [fl, fr, rl, rr] = wheelLoads(p, 0, 0, 15);
    expect(fr).toBeGreaterThan(fl);
    expect(rr).toBeGreaterThan(rl);
  });

  it('loads never go negative', () => {
    for (const l of wheelLoads(p, 0, 0, 200)) expect(l).toBeGreaterThanOrEqual(0);
  });
});

describe('steering lock', () => {
  it('full lock at standstill, halved at the falloff speed', () => {
    expect(steerLock(p, 0)).toBe(p.maxSteerAngle);
    expect(steerLock(p, p.steerSpeedFalloff)).toBeCloseTo(p.maxSteerAngle / 2, 12);
  });
});
