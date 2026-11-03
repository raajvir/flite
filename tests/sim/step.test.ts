import { describe, expect, it } from 'vitest';
import carFile from '../../data/cars/box.json';
import { SIM_DT } from '../../src/sim/constants';
import { loadCarParams, type CarFile } from '../../src/sim/params';
import { step } from '../../src/sim/step';
import { initialState, type CarState, type DriverInputs } from '../../src/sim/types';

const params = loadCarParams(carFile as CarFile, 'feel');
const start = () => initialState({ x: 0, y: 0, z: 0, yaw: 0 });

function run(s: CarState, inputs: DriverInputs, seconds: number): CarState {
  const n = Math.round(seconds / SIM_DT);
  for (let i = 0; i < n; i++) s = step(s, inputs, params, SIM_DT);
  return s;
}

describe('M1 kinematic step', () => {
  it('stays put with no inputs', () => {
    const s = run(start(), { steer: 0, throttle: 0, brake: 0 }, 2);
    expect(s.u).toBe(0);
    expect(s.x).toBe(0);
    expect(s.z).toBe(0);
  });

  it('throttle accelerates forwards (towards -Z at yaw 0)', () => {
    const s = run(start(), { steer: 0, throttle: 1, brake: 0 }, 3);
    expect(s.u).toBeGreaterThan(20);
    expect(s.z).toBeLessThan(-20);
    expect(Math.abs(s.x)).toBeLessThan(1e-9);
  });

  it('reaches a finite top speed set by drag', () => {
    const s = run(start(), { steer: 0, throttle: 1, brake: 0 }, 120);
    const fric = params.rollingResistanceCoefficient * params.mass * 9.81;
    const vTop = Math.sqrt((params.engineForce - fric) / params.dragCoefficient);
    expect(s.u).toBeCloseTo(vTop, 0);
  });

  it('brakes to a stop without going backwards', () => {
    let s = run(start(), { steer: 0, throttle: 1, brake: 0 }, 3);
    // Brake while still moving fast; stop well before reverse could engage.
    s = run(s, { steer: 0, throttle: 0, brake: 1 }, 1);
    expect(s.u).toBeGreaterThanOrEqual(0);
  });

  it('holding brake when stopped reverses, capped at maxReverseSpeed', () => {
    const s = run(start(), { steer: 0, throttle: 0, brake: 1 }, 20);
    expect(s.u).toBeCloseTo(-params.maxReverseSpeed, 6);
    expect(s.z).toBeGreaterThan(0);
  });

  it('positive steer turns left (positive yaw, moves towards -X)', () => {
    const s = run(start(), { steer: 1, throttle: 0.5, brake: 0 }, 2);
    expect(s.yaw).toBeGreaterThan(0);
    expect(s.x).toBeLessThan(0);
  });

  it('steering angle is rate limited', () => {
    const s = step(start(), { steer: 1, throttle: 0, brake: 0 }, params, SIM_DT);
    expect(s.steerAngle).toBeCloseTo(params.steerRate * SIM_DT, 12);
  });

  it('lateral acceleration never exceeds the cap', () => {
    const s = run(start(), { steer: 0, throttle: 1, brake: 0 }, 5);
    const t = run(s, { steer: 1, throttle: 1, brake: 0 }, 1);
    expect(Math.abs(t.u * t.yawRate)).toBeLessThanOrEqual(params.maxLateralAcceleration + 1e-9);
  });

  it('both parameter sets load', () => {
    expect(() => loadCarParams(carFile as CarFile, 'sim')).not.toThrow();
  });

  it('rejects a car file with a missing parameter', () => {
    const broken = JSON.parse(JSON.stringify(carFile)) as CarFile;
    delete (broken.sets.feel as Record<string, unknown>).mass;
    expect(() => loadCarParams(broken, 'feel')).toThrow(/mass/);
  });
});
