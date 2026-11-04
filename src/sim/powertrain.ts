/** Engine, gearbox and differential helpers (pure). */
import { RPM_TO_RADPS } from './constants';
import type { CarParams } from './params';

/** Engine torque at full throttle, linear interpolation, clamped to the curve ends. */
export function engineTorqueAt(curve: readonly [number, number][], rpm: number): number {
  const first = curve[0]!;
  const last = curve[curve.length - 1]!;
  if (rpm <= first[0]) return first[1];
  if (rpm >= last[0]) return last[1];
  for (let i = 1; i < curve.length; i++) {
    const [r1, t1] = curve[i]!;
    if (rpm <= r1) {
      const [r0, t0] = curve[i - 1]!;
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
  }
  return last[1];
}

/** Overall ratio engine:wheel for a gear (negative in reverse so rpm stays positive going backwards). */
export function totalRatio(p: CarParams, gear: number): number {
  if (gear > 0) return (p.gearRatios[gear - 1] ?? 0) * p.finalDrive;
  if (gear < 0) return -p.reverseRatio * p.finalDrive;
  return 0;
}

/** Engine rpm implied by the driven-wheel speed (rad/s). Clutch slips below idle. */
export function wheelRpm(p: CarParams, gear: number, drivenOmega: number): number {
  return (drivenOmega * totalRatio(p, gear)) / RPM_TO_RADPS;
}

/** Engine torque (N*m at the crank) for a pedal position and rpm, incl. engine braking and the limiter. */
export function engineTorque(p: CarParams, pedal: number, rpm: number): number {
  const drive = pedal * engineTorqueAt(p.engineTorqueCurve, rpm) * p.powerScale;
  const brakeFrac = Math.min(1, Math.max(0, (rpm - p.idleRpm) / (p.revLimitRpm - p.idleRpm)));
  const engineBraking = (1 - pedal) * p.engineBrakeTorque * brakeFrac;
  let t = drive - engineBraking;
  if (rpm >= p.revLimitRpm) t = Math.min(t, 0); // limiter: fuel cut
  return t;
}

export interface GearDecision {
  gear: number;
  shiftTimer: number;
}

/**
 * Automatic gearbox.
 * - Brake held, no throttle, nearly stopped -> reverse.
 * - In reverse, throttle (with no brake) and nearly stopped -> 1st.
 * - Forward: up at upshiftRpm (only on throttle), down at downshiftRpm.
 */
export function chooseGear(
  p: CarParams,
  gear: number,
  shiftTimer: number,
  u: number,
  rpmFromWheels: number,
  throttle: number,
  brake: number,
): GearDecision {
  const nearlyStopped = Math.abs(u) < p.reverseEngageSpeed;
  if (gear > 0 && nearlyStopped && brake > 0 && throttle === 0) return { gear: -1, shiftTimer: p.shiftTime };
  if (gear < 0) {
    if (nearlyStopped && throttle > 0 && brake === 0) return { gear: 1, shiftTimer: p.shiftTime };
    return { gear, shiftTimer };
  }
  if (gear === 0) return { gear: 1, shiftTimer: p.shiftTime };
  if (shiftTimer > 0) return { gear, shiftTimer };
  if (rpmFromWheels > p.upshiftRpm && gear < p.gearRatios.length && throttle > 0) {
    return { gear: gear + 1, shiftTimer: p.shiftTime };
  }
  if (rpmFromWheels < p.downshiftRpm && gear > 1) return { gear: gear - 1, shiftTimer: p.shiftTime };
  return { gear, shiftTimer };
}

/**
 * Limited-slip differential: split axle torque evenly, then move torque from the
 * faster wheel to the slower one in proportion to their speed difference.
 * Returns [left, right] torque.
 */
export function splitDiff(p: CarParams, axleTorque: number, omegaL: number, omegaR: number): [number, number] {
  const lock = Math.max(-p.diffMaxLockTorque, Math.min(p.diffMaxLockTorque, p.diffLocking * (omegaL - omegaR)));
  return [axleTorque / 2 - lock, axleTorque / 2 + lock];
}
