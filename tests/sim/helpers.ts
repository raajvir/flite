import carFile from '../../data/cars/openwheel.json';
import { SIM_DT } from '../../src/sim/constants';
import { loadCarParams, type CarFile, type CarParams, type ParamSetName } from '../../src/sim/params';
import { step } from '../../src/sim/step';
import { initialState, type CarState, type DriverInputs } from '../../src/sim/types';

export const CAR = carFile as unknown as CarFile;
export const params = (set: ParamSetName = 'sim'): CarParams => loadCarParams(CAR, set);
export const start = (p: CarParams): CarState => initialState({ x: 0, y: 0, z: 0, yaw: 0 }, p.idleRpm);

export type InputFn = (s: CarState, t: number) => DriverInputs;

export function run(
  p: CarParams,
  s: CarState,
  inputs: DriverInputs | InputFn,
  seconds: number,
  onStep?: (s: CarState) => void,
): CarState {
  const n = Math.round(seconds / SIM_DT);
  for (let i = 0; i < n; i++) {
    const inp = typeof inputs === 'function' ? inputs(s, i * SIM_DT) : inputs;
    s = step(s, inp, p, SIM_DT);
    onStep?.(s);
  }
  return s;
}

/** Run until predicate is true or timeout; returns [state, elapsed seconds]. */
export function runUntil(
  p: CarParams,
  s: CarState,
  inputs: DriverInputs | InputFn,
  pred: (s: CarState) => boolean,
  timeout: number,
): [CarState, number] {
  let t = 0;
  while (!pred(s) && t < timeout) {
    const inp = typeof inputs === 'function' ? inputs(s, t) : inputs;
    s = step(s, inp, p, SIM_DT);
    t += SIM_DT;
  }
  return [s, t];
}

export const kmh = (mps: number) => mps * 3.6;
export const FULL_THROTTLE: DriverInputs = { steer: 0, throttle: 1, brake: 0 };
export const COAST: DriverInputs = { steer: 0, throttle: 0, brake: 0 };
export const FULL_BRAKE: DriverInputs = { steer: 0, throttle: 0, brake: 1 };

export function isFiniteState(s: CarState): boolean {
  const nums = [s.x, s.z, s.yaw, s.u, s.v, s.yawRate, s.rpm, ...s.wheels.flatMap((w) => [w.omega, w.kappa, w.tanAlpha])];
  return nums.every(Number.isFinite);
}
