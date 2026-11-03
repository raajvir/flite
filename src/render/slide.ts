/**
 * "Is this tire sliding, and how hard?" — one shared answer for the skid
 * sound, tire smoke and skid marks, so they always agree.
 */
import type { CarParams } from '../sim/params';
import type { CarState } from '../sim/types';

export const SLIDE_TUNING = {
  start: 1.15, // combined slip (1 = tire peak) where marks/smoke/squeal begin
  full: 2.5, // combined slip for full intensity
  minSlideSpeed: 1.5, // m/s: contact patch must actually be scrubbing over the ground
};

/** 0 = gripping, 1 = sliding flat out. */
export function slideIntensity(s: CarState, i: number, p: CarParams): number {
  const w = s.wheels[i]!;
  const t = SLIDE_TUNING;
  const rho = Math.hypot(w.kappa / p.tirePeakSlipRatio, w.tanAlpha / Math.tan(p.tirePeakSlipAngle));
  const longSlide = Math.abs(w.omega * p.wheelRadius - s.u);
  const latSlide = Math.abs(w.tanAlpha) * Math.abs(s.u);
  if (Math.hypot(longSlide, latSlide) < t.minSlideSpeed) return 0;
  return Math.min(1, Math.max(0, (rho - t.start) / (t.full - t.start)));
}
