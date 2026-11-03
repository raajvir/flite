import { describe, expect, it } from 'vitest';
import { slideIntensity } from '../../src/render/slide';
import { FULL_THROTTLE, kmh, params, run, runUntil, start } from '../sim/helpers';

describe('slide detection (drives smoke, skid marks, skid sound)', () => {
  it('no slide when cruising straight', () => {
    const p = params('feel');
    const [s] = runUntil(p, start(p), FULL_THROTTLE, (s) => kmh(s.u) >= 150, 20);
    const cruise = run(p, s, { steer: 0, throttle: 0.3, brake: 0 }, 1);
    for (let i = 0; i < 4; i++) expect(slideIntensity(cruise, i, p)).toBe(0);
  });

  it('rear tires slide during a donut', () => {
    const p = params('feel');
    const s = run(p, start(p), { steer: 1, throttle: 1, brake: 0 }, 4);
    expect(Math.max(slideIntensity(s, 2, p), slideIntensity(s, 3, p))).toBeGreaterThan(0.3);
  });

  it('locked wheels slide under hard braking without ABS (sim)', () => {
    const p = params('sim');
    const [s] = runUntil(p, start(p), FULL_THROTTLE, (s) => kmh(s.u) >= 100, 20);
    const b = run(p, s, { steer: 0, throttle: 0, brake: 1 }, 0.5);
    expect(Math.max(...[0, 1, 2, 3].map((i) => slideIntensity(b, i, p)))).toBeGreaterThan(0.3);
  });
});
