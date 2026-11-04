/**
 * Snapshot buffer + interpolation.
 *
 * The worker sends sim states at ~250 Hz; the screen draws at 60-120 Hz.
 * We draw the car slightly in the past (INTERP_DELAY) so there are always two
 * snapshots on either side of the draw time, and blend between them.
 */
import type { CarState, WheelState } from '../sim/types';

const BUFFER_SIZE = 64;
/** How far behind the newest sim state we draw, s. */
const INTERP_DELAY = 0.035; // big enough to ride out late worker messages (no freeze-then-jump)
/** If our render clock drifts further than this from target, snap instead of easing, s. */
const SNAP_THRESHOLD = 0.25;
/** How quickly the render clock is nudged towards target (per second). */
const CLOCK_CORRECTION_RATE = 1.5; // gentle, so corrections never show as speed wobble

export class SnapshotInterpolator {
  private buf: CarState[] = [];
  private renderT = -1;

  clear(): void {
    this.buf = [];
    this.renderT = -1;
  }

  push(s: CarState): void {
    const last = this.buf[this.buf.length - 1];
    if (last && s.t < last.t) this.clear(); // reset: start fresh
    this.buf.push(s);
    if (this.buf.length > BUFFER_SIZE) this.buf.shift();
  }

  latest(): CarState | null {
    return this.buf[this.buf.length - 1] ?? null;
  }

  sample(frameDt: number): CarState | null {
    const newest = this.buf[this.buf.length - 1];
    if (!newest) return null;
    const target = newest.t - INTERP_DELAY;
    if (this.renderT < 0 || Math.abs(this.renderT - target) > SNAP_THRESHOLD) {
      this.renderT = target;
    } else {
      this.renderT += frameDt;
      this.renderT += (target - this.renderT) * Math.min(1, CLOCK_CORRECTION_RATE * frameDt);
    }
    const t = this.renderT;
    for (let i = this.buf.length - 1; i > 0; i--) {
      const a = this.buf[i - 1]!;
      const b = this.buf[i]!;
      if (a.t <= t && t <= b.t) return lerpState(a, b, (t - a.t) / (b.t - a.t || 1));
    }
    return t > newest.t ? newest : this.buf[0]!;
  }
}

function lerpAngle(a: number, b: number, k: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * k;
}

const l = (x: number, y: number, k: number) => x + (y - x) * k;

function lerpWheel(a: WheelState, b: WheelState, k: number): WheelState {
  return {
    omega: l(a.omega, b.omega, k),
    spin: lerpAngle(a.spin, b.spin, k),
    kappa: l(a.kappa, b.kappa, k),
    tanAlpha: l(a.tanAlpha, b.tanAlpha, k),
    load: l(a.load, b.load, k),
    fx: l(a.fx, b.fx, k),
    fy: l(a.fy, b.fy, k),
    surface: b.surface,
    bump: l(a.bump, b.bump, k),
  };
}

function lerpState(a: CarState, b: CarState, k: number): CarState {
  return {
    ...b,
    t: l(a.t, b.t, k),
    x: l(a.x, b.x, k),
    y: l(a.y, b.y, k),
    z: l(a.z, b.z, k),
    yaw: lerpAngle(a.yaw, b.yaw, k),
    u: l(a.u, b.u, k),
    v: l(a.v, b.v, k),
    yawRate: l(a.yawRate, b.yawRate, k),
    steerAngle: l(a.steerAngle, b.steerAngle, k),
    distance: l(a.distance, b.distance, k),
    rpm: l(a.rpm, b.rpm, k),
    battery: l(a.battery, b.battery, k),
    donut: b.donut,
    ersDeploy: b.ersDeploy,
    axFiltered: l(a.axFiltered, b.axFiltered, k),
    ayFiltered: l(a.ayFiltered, b.ayFiltered, k),
    pitch: l(a.pitch, b.pitch, k),
    roll: l(a.roll, b.roll, k),
    slopeF: l(a.slopeF, b.slopeF, k),
    slopeL: l(a.slopeL, b.slopeL, k),
    wheels: [0, 1, 2, 3].map((i) => lerpWheel(a.wheels[i]!, b.wheels[i]!, k)) as CarState['wheels'],
  };
}
