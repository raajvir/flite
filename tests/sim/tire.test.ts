import { describe, expect, it } from 'vitest';
import { loadFactor, shape, solveShapeB, tireForce, type TireParams } from '../../src/sim/tire';
import { params } from './helpers';

const tp: TireParams = params('sim').derived.tire;
const Fz = tp.nominalLoad;

describe('tire: magic formula shape', () => {
  it.each([
    [1.25, 0.5],
    [1.45, 0.2],
    [1.7, -0.5],
  ])('C=%s E=%s peaks at exactly rho = 1', (C, E) => {
    const B = solveShapeB(C, E);
    expect(shape(1, B, C, E)).toBeCloseTo(1, 9);
    expect(shape(0.98, B, C, E)).toBeLessThan(1);
    expect(shape(1.02, B, C, E)).toBeLessThan(1);
  });

  it('rejects invalid shape factors', () => {
    expect(() => solveShapeB(2.5, 0)).toThrow();
    expect(() => solveShapeB(1.4, 1.2)).toThrow();
  });

  it('gentler C keeps more grip when sliding (feel vs sim)', () => {
    const feel = params('feel').derived.tire;
    const slide = 4; // 4x past the peak slip
    expect(shape(slide, feel.B, feel.C, feel.E)).toBeGreaterThan(shape(slide, tp.B, tp.C, tp.E));
  });
});

describe('tire: forces', () => {
  it('no slip, no force', () => {
    const f = tireForce(0, 0, Fz, tp, 1);
    expect(f.fx).toBe(0);
    expect(f.fy).toBe(-0);
  });

  it('pure longitudinal peak = muX * Fz', () => {
    expect(tireForce(tp.peakSlipRatio, 0, Fz, tp, 1).fx).toBeCloseTo(tp.muX * Fz, 6);
    expect(tireForce(-tp.peakSlipRatio, 0, Fz, tp, 1).fx).toBeCloseTo(-tp.muX * Fz, 6);
  });

  it('pure lateral peak = muY * Fz, and opposes sliding', () => {
    const f = tireForce(0, tp.tanPeakSlipAngle, Fz, tp, 1);
    expect(f.fy).toBeCloseTo(-tp.muY * Fz, 6);
  });

  it('combined slip: braking reduces lateral force (friction ellipse)', () => {
    const lateralOnly = Math.abs(tireForce(0, tp.tanPeakSlipAngle * 0.7, Fz, tp, 1).fy);
    const combined = Math.abs(tireForce(-tp.peakSlipRatio * 0.7, tp.tanPeakSlipAngle * 0.7, Fz, tp, 1).fy);
    expect(combined).toBeLessThan(lateralOnly * 0.85);
  });

  it('combined force never exceeds the friction ellipse', () => {
    for (let k = -1; k <= 1; k += 0.05) {
      for (let a = -1; a <= 1; a += 0.05) {
        const f = tireForce(k, a, Fz, tp, 1);
        const e = (f.fx / (tp.muX * Fz)) ** 2 + (f.fy / (tp.muY * Fz)) ** 2;
        expect(e).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('grip multiplier scales force linearly', () => {
    const a = tireForce(0.05, 0.03, Fz, tp, 1);
    const b = tireForce(0.05, 0.03, Fz, tp, 0.5);
    expect(b.fx).toBeCloseTo(a.fx * 0.5, 9);
    expect(b.fy).toBeCloseTo(a.fy * 0.5, 9);
  });

  it('load sensitivity: doubling load gives less than double peak force', () => {
    expect(loadFactor(2 * Fz, tp)).toBeLessThan(1);
    const f1 = tireForce(tp.peakSlipRatio, 0, Fz, tp, 1).fx;
    const f2 = tireForce(tp.peakSlipRatio, 0, 2 * Fz, tp, 1).fx;
    expect(f2).toBeGreaterThan(f1);
    expect(f2).toBeLessThan(2 * f1);
  });

  it('unloaded tire makes no force', () => {
    expect(tireForce(0.1, 0.1, 0, tp, 1)).toEqual({ fx: 0, fy: 0 });
  });
});
