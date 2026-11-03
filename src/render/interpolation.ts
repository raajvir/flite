/**
 * Snapshot buffer + interpolation.
 *
 * The worker sends sim states at ~250 Hz; the screen draws at 60-120 Hz.
 * We draw the car slightly in the past (INTERP_DELAY) so there are always two
 * snapshots on either side of the draw time, and blend between them.
 * This removes the stutter you'd get from just drawing "the latest" state.
 */
import type { CarState } from '../sim/types';

const BUFFER_SIZE = 64;
/** How far behind the newest sim state we draw, s. */
const INTERP_DELAY = 0.012;
/** If our render clock drifts further than this from target, snap instead of easing, s. */
const SNAP_THRESHOLD = 0.1;
/** How quickly the render clock is nudged towards target (per second). */
const CLOCK_CORRECTION_RATE = 5;

export class SnapshotInterpolator {
  private buf: CarState[] = [];
  private renderT = -1;

  push(s: CarState): void {
    // A reset sends t back to 0: start fresh.
    const last = this.buf[this.buf.length - 1];
    if (last && s.t < last.t) {
      this.buf = [];
      this.renderT = -1;
    }
    this.buf.push(s);
    if (this.buf.length > BUFFER_SIZE) this.buf.shift();
  }

  /** Advance the render clock by frameDt and return an interpolated state (or null if empty). */
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

    // Find snapshots a <= t <= b.
    for (let i = this.buf.length - 1; i > 0; i--) {
      const a = this.buf[i - 1] as CarState;
      const b = this.buf[i] as CarState;
      if (a.t <= t && t <= b.t) return lerpState(a, b, (t - a.t) / (b.t - a.t || 1));
    }
    return t > newest.t ? newest : (this.buf[0] as CarState);
  }
}

function lerpAngle(a: number, b: number, k: number): number {
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return a + d * k;
}

function lerpState(a: CarState, b: CarState, k: number): CarState {
  const l = (x: number, y: number) => x + (y - x) * k;
  return {
    t: l(a.t, b.t),
    x: l(a.x, b.x),
    y: l(a.y, b.y),
    z: l(a.z, b.z),
    yaw: lerpAngle(a.yaw, b.yaw, k),
    u: l(a.u, b.u),
    v: l(a.v, b.v),
    yawRate: l(a.yawRate, b.yawRate),
    steerAngle: l(a.steerAngle, b.steerAngle),
    distance: l(a.distance, b.distance),
  };
}
