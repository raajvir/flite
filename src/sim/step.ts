/**
 * Vehicle model (M2): planar four-wheel chassis.
 *
 * Degrees of freedom: position (x, z), yaw, body velocities (u forward, v left),
 * yaw rate, and the spin of each wheel. Vertical motion is not simulated;
 * wheel loads come from static weight + aero downforce + quasi-static weight
 * transfer (from lagged body accelerations, standing in for soft suspension).
 *
 * Each step:
 *   1. steering actuator           5. wheel spin (drive, tire, brake, rolling resistance)
 *   2. gearbox + engine            6. aero drag + stability assist
 *   3. wheel loads                 7. integrate chassis (semi-implicit Euler)
 *   4. tire slips + forces
 *
 * Pure: no globals, no randomness. Same inputs -> bit-identical output.
 */
import { AIR_DENSITY, GRAVITY } from './constants';
import type { CarParams } from './params';
import { chooseGear, engineTorque, splitDiff, totalRatio, wheelRpm } from './powertrain';
import { tireForce } from './tire';
import type { CarState, DriverInputs, WheelState } from './types';

const TWO_PI = Math.PI * 2;
/** Finite-difference step for the tire's longitudinal stiffness. */
const KAPPA_EPS = 1e-4;
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** Wheel i is front if i < 2, left if i is even (FL=0, FR=1, RL=2, RR=3). */
const isFront = (i: number) => i < 2;
/** TCS fades torque to zero over this fraction of tcsSlip above the threshold. */
const TCS_RANGE = 1.5;

/** Combined slip of a wheel's last step, normalised so 1 = tire peak. */
function normalisedSlip(w: WheelState, t: CarParams['derived']['tire']): number {
  return Math.hypot(w.kappa / t.peakSlipRatio, w.tanAlpha / t.tanPeakSlipAngle);
}
const isLeft = (i: number) => i % 2 === 0;

/** Static + aero + weight-transfer loads, N, in wheel order. Never negative. */
export function wheelLoads(p: CarParams, u: number, axF: number, ayF: number): [number, number, number, number] {
  const weight = p.mass * GRAVITY;
  const downforce = 0.5 * AIR_DENSITY * p.liftArea * u * u;
  let front = weight * p.weightFront + downforce * p.aeroBalanceFront;
  let rear = weight * (1 - p.weightFront) + downforce * (1 - p.aeroBalanceFront);

  // Longitudinal transfer: accelerating loads the rear, braking loads the front.
  const dLong = (p.mass * axF * p.cgHeight) / p.wheelbase;
  front -= dLong;
  rear += dLong;

  // Lateral transfer: accelerating left (ay > 0) loads the right-hand wheels.
  const dLat = p.mass * ayF * p.cgHeight;
  const dF = (dLat * p.rollStiffnessFront) / p.trackFront;
  const dR = (dLat * (1 - p.rollStiffnessFront)) / p.trackRear;

  return [
    Math.max(0, front / 2 - dF),
    Math.max(0, front / 2 + dF),
    Math.max(0, rear / 2 - dR),
    Math.max(0, rear / 2 + dR),
  ];
}

/** Available steering lock shrinks with speed so full keyboard input stays usable at 300 km/h. */
export function steerLock(p: CarParams, u: number): number {
  const r = u / p.steerSpeedFalloff;
  return p.maxSteerAngle / (1 + r * r);
}

