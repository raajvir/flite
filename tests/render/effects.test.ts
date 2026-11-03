import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TireEffects } from '../../src/render/effects';
import { FULL_THROTTLE, kmh, params, run, runUntil, start } from '../sim/helpers';

const FRAME = 1 / 60;

describe('tire smoke and skid marks', () => {
  it('a donut lays skid marks and makes smoke', () => {
    const p = params('feel');
    const fx = new TireEffects(new THREE.Scene(), p);
    let s = start(p);
    for (let f = 0; f < 300; f++) {
      s = run(p, s, { steer: 1, throttle: 1, brake: 0 }, FRAME);
      fx.update(FRAME, s, p);
    }
    expect(fx.marksLaid).toBeGreaterThan(50);
    expect(fx.livePuffs).toBeGreaterThan(20);
  });

  it('normal driving leaves no marks and no smoke', () => {
    const p = params('feel');
    const fx = new TireEffects(new THREE.Scene(), p);
    let [s] = runUntil(p, start(p), FULL_THROTTLE, (x) => kmh(x.u) >= 120, 20);
    for (let f = 0; f < 180; f++) {
      s = run(p, s, { steer: 0.15, throttle: 0.4, brake: 0 }, FRAME);
      fx.update(FRAME, s, p);
    }
    expect(fx.marksLaid).toBe(0);
    expect(fx.livePuffs).toBe(0);
  });
});
