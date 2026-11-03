/**
 * M1 vehicle model: kinematic bicycle.
 *
 * This is a deliberately simple placeholder so the whole pipeline
 * (worker -> snapshots -> interpolation -> render) can be built and tested.
 * There are no tires yet: the car goes exactly where the front wheels point,
 * with yaw rate capped by a lateral-acceleration limit. M2 replaces this with
 * a four-wheel chassis + Pacejka tires behind the same step() signature.
 *
 * Pure function: no globals, no DOM, no randomness. Same inputs -> same output.
 */
import { GRAVITY } from './constants';
import type { CarParams } from './params';
import type { CarState, DriverInputs } from './types';

/** Below this speed (m/s) a held brake becomes "reverse". */
const REVERSE_ENGAGE_SPEED = 0.5;
/** Below this speed (m/s) yaw-rate limiting is skipped (avoids divide-by-near-zero). */
const MIN_SPEED_FOR_YAW_LIMIT = 0.1;

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

export function step(s: CarState, inputs: DriverInputs, p: CarParams, dt: number): CarState {
  const steerIn = clamp(inputs.steer, -1, 1);
  const throttle = clamp(inputs.throttle, 0, 1);
  const brake = clamp(inputs.brake, 0, 1);

  // --- Steering actuator: road-wheel angle moves towards target at a limited rate.
  const target = steerIn * p.maxSteerAngle;
  const maxDelta = p.steerRate * dt;
  const steerAngle = s.steerAngle + clamp(target - s.steerAngle, -maxDelta, maxDelta);

  // --- Longitudinal.
  const u0 = s.u;
  const reversing = brake > 0 && throttle === 0 && u0 <= REVERSE_ENGAGE_SPEED;

  // "Push" forces can change the direction of motion.
  let push = throttle * p.engineForce - p.dragCoefficient * u0 * Math.abs(u0);
  if (reversing) push -= brake * p.reverseForce;

  // "Friction" forces (brakes, rolling resistance) only ever slow the car to
  // zero; they never push it backwards. Applied as a clamped impulse.
  const friction =
    (reversing ? 0 : brake * p.brakeForce) + p.rollingResistanceCoefficient * p.mass * GRAVITY;

  let u = u0 + (push / p.mass) * dt;
  const frictionDv = (friction / p.mass) * dt;
  if (Math.abs(u) <= frictionDv) u = 0;
  else u -= Math.sign(u) * frictionDv;
  u = Math.max(u, -p.maxReverseSpeed);

  // --- Yaw: kinematic bicycle, capped by lateral-acceleration limit.
  let yawRate = (u * Math.tan(steerAngle)) / p.wheelbase;
  const speed = Math.abs(u);
  if (speed > MIN_SPEED_FOR_YAW_LIMIT) {
    const maxYawRate = p.maxLateralAcceleration / speed;
    yawRate = clamp(yawRate, -maxYawRate, maxYawRate);
  }
  const yaw = s.yaw + yawRate * dt;

  // --- Position. Forward vector for heading yaw is (-sin yaw, 0, -cos yaw).
  const x = s.x - Math.sin(yaw) * u * dt;
  const z = s.z - Math.cos(yaw) * u * dt;

  return {
    t: s.t + dt,
    x,
    y: s.y,
    z,
    yaw,
    u,
    v: 0,
    yawRate,
    steerAngle,
    distance: s.distance + speed * dt,
  };
}
