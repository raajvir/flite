import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/sim/constants';
import { draftEffects } from '../../src/sim/draft';
import { step } from '../../src/sim/step';
import { initialState } from '../../src/sim/types';
import { params } from './helpers';

const p = params('sim');
const car = (x: number, z: number, yaw = 0) => initialState({ x, y: 0, z, yaw });

describe('drafting', () => {
  it('tucked in behind a car: less drag and less downforce', () => {
    // Both face -Z; the follower is 10 m behind (+Z).
    const [leader, follower] = draftEffects([car(0, 0), car(0, 10)], [p, p]);
    expect(leader!.strength).toBe(0);
    expect(follower!.strength).toBeGreaterThan(0.6);
    expect(follower!.dragScale).toBeLessThan(0.8);
    expect(follower!.liftScale).toBeLessThan(0.9);
  });

  it('fades with distance and lateral offset; nothing beside or far behind', () => {
    const near = draftEffects([car(0, 0), car(0, 10)], [p, p])[1]!.strength;
    const far = draftEffects([car(0, 0), car(0, 35)], [p, p])[1]!.strength;
    const offset = draftEffects([car(0, 0), car(1.2, 10)], [p, p])[1]!.strength;
    expect(far).toBeLessThan(near);
    expect(offset).toBeLessThan(near);
    expect(draftEffects([car(0, 0), car(3, 0)], [p, p])[1]!.strength).toBe(0); // alongside
    expect(draftEffects([car(0, 0), car(0, 60)], [p, p])[1]!.strength).toBe(0); // too far
    expect(draftEffects([car(0, 0), car(5, 10)], [p, p])[1]!.strength).toBe(0); // out of the wake
  });

  it('a car in the slipstream reaches a higher top speed', () => {
    const top = (dragScale: number) => {
      let s = { ...car(0, 0), u: 80 };
      for (let i = 0; i < 40_000; i++) s = step(s, { steer: 0, throttle: 1, brake: 0 }, p, SIM_DT, undefined, { fx: 0, fy: 0, mz: 0, dragScale });
      return s.u;
    };
    expect(top(0.7)).toBeGreaterThan(top(1) + 3);
  });
});
