/**
 * Driver inputs. This is the ONLY way anything drives the car:
 * keyboard, gamepad, replay, and (later) the AI all produce this same struct.
 */
export interface DriverInputs {
  /** -1 = full right, +1 = full left (positive = turn left = positive yaw about +Y). */
  steer: number;
  /** 0..1 */
  throttle: number;
  /** 0..1. Held while (nearly) stopped = reverse. */
  brake: number;
}

export const NEUTRAL_INPUTS: Readonly<DriverInputs> = { steer: 0, throttle: 0, brake: 0 };

/**
 * Full car state. Plain numbers only, so it can be copied, sent to the
 * render thread, saved for replays and compared in tests.
 * See src/sim/README.md for the coordinate system.
 */
export interface CarState {
  /** Simulation time, s */
  t: number;
  /** World position of the car reference point (rear axle centre for M1), m */
  x: number;
  y: number;
  z: number;
  /** Heading: rotation about +Y, rad. 0 = facing -Z. Positive = turned left. */
  yaw: number;
  /** Body-frame forward speed, m/s (positive = forwards) */
  u: number;
  /** Body-frame lateral speed, m/s (positive = to the right). Always 0 in the M1 kinematic model. */
  v: number;
  /** Yaw rate about +Y, rad/s */
  yawRate: number;
  /** Road-wheel steer angle, rad (positive = left) */
  steerAngle: number;
  /** Distance travelled (odometer), m */
  distance: number;
}

export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export function initialState(pose: Pose): CarState {
  return { t: 0, ...pose, u: 0, v: 0, yawRate: 0, steerAngle: 0, distance: 0 };
}