export function step(s: CarState, inputs: DriverInputs, p: CarParams, dt: number): CarState {
  const steerIn = clamp(inputs.steer, -1, 1);
  const throttleIn = clamp(inputs.throttle, 0, 1);
  const brakeIn = clamp(inputs.brake, 0, 1);
  const { a, b, tire } = p.derived;
  const R = p.wheelRadius;

  // --- 1. Steering actuator.
  const steerTarget = steerIn * steerLock(p, Math.abs(s.u));
  const maxDelta = p.steerRate * dt;
  const steerAngle = s.steerAngle + clamp(steerTarget - s.steerAngle, -maxDelta, maxDelta);

  // --- 2. Gearbox + engine.
  const [wFL, wFR, wRL, wRR] = s.wheels;
  const drivenOmega = (wRL.omega + wRR.omega) / 2;
  // Shift decisions use road speed, not wheel speed, so wheelspin doesn't make the box hunt.
  const shift = chooseGear(
    p,
    s.gear,
    Math.max(0, s.shiftTimer - dt),
    s.u,
    wheelRpm(p, s.gear, s.u / R),
    throttleIn,
    brakeIn,
  );
  const gear = shift.gear;
  const reverse = gear < 0;
  // In reverse the pedals swap: brake drives backwards, throttle brakes.
  const drivePedal = reverse ? brakeIn : throttleIn;
  const brakePedal = reverse ? throttleIn : brakeIn;

  const rpm = Math.max(p.idleRpm, wheelRpm(p, gear, drivenOmega));
  let crank = shift.shiftTimer > 0 ? 0 : engineTorque(p, drivePedal, rpm);
  if (reverse && s.u < -p.reverseMaxSpeed) crank = Math.min(crank, 0);
  let axleTorque = crank * totalRatio(p, gear) * p.drivetrainEfficiency;

  // Traction control (assist): cut drive torque when a driven tire's COMBINED slip
  // (spin + sideways) passes tcsSlip, where 1.0 = at the tire's peak. Watching combined
  // slip means it also catches power oversteer, not just straight-line wheelspin.
  // Steering at full lock = "I mean it": assists back off so you can drift or do donuts.
  const lockFraction = Math.min(1, Math.abs(steerAngle) / Math.max(steerLock(p, Math.abs(s.u)), 1e-6));
  const assistScale = 1 - p.assistLockRelease * lockFraction * lockFraction;
  if (p.tcsEnabled > 0 && crank > 0 && assistScale > 0) {
    const slip = Math.max(normalisedSlip(wRL, tire), normalisedSlip(wRR, tire));
    const threshold = p.tcsSlip / assistScale;
    if (slip > threshold) axleTorque *= clamp(1 - (slip - threshold) / (threshold * TCS_RANGE), 0, 1);
  }
  const [driveL, driveR] = splitDiff(p, axleTorque, wRL.omega, wRR.omega);

  // --- 3. Loads.
  const loads = wheelLoads(p, s.u, s.axFiltered, s.ayFiltered);

  // --- 4 & 5. Tires and wheel spin.
  const cosD = Math.cos(steerAngle);
  const sinD = Math.sin(steerAngle);
  let sumFx = 0;
  let sumFy = 0;
  let sumMz = 0;
  const wheels: WheelState[] = [];

  for (let i = 0; i < 4; i++) {
    const w = s.wheels[i]!;
    const front = isFront(i);
    const xi = front ? a : -b;
    const yi = (isLeft(i) ? 0.5 : -0.5) * (front ? p.trackFront : p.trackRear);
    const c = front ? cosD : 1;
    const sn = front ? sinD : 0;
    const Fz = loads[i]!;

    // Contact-patch velocity in the body frame, then in the wheel frame.
    const vxb = s.u - s.yawRate * yi;
    const vyb = s.v + s.yawRate * xi;
    const vxw = vxb * c + vyb * sn;
    const vyw = -vxb * sn + vyb * c;

    // Longitudinal slip: instantaneous (the wheel-spin update below is implicit, so this is stable).
    const absVx = Math.abs(vxw);
    const denom = Math.max(absVx, p.tireLowSpeed);
    const kappa = (w.omega * R - vxw) / denom;

    // Lateral slip with relaxation length: the tire rolls ~sigma metres to build side force.
    // sigma shrinks at low speed so the car settles cleanly at standstill instead of wobbling.
    // Exact exponential update => stable at any speed.
    const sigma = p.tireRelaxationLength * Math.min(1, absVx / p.tireLowSpeed);
    const alphaSS = vyw / denom;
    const decay = sigma > 0 ? Math.exp((-denom / sigma) * dt) : 0;
    const tanAlpha = alphaSS + (w.tanAlpha - alphaSS) * decay;

    const grip = 1; // surface grip arrives in M3
    const f = tireForce(kappa, tanAlpha, Fz, tire, grip);

    // Back to body frame.
    const fxb = f.fx * c - f.fy * sn;
    const fyb = f.fx * sn + f.fy * c;
    sumFx += fxb;
    sumFy += fyb;
    sumMz += xi * fyb - yi * fxb;

    // Wheel spin, linearly implicit: the tire force rises as the wheel speeds up
    // (dFx/domega = dFx/dkappa * R / denom), so we fold that stiffness into an
    // effective inertia. This is what keeps a 1 kg*m^2 wheel stable at 1000 Hz.
    const inertia = front ? p.wheelInertiaFront : p.wheelInertiaRear;
    // Stiffness = max(local slope, secant slope through zero slip). The local slope alone is
    // shallow near the force peak and lets the wheel overshoot into a 2-step flip-flop.
    const tangent = (tireForce(kappa + KAPPA_EPS, tanAlpha, Fz, tire, grip).fx - f.fx) / KAPPA_EPS;
    const secant = Math.abs(kappa) > KAPPA_EPS ? f.fx / kappa : 0;
    const dFdKappa = Math.max(0, tangent, secant);
    const effInertia = inertia + (dt * R * R * dFdKappa) / denom;
    const drive = i === 2 ? driveL : i === 3 ? driveR : 0;
    let omega = w.omega + ((drive - f.fx * R) / effInertia) * dt;

    // ... then friction torques (brake, rolling resistance), which can stop the wheel but never reverse it.
    let brakeT = brakePedal * p.brakeMaxTorque * (front ? p.brakeBiasFront : 1 - p.brakeBiasFront) * 0.5;
    if (p.absEnabled > 0 && -kappa * Math.sign(vxw) > p.absSlip) {
      brakeT *= clamp(1 - (-kappa * Math.sign(vxw) - p.absSlip) / p.absSlip, 0, 1);
    }
    const frictionT = brakeT + p.rollingResistance * Fz * R;
    const dOmega = (frictionT / effInertia) * dt;
    omega = Math.abs(omega) <= dOmega ? 0 : omega - Math.sign(omega) * dOmega;

    let spin = (w.spin + omega * dt) % TWO_PI;
    if (spin < 0) spin += TWO_PI;
    wheels.push({ omega, spin, kappa, tanAlpha, load: Fz, fx: f.fx, fy: f.fy });
  }

  // --- 6. Aero drag + stability assist.
  sumFx -= 0.5 * AIR_DENSITY * p.dragArea * s.u * Math.abs(s.u);

  if (p.stabilityAssist > 0) {
    const speed = Math.abs(s.u);
    const limit = p.stabilityMaxLatAccel / Math.max(speed, p.tireLowSpeed);
    const targetYawRate = clamp((s.u * Math.tan(steerAngle)) / p.wheelbase, -limit, limit);
    const fade = Math.min(1, speed / p.stabilityFadeSpeed);
    // Yawing the way you're steering at full lock is intentional (donut/drift): back off.
    const intent = s.yawRate * steerAngle > 0 ? assistScale : 1;
    sumMz -= p.stabilityAssist * (s.yawRate - targetYawRate) * fade * intent;
  }

  // --- 7. Integrate chassis (velocities first, then positions with the new velocities).
  const ax = sumFx / p.mass;
  const ay = sumFy / p.mass;
  const u = s.u + (ax + s.v * s.yawRate) * dt;
  const v = s.v + (ay - s.u * s.yawRate) * dt;
  const yawRate = s.yawRate + (sumMz / p.yawInertia) * dt;
  const yaw = s.yaw + yawRate * dt;

  // Body forward = (-sin yaw, 0, -cos yaw), body left = (-cos yaw, 0, sin yaw).
  const sinY = Math.sin(yaw);
  const cosY = Math.cos(yaw);
  const x = s.x + (-sinY * u - cosY * v) * dt;
  const z = s.z + (-cosY * u + sinY * v) * dt;

  const lag = 1 - Math.exp(-dt / p.loadTransferLag);
  const body = suspensionStep(p, s, ax, ay, dt);

  return {
    t: s.t + dt,
    x,
    y: s.y,
    z,
    yaw,
    u,
    v,
    yawRate,
    steerAngle,
    distance: s.distance + Math.hypot(u, v) * dt,
    gear,
    shiftTimer: shift.shiftTimer,
    rpm,
    axFiltered: s.axFiltered + (ax - s.axFiltered) * lag,
    ayFiltered: s.ayFiltered + (ay - s.ayFiltered) * lag,
    ...body,
    wheels: wheels as CarState['wheels'],
  };
}

