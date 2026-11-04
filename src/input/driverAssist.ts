/**
 * Driver assists applied to the player's inputs (adjustable, 0 = off .. 1 = strongest):
 *
 * - Steering assist: looks ~0.6 s ahead along the car's motion. If that point would be
 *   past the track edge (minus a margin), it adds a gentle correction back towards the
 *   track. You keep control; it just stops a slow drift off the road.
 * - Braking assist: uses the speed plan (the braking line's). If you're arriving too fast
 *   for what's ahead, it brakes for you and lifts the throttle, more strongly the later you are.
 *
 * Pure logic (no DOM), so it's unit-tested like the physics.
 */
import { planBrakingDecel, type RacingPlan } from '../ai/aiDriver';
import type { TrackWorld } from '../sim/trackWorld';
import type { CarState, DriverInputs } from '../sim/types';

export const ASSIST_TUNING = {
  steerLookahead: 0.6, // s
  steerMargin: 1.0, // m inside the edge where help starts
  steerFullCorrection: 2.5, // m past the margin for full corrective steer
  brakeScan: 160, // m ahead checked for corners
  brakeStep: 8, // m between checks
  brakeStart: 0.65, // starts helping when the braking needed passes this share of what's available
  brakeFull: 0.95, // full help at this share
  minSpeed: 8, // m/s: no assists when crawling
};

export class DriverAssist {
  steering = 0;
  braking = 0;
  plan: RacingPlan | null = null;

  constructor(private readonly world: TrackWorld) {}

  apply(inp: DriverInputs, s: CarState): DriverInputs {
    const t = ASSIST_TUNING;
    const out = { ...inp };
    const speed = Math.hypot(s.u, s.v);
    if (speed < t.minSpeed || s.gear < 0) return out;
    const w = this.world;

    // --- Steering: predicted position vs track edges.
    if (this.steering > 0) {
      const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
      const lx = -Math.cos(s.yaw), lz = Math.sin(s.yaw);
      const vx = s.u * fx + s.v * lx, vz = s.u * fz + s.v * lz;
      const p = w.project(s.x + vx * t.steerLookahead, s.z + vz * t.steerLookahead, s.y);
      const edge = p.d >= 0 ? w.at(w.wl, p.s) : w.at(w.wr, p.s);
      const excess = Math.abs(p.d) - (edge - t.steerMargin);
      if (excess > 0) {
        // Past the left edge (d > 0) -> steer right (negative), and vice versa.
        const corr = -Math.sign(p.d) * Math.min(1, excess / t.steerFullCorrection);
        out.steer = Math.max(-1, Math.min(1, out.steer + this.steering * corr));
      }
    }

    // --- Braking: braking needed for the slowest point ahead vs what the car can do.
    if (this.braking > 0 && this.plan) {
      const here = w.project(s.x, s.z, s.y).s;
      let need = 0;
      for (let ahead = t.brakeStep; ahead <= t.brakeScan; ahead += t.brakeStep) {
        const v = this.plan.speedAt(here + ahead);
        if (v < speed) need = Math.max(need, (speed * speed - v * v) / (2 * ahead));
      }
      const available = planBrakingDecel(this.plan.params, this.plan.skill, speed);
      const share = need / available;
      if (share > t.brakeStart) {
        const k = this.braking * Math.min(1, (share - t.brakeStart) / (t.brakeFull - t.brakeStart));
        out.brake = Math.max(out.brake, k);
        out.throttle = out.throttle * (1 - k);
      }
    }
    return out;
  }
}
