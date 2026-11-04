import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/sim/constants';
import { step } from '../../src/sim/step';
import { initialState, type CarState } from '../../src/sim/types';
import { kmh, params } from './helpers';

const p = params('feel');
const full = (): CarState => initialState({ x: 0, y: 0, z: 0, yaw: 0 }, p.idleRpm, p.ersCapacity);
const run = (s: CarState, boost: number, seconds: number, brake = 0) => {
  for (let i = 0; i < seconds / SIM_DT; i++) s = step(s, { steer: 0, throttle: brake ? 0 : 1, brake, boost }, p, SIM_DT);
  return s;
};

describe('ERS boost', () => {
  it('accelerates the car harder while it lasts', () => {
    const plain = run(full(), 0, 8);
    const boosted = run(full(), 1, 8);
    expect(kmh(boosted.u)).toBeGreaterThan(kmh(plain.u) + 8);
  });

  it('drains the battery while boosting and stops when empty', () => {
    const s = run(full(), 1, 30);
    expect(s.battery).toBe(0);
    expect(s.ersDeploy).toBe(0);
    const noBoost = run(full(), 0, 5);
    expect(noBoost.battery).toBe(p.ersCapacity);
  });

  it('recharges under braking', () => {
    const empty = { ...run(full(), 1, 30) };
    const braked = run(empty, 0, 1.5, 1);
    expect(braked.battery).toBeGreaterThan(0);
  });
});
