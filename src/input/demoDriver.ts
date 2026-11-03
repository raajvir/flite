/**
 * Demo autopilot (?demo in the URL). Follows a looped route round the test area
 * using "pure pursuit" steering and a simple braking-distance speed plan.
 * It only outputs DriverInputs — the same interface the keyboard uses —
 * which is a preview of how the AI driver will plug in later.
 */
import type { CarParams } from '../sim/params';
import { steerLock } from '../sim/step';
import type { CarState, DriverInputs } from '../sim/types';

interface Waypoint {
  x: number;
  z: number;
  /** Speed to be at when passing this point, m/s */
  v: number;
}

/** Loop: down the main straight, round the hairpin, back up the left side, round to the start. */
const ROUTE: Waypoint[] = [
  { x: 0, z: -100, v: 90 },
  { x: 0, z: -700, v: 90 },
  { x: -2, z: -800, v: 22 },
  { x: -15, z: -868, v: 20 },
  { x: -40, z: -862, v: 22 },
  { x: -50, z: -800, v: 30 },
  { x: -50, z: -500, v: 80 },
  { x: -50, z: -150, v: 80 },
  { x: -48, z: -40, v: 30 },
  { x: -25, z: 15, v: 28 },
  { x: -2, z: -30, v: 45 },
];

const TUNING = {
  lookaheadBase: 10, // m
  lookaheadPerSpeed: 0.45, // s (m per m/s)
  brakingDecel: 22, // m/s^2 the planner assumes (well within the car's ability)
  throttleGain: 0.4,
  brakeGain: 0.25,
  waypointRadius: 18, // m: waypoint counts as passed inside this
};

export class DemoDriver {
  private next = 0;
  constructor(private readonly p: CarParams) {}

  update(s: CarState): DriverInputs {
    const t = TUNING;
    let wp = ROUTE[this.next]!;
    if (Math.hypot(wp.x - s.x, wp.z - s.z) < t.waypointRadius) {
      this.next = (this.next + 1) % ROUTE.length;
      wp = ROUTE[this.next]!;
    }

    // Pure pursuit on the segment towards the next waypoint.
    const prev = ROUTE[(this.next + ROUTE.length - 1) % ROUTE.length]!;
    const look = t.lookaheadBase + t.lookaheadPerSpeed * Math.abs(s.u);
    const target = pointAhead(prev, wp, s.x, s.z, look);
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    const lx = -Math.cos(s.yaw), lz = Math.sin(s.yaw);
    const dx = target.x - s.x, dz = target.z - s.z;
    const alpha = Math.atan2(dx * lx + dz * lz, dx * fx + dz * fz);
    const wheelAngle = Math.atan((2 * this.p.wheelbase * Math.sin(alpha)) / look);
    const steer = Math.max(-1, Math.min(1, wheelAngle / steerLock(this.p, Math.abs(s.u))));

    // Speed plan: slowest of "what each upcoming waypoint allows given braking distance".
    let vTarget = Infinity;
    let dist = Math.hypot(wp.x - s.x, wp.z - s.z);
    for (let k = 0; k < 4; k++) {
      const w = ROUTE[(this.next + k) % ROUTE.length]!;
      vTarget = Math.min(vTarget, Math.sqrt(w.v * w.v + 2 * t.brakingDecel * dist));
      const n = ROUTE[(this.next + k + 1) % ROUTE.length]!;
      dist += Math.hypot(n.x - w.x, n.z - w.z);
    }
    const err = vTarget - s.u;
    return {
      steer,
      throttle: err > 0 ? Math.min(1, err * t.throttleGain) : 0,
      brake: err < 0 ? Math.min(1, -err * t.brakeGain) : 0,
    };
  }
}

/** Point `look` metres ahead of the car's projection onto segment a->b (clamped to b). */
function pointAhead(a: Waypoint, b: Waypoint, x: number, z: number, look: number): { x: number; z: number } {
  const sx = b.x - a.x, sz = b.z - a.z;
  const len = Math.hypot(sx, sz) || 1;
  const ux = sx / len, uz = sz / len;
  const along = Math.max(0, (x - a.x) * ux + (z - a.z) * uz);
  const d = Math.min(len, along + look);
  return { x: a.x + ux * d, z: a.z + uz * d };
}
