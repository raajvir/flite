/**
 * Tire model: Pacejka "magic formula" shape + combined slip via normalised slip.
 *
 * 1. Normalise each slip by its peak value:
 *      sx = kappa / peakSlipRatio,  sy = tanAlpha / tan(peakSlipAngle)
 * 2. Combined slip  rho = |(sx, sy)|. rho = 1 means "at the peak".
 * 3. One magic-formula curve gives the force fraction f(rho) (peak 1 at rho = 1).
 * 4. Force points along the slip direction, scaled by the friction ellipse:
 *      Fx = muX * Fz * f(rho) * sx / rho
 *      Fy = -muY * Fz * f(rho) * sy / rho     (lateral force opposes sideways sliding)
 * So braking hard while cornering uses up the same grip budget (combined slip).
 *
 * Pure functions, SI units.
 */

/** Load sensitivity never drops mu below this fraction (guards against extreme loads). */
const MIN_LOAD_SENSITIVITY_FACTOR = 0.5;
/** Below this combined slip, use the small-slip limit of f(rho)/rho. */
const SMALL_SLIP = 1e-6;

export interface TireParams {
  muX: number;
  muY: number;
  loadSensitivity: number;
  nominalLoad: number;
  peakSlipRatio: number;
  tanPeakSlipAngle: number;
  C: number;
  E: number;
  /** Derived so that the curve peaks exactly at rho = 1 (see solveShapeB). */
  B: number;
}

/**
 * Find B so that sin(C * atan(B*x - E*(B*x - atan(B*x)))) peaks at x = 1.
 * Peak where the inner atan argument equals tan(pi / (2C)). Monotonic in B for E < 1, so bisect.
 */
export function solveShapeB(C: number, E: number): number {
  if (!(C > 1 && C < 2)) throw new Error(`tire shape C must be in (1, 2), got ${C}`);
  if (!(E < 1)) throw new Error(`tire curvature E must be < 1, got ${E}`);
  const target = Math.tan(Math.PI / (2 * C));
  let lo = 0;
  let hi = 1000;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const h = mid - E * (mid - Math.atan(mid));
    if (h < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Normalised magic formula: 0 at 0, peak 1 at rho = 1. */
export function shape(rho: number, B: number, C: number, E: number): number {
  const bx = B * rho;
  return Math.sin(C * Math.atan(bx - E * (bx - Math.atan(bx))));
}

/** Friction coefficient multiplier from load sensitivity (heavier-loaded tires are less efficient). */
export function loadFactor(Fz: number, p: TireParams): number {
  const f = 1 - p.loadSensitivity * (Fz / p.nominalLoad - 1);
  return Math.max(MIN_LOAD_SENSITIVITY_FACTOR, f);
}

export interface TireForce {
  fx: number;
  fy: number;
}

/**
 * @param kappa    longitudinal slip ratio (positive = wheel spinning faster than the road = driving)
 * @param tanAlpha lateral slip, vy / |vx| at the contact patch (positive = sliding left)
 * @param Fz       vertical load, N
 * @param grip     surface grip multiplier (1 = asphalt). Surfaces arrive in M3.
 */
export function tireForce(kappa: number, tanAlpha: number, Fz: number, p: TireParams, grip: number): TireForce {
  if (Fz <= 0) return { fx: 0, fy: 0 };
  const sx = kappa / p.peakSlipRatio;
  const sy = tanAlpha / p.tanPeakSlipAngle;
  const rho = Math.hypot(sx, sy);
  // f(rho)/rho, with its finite limit B*C as rho -> 0.
  const gain = rho < SMALL_SLIP ? p.B * p.C : shape(rho, p.B, p.C, p.E) / rho;
  const mu = loadFactor(Fz, p) * grip;
  return {
    fx: p.muX * mu * Fz * gain * sx,
    fy: -p.muY * mu * Fz * gain * sy,
  };
}