/**
 * Body pitch and roll on the suspension: a spring-damper pulled towards the
 * steady angle for the current acceleration. Braking dives the nose, accelerating
 * squats the rear, cornering leans the body to the outside — with a small
 * overshoot and settle. (Visual + telemetry for now; loads still use the
 * quasi-static transfer above.)
 */
export function suspensionStep(
  p: CarParams,
  s: Pick<CarState, 'pitch' | 'pitchRate' | 'roll' | 'rollRate'>,
  ax: number,
  ay: number,
  dt: number,
): { pitch: number; pitchRate: number; roll: number; rollRate: number } {
  const wn = 2 * Math.PI * p.suspensionFrequency;
  const k = wn * wn;
  const c = 2 * p.suspensionDamping * wn;
  const pitchTarget = -p.bodyPitchGradient * ax; // braking (ax < 0) -> nose down (+)
  const rollTarget = p.bodyRollGradient * ay; // turning left (ay > 0) -> lean right (+)
  const pitchRate = s.pitchRate + (k * (pitchTarget - s.pitch) - c * s.pitchRate) * dt;
  const rollRate = s.rollRate + (k * (rollTarget - s.roll) - c * s.rollRate) * dt;
  return {
    pitch: s.pitch + pitchRate * dt,
    pitchRate,
    roll: s.roll + rollRate * dt,
    rollRate,
  };
}
