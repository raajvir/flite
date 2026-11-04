/**
 * Driver inputs. This is the ONLY way anything drives the car:
 * keyboard, gamepad, replay, and (later) the AI all produce this same struct.
 */
export interface DriverInputs {
  /** -1 = full right, +1 = full left (positive = turn left = positive yaw about +Y). */
  steer: number;
  /** 0..1 */
  throttle: number;
  /** 0..1. Held while (nearly) stopped = reverse gear; in reverse, brake and throttle swap. */
  brake: number;
  /** 0..1 ERS battery boost (Shift). Optional: absent = 0. */
  boost?: number;
}

export const NEUTRAL_INPUTS: Readonly<DriverInputs> = { steer: 0, throttle: 0, brake: 0 };

/** Wheel order everywhere: front-left, front-right, rear-left, rear-right. */
export const WHEEL_NAMES = ['FL', 'FR', 'RL', 'RR'] as const;

export interface WheelState {
  /** Spin rate, rad/s (positive = rolling forwards) */
  omega: number;
  /** Accumulated spin angle for rendering, rad, wrapped to [0, 2π) */
  spin: number;
  /** Longitudinal slip ratio (positive = driving). Output only. */
  kappa: number;
  /** Lagged lateral slip, tan(alpha) (positive = contact patch sliding left) */
  tanAlpha: number;
  /** Vertical load, N (output, for telemetry/HUD) */
  load: number;
  /** Tire force in wheel frame, N (output) */
  fx: number;
  fy: number;
  /** Surface id under this wheel (index into the surface table) */
  surface: number;
  /** Bump height under this wheel, m (surface roughness; for visuals and telemetry) */
  bump: number;
}

/**
 * Effects from other cars: contact forces (body frame: fx forward, fy left, mz about +Y)
 * and aero scaling from running in another car's wake (drafting).
 */
export interface ExternalForce {
  fx: number;
  fy: number;
  mz: number;
  /** Multiplier on aero drag (< 1 in a slipstream). Default 1. */
  dragScale?: number;
  /** Multiplier on downforce (< 1 in dirty air). Default 1. */
  liftScale?: number;
}

export const NO_FORCE: Readonly<ExternalForce> = { fx: 0, fy: 0, mz: 0 };

/**
 * Full car state. Plain numbers/arrays only, so it can be copied, sent to the
 * render thread, saved for replays and compared in tests.
 * See src/sim/README.md for the coordinate system.
 */
export interface CarState {
  /** Simulation time, s */
  t: number;
  /** World position of the centre of gravity projected to the ground, m */
  x: number;
  y: number;
  z: number;
  /** Heading: rotation about +Y, rad. 0 = facing -Z. Positive = turned left. */
  yaw: number;
  /** Body-frame forward speed, m/s */
  u: number;
  /** Body-frame lateral speed, m/s (positive = LEFT, ISO 8855) */
  v: number;
  /** Yaw rate about +Y, rad/s */
  yawRate: number;
  /** Road-wheel steer angle, rad (positive = left) */
  steerAngle: number;
  /** Odometer, m */
  distance: number;
  /** -1 reverse, 1..N forward */
  gear: number;
  /** Remaining torque-cut time from the last gear change, s */
  shiftTimer: number;
  /** Engine speed, rpm */
  rpm: number;
  /** Donut mode latched on (1) or off (0): assists released for a deliberate donut */
  donut: number;
  /** ERS battery energy, J */
  battery: number;
  /** ERS power being deployed right now, W (0 when not boosting) */
  ersDeploy: number;
  /** Low-pass filtered body accelerations used for weight transfer, m/s² (x forward, y left) */
  axFiltered: number;
  ayFiltered: number;
  /** Body pitch on the suspension, rad (positive = nose down) and its rate, rad/s */
  pitch: number;
  pitchRate: number;
  /** Body roll on the suspension, rad (positive = leaning right / right side down) and its rate */
  roll: number;
  rollRate: number;
  /** Ground slope along the body's forward and left axes (dh/dforward, dh/dleft) */
  slopeF: number;
  slopeL: number;
  wheels: [WheelState, WheelState, WheelState, WheelState];
}

export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const restingWheel = (): WheelState => ({ omega: 0, spin: 0, kappa: 0, tanAlpha: 0, load: 0, fx: 0, fy: 0, surface: 0, bump: 0 });

export function initialState(pose: Pose, idleRpm = 0, battery = 0): CarState {
  return {
    t: 0,
    ...pose,
    u: 0,
    v: 0,
    yawRate: 0,
    steerAngle: 0,
    distance: 0,
    gear: 1,
    shiftTimer: 0,
    rpm: idleRpm,
    donut: 0,
    battery,
    ersDeploy: 0,
    axFiltered: 0,
    ayFiltered: 0,
    pitch: 0,
    pitchRate: 0,
    roll: 0,
    rollRate: 0,
    slopeF: 0,
    slopeL: 0,
    wheels: [restingWheel(), restingWheel(), restingWheel(), restingWheel()],
  };
}
