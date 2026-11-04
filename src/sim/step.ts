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
import surfacesFile from '../../data/surfaces.json';
import { AIR_DENSITY, GRAVITY, RPM_TO_RADPS } from './constants';
import type { CarParams } from './params';
import { chooseGear, engineTorque, splitDiff, totalRatio, wheelRpm } from './powertrain';
import { bumpNoise, loadSurfaces, type SurfacesFile } from './surfaces';
import { tireForce } from './tire';
import { NO_FORCE, type CarState, type DriverInputs, type ExternalForce, type WheelState } from './types';
import { FlatWorld, type GroundQuery, type World } from './world';

/** Flat asphalt everywhere: the default world (test area, unit tests). */
export const FLAT_ASPHALT: World = new FlatWorld(loadSurfaces(surfacesFile as unknown as SurfacesFile));

const TWO_PI = Math.PI * 2;
/** Yaw rate above which the car counts as already doing a donut, rad/s. */
const DONUT_YAW_RATE = 1.0;
/** Over a crest the car can go light down to this share of its load; a compression adds at most this. */
const CREST_MIN_LOAD = 0.05;
const COMPRESSION_MAX_LOAD = 2.5;
/** Cap on how fast a wheel can be pushed up/down by the ground, m/s (also stops a spike on the first step after a reset). */
const MAX_WHEEL_RISE_RATE = 5;
/** Below this sliding speed along a wall, friction is scaled down linearly (avoids jitter), m/s. */
const WALL_SLIP_SPEED = 0.5;
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
export function wheelLoads(p: CarParams, u: number, axF: number, ayF: number, liftScale = 1): [number, number, number, number] {
  const weight = p.mass * GRAVITY;
  const downforce = 0.5 * AIR_DENSITY * p.liftArea * liftScale * u * u;
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

export function step(
  s: CarState,
  inputs: DriverInputs,
  p: CarParams,
  dt: number,
  world: World = FLAT_ASPHALT,
  ext: ExternalForce = NO_FORCE,
): CarState {
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

  // ERS boost: extra power from the battery while boost is held (forward gears, on throttle).
  const boostIn = clamp(inputs.boost ?? 0, 0, 1);
  let ersDeploy = 0;
  if (boostIn > 0 && gear > 0 && drivePedal > 0 && shift.shiftTimer === 0 && rpm < p.revLimitRpm && s.battery > 0) {
    ersDeploy = Math.min(p.ersPower * boostIn * drivePedal, s.battery / dt);
    crank += ersDeploy / (rpm * RPM_TO_RADPS);
  }
  let battery = s.battery - ersDeploy * dt;
  // Harvest under braking.
  if (brakePedal > 0 && Math.abs(s.u) > p.ersHarvestMinSpeed) battery += p.ersHarvestPower * brakePedal * dt;
  battery = clamp(battery, 0, p.ersCapacity);
  let axleTorque = crank * totalRatio(p, gear) * p.drivetrainEfficiency;

  // Traction control (assist): cut drive torque when a driven tire's COMBINED slip
  // (spin + sideways) passes tcsSlip, where 1.0 = at the tire's peak. Watching combined
  // slip means it also catches power oversteer, not just straight-line wheelspin.
  // Donut mode: full lock + full throttle at low speed = "I mean it", so the assists back off.
  // Above assistReleaseSpeed they fade back in (fully on at 2x), so normal driving stays planted
  // even though a held keyboard key always means full lock.
  // Judged from the driver's steering INPUT (intent), not the wheels, which take a moment to reach lock.
  const lockFraction = Math.abs(steerIn);
  // Once the car is already rotating the way you steer (a donut in progress), allow twice the speed
  // before the assists come back, so tight traction control doesn't snuff out the donut.
  const rotatingIntoSteer = s.yawRate * steerIn > 0 && Math.abs(s.yawRate) > DONUT_YAW_RATE;
  const releaseSpeed = p.assistReleaseSpeed * (rotatingIntoSteer ? 2 : 1);
  const slowEnough = clamp(2 - Math.abs(s.u) / releaseSpeed, 0, 1);
  const donutIntent = lockFraction * lockFraction * throttleIn * slowEnough;
  const assistScale = 1 - p.assistLockRelease * donutIntent;
  if (p.tcsEnabled > 0 && crank > 0 && assistScale > 0) {
    const slip = Math.max(normalisedSlip(wRL, tire), normalisedSlip(wRR, tire));
    const threshold = p.tcsSlip / assistScale;
    if (slip > threshold) axleTorque *= clamp(1 - (slip - threshold) / (threshold * TCS_RANGE), 0, 1);
  }
  const [driveL, driveR] = splitDiff(p, axleTorque, wRL.omega, wRR.omega);

  // --- 3. What's under each wheel, and the loads (incl. surface bumps).
  const contact = world.surfaces.contact;
  const sinY0 = Math.sin(s.yaw), cosY0 = Math.cos(s.yaw);
  const fwdX = -sinY0, fwdZ = -cosY0; // body forward in world
  const leftX = -cosY0, leftZ = sinY0; // body left in world
  const geom = [0, 1, 2, 3].map((i) => ({
    xi: isFront(i) ? a : -b,
    yi: (isLeft(i) ? 0.5 : -0.5) * (isFront(i) ? p.trackFront : p.trackRear),
  }));
  const ground: GroundQuery[] = geom.map(({ xi, yi }) =>
    world.query(s.x + xi * fwdX + yi * leftX, s.z + xi * fwdZ + yi * leftZ, s.y),
  );
  const loads = wheelLoads(p, s.u, s.axFiltered, s.ayFiltered, ext.liftScale ?? 1);
  // Driving over a dip presses the car into the road (more load, more grip); over a crest it goes light.
  const vertCurv = (ground[0]!.vertCurv + ground[1]!.vertCurv + ground[2]!.vertCurv + ground[3]!.vertCurv) / 4;
  const crestFactor = clamp(1 + (s.u * s.u * vertCurv) / GRAVITY, CREST_MIN_LOAD, COMPRESSION_MAX_LOAD);
  for (let i = 0; i < 4; i++) loads[i] = loads[i]! * crestFactor;
  // Wheel height above the road: kerb profile + surface roughness.
  const bumps = ground.map((g, i) => {
    const { xi, yi } = geom[i]!;
    const wx = s.x + xi * fwdX + yi * leftX, wz = s.z + xi * fwdZ + yi * leftZ;
    return g.kerb + g.surface.bumpAmplitude * bumpNoise(wx, wz, g.surface.bumpWavelength);
  });
  // A wheel pushed up relative to the others compresses its spring (more load) and the
  // others extend (less load); rising fast adds a damper spike. Loads can drop to zero:
  // that's a wheel in the air, and how sausage kerbs throw the car.
  const rates = bumps.map((h, i) => clamp((h - s.wheels[i]!.bump) / dt, -MAX_WHEEL_RISE_RATE, MAX_WHEEL_RISE_RATE));
  const meanH = (bumps[0]! + bumps[1]! + bumps[2]! + bumps[3]!) / 4;
  const meanR = (rates[0]! + rates[1]! + rates[2]! + rates[3]!) / 4;
  for (let i = 0; i < 4; i++) {
    const swing = p.wheelRate * (bumps[i]! - meanH) + p.wheelDamping * (rates[i]! - meanR);
    const cap = p.maxWheelLoadSwing * loads[i]!;
    loads[i] = Math.max(0, loads[i]! + clamp(swing, -cap, cap));
  }

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
    const { xi, yi } = geom[i]!;
    const g = ground[i]!;
    const surf = g.surface;
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

    const grip = surf.grip;
    const f = tireForce(kappa, tanAlpha, Fz, tire, grip);

    // Back to body frame.
    const fxb = f.fx * c - f.fy * sn;
    const fyb = f.fx * sn + f.fy * c;
    sumFx += fxb;
    sumFy += fyb;
    sumMz += xi * fyb - yi * fxb;

    // A kerb tilts the surface under this wheel relative to the road: the contact pushes
    // back along that tilted normal, -load * kerb gradient. Kerbs angled up towards the
    // outside therefore push the wheel back onto the track. (Smooth road camber/slope is
    // gravity on the whole car, applied at the CG below.)
    const gfx = -Fz * (g.kerbGradX * fwdX + g.kerbGradZ * fwdZ);
    const gfy = -Fz * (g.kerbGradX * leftX + g.kerbGradZ * leftZ);
    sumFx += gfx;
    sumFy += gfy;
    sumMz += xi * gfy - yi * gfx;

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
    const frictionT = brakeT + (p.rollingResistance + surf.rollingResistance) * Fz * R;
    const dOmega = (frictionT / effInertia) * dt;
    omega = Math.abs(omega) <= dOmega ? 0 : omega - Math.sign(omega) * dOmega;

    // Surface drag (gravel sinking the car): opposes the contact patch's motion, grows with speed.
    if (surf.drag > 0) {
      const k = (surf.drag * Fz) / GRAVITY;
      sumFx -= k * vxb;
      sumFy -= k * vyb;
      sumMz -= xi * k * vyb - yi * k * vxb;
    }

    // Wall contact at the wheel: spring-damper push back towards the track + sliding friction.
    if (g.wallDepth > 0) {
      const pvx = vxb * fwdX + vyb * leftX; // contact point velocity, world
      const pvz = vxb * fwdZ + vyb * leftZ;
      const vn = pvx * g.wallNx + pvz * g.wallNz; // > 0 = moving further into the wall
      const N = Math.max(0, contact.wallStiffness * g.wallDepth + contact.wallDamping * vn);
      const tx = pvx - vn * g.wallNx, tz = pvz - vn * g.wallNz;
      const vt = Math.hypot(tx, tz);
      const fr = vt > WALL_SLIP_SPEED ? (contact.wallFriction * N) / vt : (contact.wallFriction * N) / WALL_SLIP_SPEED;
      const Fwx = -N * g.wallNx - fr * tx;
      const Fwz = -N * g.wallNz - fr * tz;
      const fbx = Fwx * fwdX + Fwz * fwdZ;
      const fby = Fwx * leftX + Fwz * leftZ;
      sumFx += fbx;
      sumFy += fby;
      sumMz += xi * fby - yi * fbx;
    }

    let spin = (w.spin + omega * dt) % TWO_PI;
    if (spin < 0) spin += TWO_PI;
    wheels.push({ omega, spin, kappa, tanAlpha, load: Fz, fx: f.fx, fy: f.fy, surface: surf.id, bump: bumps[i]! });
  }

  // Outside forces (car-to-car contact).
  sumFx += ext.fx;
  sumFy += ext.fy;
  sumMz += ext.mz;

  // --- 6. Aero drag + stability assist.
  sumFx -= 0.5 * AIR_DENSITY * p.dragArea * (ext.dragScale ?? 1) * s.u * Math.abs(s.u);

  if (p.stabilityAssist > 0) {
    const speed = Math.abs(s.u);
    // Target no more rotation than the tires can actually sustain right now (incl. downforce),
    // so asking for too much steering gives a controlled push wide instead of a slide.
    const gripLatAccel = (p.tireMuY * (loads[0] + loads[1] + loads[2] + loads[3]) * p.stabilityGripFraction) / p.mass;
    const limit = gripLatAccel / Math.max(speed, p.tireLowSpeed);
    const targetYawRate = clamp((s.u * Math.tan(steerAngle)) / p.wheelbase, -limit, limit);
    const fade = Math.min(1, speed / p.stabilityFadeSpeed);
    // Yawing the way you're steering at full lock is intentional (donut/drift): back off.
    const intent = s.yawRate * steerAngle > 0 ? assistScale : 1;
    sumMz -= p.stabilityAssist * (s.yawRate - targetYawRate) * fade * intent;
  }

  // --- 7. Integrate chassis (velocities first, then positions with the new velocities).
  const ax = sumFx / p.mass;
  const ay = sumFy / p.mass;
  // Gravity on a slope/camber pulls the car downhill (not felt as load transfer, so kept separate).
  let gX = 0, gZ = 0, height = 0;
  for (const g of ground) {
    gX += g.gradX / 4;
    gZ += g.gradZ / 4;
    height += g.height / 4;
  }
  const slopeF = gX * fwdX + gZ * fwdZ;
  const slopeL = gX * leftX + gZ * leftZ;
  // Road camber/slope: gravity pulls the car downhill (acts at the CG; not felt as load transfer).
  const axGravity = -GRAVITY * slopeF;
  const ayGravity = -GRAVITY * slopeL;
  const u = s.u + (ax + axGravity + s.v * s.yawRate) * dt;
  const v = s.v + (ay + ayGravity - s.u * s.yawRate) * dt;
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
    y: height,
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
    battery,
    ersDeploy,
    axFiltered: s.axFiltered + (ax - s.axFiltered) * lag,
    ayFiltered: s.ayFiltered + (ay - s.ayFiltered) * lag,
    ...body,
    slopeF,
    slopeL,
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
