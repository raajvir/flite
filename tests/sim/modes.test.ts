import { describe, expect, it } from 'vitest';
import { GRAVITY } from '../../src/sim/constants';
import { loadCarParams, PARAM_SETS } from '../../src/sim/params';
import { engineTorque } from '../../src/sim/powertrain';
import { CAR, FULL_THROTTLE, kmh, params, run, runUntil, start } from './helpers';

describe('drive mode parameter sets', () => {
  it('every set loads', () => {
    for (const set of PARAM_SETS) expect(() => loadCarParams(CAR, set)).not.toThrow();
  });

  it('power multiplier scales the engine', () => {
    const p = params('feel');
    const strong = loadCarParams(CAR, 'feel', { powerScale: 1.5 });
    expect(engineTorque(strong, 1, 10000)).toBeCloseTo(engineTorque(p, 1, 10000) * 1.5, 6);
  });

  const zeroTo100 = (set: 'feel' | 'arcade') => {
    const p = params(set);
    return runUntil(p, start(p), FULL_THROTTLE, (s) => kmh(s.u) >= 100, 10)[1];
  };
  const peakLatG = (set: 'feel' | 'arcade') => {
    const p = params(set);
    const [fast] = runUntil(p, start(p), FULL_THROTTLE, (s) => kmh(s.u) >= 150, 20);
    let peak = 0;
    run(p, fast, (s) => ({ steer: 1, throttle: s.u < 150 / 3.6 ? 1 : 0, brake: 0 }), 3, (s) => (peak = Math.max(peak, Math.abs(s.ayFiltered))));
    return peak / GRAVITY;
  };

  it('arcade accelerates harder and corners harder than the default', () => {
    expect(zeroTo100('arcade')).toBeLessThan(zeroTo100('feel'));
    expect(peakLatG('arcade')).toBeGreaterThan(peakLatG('feel') + 0.3);
  });

  it('arcade recovers from a big flick at speed', () => {
    const p = params('arcade');
    const [fast] = runUntil(p, start(p), FULL_THROTTLE, (s) => kmh(s.u) >= 150, 20);
    const s = run(p, fast, (_s, t) => ({ steer: t < 0.5 ? 1 : t < 1.0 ? -1 : 0, throttle: 1, brake: 0 }), 4);
    expect(Math.abs(Math.atan2(s.v, Math.abs(s.u)))).toBeLessThan(0.1);
  });
});
