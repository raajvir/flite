/**
 * AI racing driver. Produces DriverInputs (steer/throttle/brake) exactly like a
 * player, from the car's state and the track — no special physics.
 *
 * 1. Racing line: the track's race_d offset (from the TUMFTM raceline).
 * 2. Speed plan (built once): max cornering speed from line curvature, tire grip
 *    and downforce, then a backward pass for braking zones and a forward pass for
 *    acceleration. `skill` scales how much grip the AI dares to use.
 * 3. Driving: pure-pursuit steering towards a point ahead on the line; throttle/brake
 *    from speed error.
 * 4. Racecraft, in priority order:
 *    - leave space: never squeeze a car that is alongside; keep a car's width, back off if no room
 *    - pass: swing out to pass a slower car ahead, follow at a safe gap if it can't be passed
 *    - defend: when a faster car closes from behind, make ONE move to cover the inside of the
 *      next corner (only when not braking, only while the attacker is still a few metres back),
 *      then hold that line — no late blocking, no weaving.
 *
 * Pure and deterministic (state in, inputs + new AI state out).
 */
import { AIR_DENSITY, GRAVITY } from '../sim/constants';
import type { CarParams } from '../sim/params';
import type { RaceCar } from '../sim/race';
import { steerLock } from '../sim/step';
import type { TrackWorld } from '../sim/trackWorld';
import type { CarState, DriverInputs } from '../sim/types';

export const AI_TUNING = {
  lookaheadBase: 7, // m
  lookaheadPerSpeed: 0.32, // s
  speedLookahead: 0.6, // s: plan speed this far ahead
  maxSpeed: 100, // m/s cap on the plan
  accelPower: 560_000, // W the plan assumes for acceleration
  accelTractionLimit: 11, // m/s^2
  brakeFraction: 0.82, // share of the grip-limited braking the plan uses (before skill)
  throttleGain: 0.35,
  brakeGain: 0.22,
  overtakeLookahead: 35, // m along the track
  overtakeLateral: 3.3, // m beside the car being passed
  carWidthClearance: 2.4, // m: lateral gap that counts as "side by side"
  followGap: 9, // m: closer than this behind a car we can't pass -> match its speed
  followTimeGap: 0.8, // s of closing speed added to followGap (closing fast = back off earlier)
  offsetRate: 2.0, // m/s: how fast the AI moves across the track
  edgeMargin: 1.3, // m from the track edge
  stuckSpeed: 2, // m/s
  stuckTime: 4, // s before asking to be reset onto the track
  wrongWayAngle: 1.6, // rad off the track direction that counts as "lost it" (spun, facing across)
  defendRange: 45, // m: a faster car this close behind is a threat
  defendCommitGap: 8, // m: only start a defensive move while the attacker is at least this far back
  defendEdgeGap: 1.0, // m (beyond edgeMargin) left between the defending car and the inside edge
  defendCornerLookahead: 700, // m: how far ahead to look for the next corner
  defendCornerStep: 25, // m: scan step
  defendMinTurn: 0.3, // rad of heading change ahead that counts as a corner worth defending
  alongsideLength: 6, // m along the track: closer than this = side by side
  sideClearance: 2.6, // m centre-to-centre kept from a car alongside (car width + margin)
  offsetRateUrgent: 4.0, // m/s: moving over to leave space can be quicker than other moves
  yieldCornerLookahead: 80, // m: "are we about to turn?" for deciding who gives way
  yieldMinTurn: 0.25, // rad of heading change ahead that makes it a corner
  yieldSpeedDrop: 3, // m/s below the other car's speed when giving way
  yieldAheadMargin: 2, // m: the outside car only gives way if it isn't ahead by more than this
  yieldMinPlanFraction: 0.6, // giving way never drops below this share of the planned speed
  concedeClearance: 3.2, // m: extra room given to a car that has drawn alongside and got ahead
  concedeSpeedDrop: 2, // m/s below that car's speed while conceding
  ersAttackRange: 60, // m: boost when a car is this close ahead (attack) or behind (defend)
  ersMinCharge: 0.2, // share of battery kept back for attacking/defending
  ersFreeCharge: 0.75, // above this share, boost on any straight
  ersStraightMargin: 5, // m/s: "on a straight" = plan speed ahead is this much above current speed
};

export interface AIProfile {
  /** 0.8 .. 1.0: share of available grip used in the speed plan */
  skill: number;
}

/** Racing personality, 0..1 each (0.5 = the original tuning). */
export interface AIStyle {
  /** How keenly it attacks: pass attempts, following distance, room left, giving way */
  aggression: number;
  /** How keenly it defends against a faster car behind */
  defense: number;
}

export const DEFAULT_STYLE: AIStyle = { aggression: 0.5, defense: 0.5 };

const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.max(0, Math.min(1, k));

/** Style -> concrete racecraft numbers. At 0.5 each these equal the original constants. */
export function styleTuning(st: AIStyle) {
  const a = st.aggression, d = st.defense;
  return {
    overtakeLookahead: lerp(20, 50, a), // m: how far ahead it looks for someone to pass
    passMinClosing: lerp(1, -3, a), // m/s: tries a pass when closing faster than this (negative = even when slightly slower)
    followGap: lerp(12, 6, a), // m
    followTimeGap: lerp(1.1, 0.5, a), // s
    sideClearance: lerp(2.9, 2.3, a), // m centre-to-centre beside another car
    concedeMargin: lerp(-1, 1, a), // m: concedes to a car alongside that is at least this far ahead
    yieldAheadMargin: lerp(3.5, 0.5, a), // m: outside car gives way unless ahead by more than this
    ersAttackRange: lerp(30, 90, a), // m
    defendRange: lerp(0, 90, d), // m: 0 = never defends
    defendCommitGap: lerp(11, 5, d), // m: makes its move while the attacker is at least this far back
    defendEdgeGap: lerp(1.4, 0.6, d), // m left to the inside edge when covering
  };
}

export interface AIState {
  /** Extra lateral offset on top of the racing line (for passing), m */
  offset: number;
  stuckFor: number;
  /** Defensive line being held: +1 = covering the left, -1 = covering the right, 0 = not defending */
  defendSide: number;
}

export const initialAIState = (): AIState => ({ offset: 0, stuckFor: 0, defendSide: 0 });

/**
 * Deceleration the speed plan assumes when braking from speed v (grip incl. downforce,
 * scaled by skill and AI_TUNING.brakeFraction, plus aero drag). Shared with the braking line.
 */
export function planBrakingDecel(p: CarParams, skill: number, v: number): number {
  const muX = p.tireMuX * skill * AI_TUNING.brakeFraction;
  const aeroK = 0.5 * AIR_DENSITY * p.liftArea;
  const dragK = 0.5 * AIR_DENSITY * p.dragArea;
  return (muX * (p.mass * GRAVITY + aeroK * v * v)) / p.mass + (dragK * v * v) / p.mass;
}

/** The tires give a little more than the assist's target before it intervenes. */
const STABILITY_PLAN_MARGIN = 0.1;
/** Crests are judged over +-this many samples (worst = most negative curvature). */
const VERT_SMOOTH = 10;

/** Precomputed racing line + speed plan for one car type and skill. */
export class RacingPlan {
  readonly vmax: Float64Array;
  readonly n: number;
  readonly ds: number;

  constructor(
    readonly world: TrackWorld,
    readonly params: CarParams,
    readonly skill: number,
  ) {
    const p = params;
    const t = AI_TUNING;
    const n = world.n;
    this.n = n;
    this.ds = world.length / n;
    const px = new Float64Array(n), pz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const pt = world.point(world.s[i]!, world.raceD[i]!);
      px[i] = pt.x;
      pz[i] = pt.z;
    }
    // Curvature of the line (Menger curvature over +-k samples), lightly smoothed.
    const k = 3;
    const kap = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i - k + n) % n, c = (i + k) % n;
      const ax = px[a]!, az = pz[a]!, bx = px[i]!, bz = pz[i]!, cx = px[c]!, cz = pz[c]!;
      const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
      const ab = Math.hypot(bx - ax, bz - az), bc = Math.hypot(cx - bx, cz - bz), ca = Math.hypot(ax - cx, az - cz);
      kap[i] = (2 * Math.abs(cross)) / Math.max(ab * bc * ca, 1e-9);
    }
    const kSmooth = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (let j = -2; j <= 2; j++) m = Math.max(m, kap[(i + j + n) % n]!);
      kSmooth[i] = m;
    }

    // The stability assist only lets the car turn on a share of its grip: plan within that.
    const lateralShare = p.stabilityAssist > 0 ? Math.min(skill, p.stabilityGripFraction + STABILITY_PLAN_MARGIN) : skill;
    const mu = p.tireMuY * lateralShare;
    const aeroK = 0.5 * AIR_DENSITY * p.liftArea; // downforce = aeroK v^2
    const dragK = 0.5 * AIR_DENSITY * p.dragArea;
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      // Vertical curvature (crest < 0, dip > 0) changes the load: m g -> m (g + v^2 kv).
      let kv = 0;
      for (let j = -VERT_SMOOTH; j <= VERT_SMOOTH; j++) kv = Math.min(kv, world.elevD2[(i + j + n) % n]!);
      // m v^2 kappa = mu (m g + m v^2 kv + aeroK v^2)  =>  v^2 = mu m g / (m kappa - mu aeroK - mu m kv)
      const den = p.mass * kSmooth[i]! - mu * aeroK - mu * p.mass * kv;
      v[i] = den <= 0 ? t.maxSpeed : Math.min(t.maxSpeed, Math.sqrt((mu * p.mass * GRAVITY) / den));
    }
    // Backward pass (braking) and forward pass (acceleration), twice round the loop.
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 2 * n - 1; j >= 0; j--) {
        const i = j % n, nx = (i + 1) % n;
        const vn = v[nx]!;
        const decel = planBrakingDecel(p, skill, vn);
        v[i] = Math.min(v[i]!, Math.sqrt(vn * vn + 2 * decel * this.ds));
      }
      for (let j = 0; j < 2 * n; j++) {
        const i = (j + 1) % n, pr = j % n;
        const vp = v[pr]!;
        const acc = Math.min(t.accelTractionLimit, t.accelPower / (p.mass * Math.max(vp, 5))) - (dragK * vp * vp) / p.mass;
        v[i] = Math.min(v[i]!, Math.sqrt(Math.max(0, vp * vp + 2 * Math.max(acc, 0) * this.ds)));
      }
    }
    this.vmax = v;
  }

  speedAt(s: number): number {
    return this.world.at(this.vmax, s);
  }
}

export interface AIDecision {
  inputs: DriverInputs;
  state: AIState;
  /** True when the car has been stuck long enough to be put back on track. */
  wantsReset: boolean;
}

export function aiDrive(
  car: CarState,
  race: RaceCar,
  plan: RacingPlan,
  p: CarParams,
  ai: AIState,
  others: readonly { car: CarState; race: RaceCar }[],
  dt: number,
  style: AIStyle = DEFAULT_STYLE,
): AIDecision {
  const t = AI_TUNING;
  const st = styleTuning(style);
  const w = plan.world;
  const L = w.length;
  const s = race.s;
  const u = car.u;

  const raceHere = w.at(w.raceD, s);
  const myD = race.d;
  const minD = -w.at(w.wr, s) + t.edgeMargin;
  const maxD = w.at(w.wl, s) - t.edgeMargin;
  const clampD = (d: number) => Math.max(minD, Math.min(maxD, d));
  const vPlanNow = plan.speedAt(s);
  const braking = u > vPlanNow + 2;
  let speedCap = Infinity;
  let desired: number | null = null; // absolute lateral target (null = racing line)

  // --- Pass: a slower car ahead on our line.
  for (const o of others) {
    let gap = o.race.s - s;
    if (gap < -L / 2) gap += L;
    if (gap <= 0 || gap > st.overtakeLookahead) continue;
    const lat = o.race.d - myD;
    if (Math.abs(lat) > t.carWidthClearance + 1) continue;
    if (u - o.car.u > st.passMinClosing) {
      const leftRoom = w.at(w.wl, s) - o.race.d, rightRoom = o.race.d + w.at(w.wr, s);
      const side = leftRoom > rightRoom ? 1 : -1;
      desired = clampD(o.race.d + side * t.overtakeLateral);
    }
    const safeGap = st.followGap + Math.max(0, u - o.car.u) * st.followTimeGap;
    if (gap < safeGap && Math.abs(lat) < t.carWidthClearance) speedCap = Math.min(speedCap, o.car.u - 1);
  }

  // --- Defend: a faster car closing from behind.
  let threatGap = -Infinity; // nearest attacker's gap (negative = behind)
  for (const o of others) {
    let gap = o.race.s - s;
    if (gap < -L / 2) gap += L;
    if (gap >= -1 || gap < -st.defendRange) continue;
    if (o.car.u - u < -0.5) continue; // slower car behind: no threat
    threatGap = Math.max(threatGap, gap);
  }
  let defendSide = threatGap > -Infinity ? ai.defendSide : 0;
  if (desired === null && threatGap > -Infinity) {
    if (defendSide === 0 && !braking && threatGap <= -st.defendCommitGap) {
      // Which way does the next real corner turn? Scan ahead until the heading has changed
      // by a corner's worth (heading increases = turning left = +d side).
      for (let x = t.defendCornerStep; x <= t.defendCornerLookahead; x += t.defendCornerStep) {
        let dh = w.headingAt(s + x) - w.headingAt(s);
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        if (Math.abs(dh) > t.defendMinTurn) {
          defendSide = dh > 0 ? 1 : -1;
          break;
        }
      }
    }
    if (defendSide !== 0) desired = defendSide > 0 ? maxD - st.defendEdgeGap : minD + st.defendEdgeGap;
  }

  // --- Leave space (overrides everything): keep a car's width from anyone alongside.
  let latTarget = desired ?? raceHere;
  let urgent = false;
  for (const o of others) {
    let gap = o.race.s - s;
    if (gap < -L / 2) gap += L;
    if (Math.abs(gap) > t.alongsideLength) continue;
    const side = myD >= o.race.d ? 1 : -1; // which side of them we are on
    // A car alongside that has got its nose ahead has won the position: concede it —
    // more room and a small lift, so a pass that ends with touching wheels doesn't turn into
    // a tug of war.
    const conceding = gap > st.concedeMargin;
    const need = o.race.d + side * (conceding ? t.concedeClearance : st.sideClearance);
    if (conceding) speedCap = Math.min(speedCap, Math.max(o.car.u - t.concedeSpeedDrop, vPlanNow * t.yieldMinPlanFraction));
    // Side by side into a corner: the car on the outside gives way unless clearly ahead.
    // The corner is judged from the point midway between the two cars, so both cars agree on
    // who is inside (judging from each car's own position made both yield in chicanes).
    const sMid = s + gap / 2;
    let turn = w.headingAt(sMid + t.yieldCornerLookahead) - w.headingAt(sMid);
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    // turn > 0 = left-hander, inside = left = +d; we're outside if we're on the other side.
    const outside = Math.abs(turn) > t.yieldMinTurn && Math.sign(turn) !== side;
    if (outside && gap >= -st.yieldAheadMargin) {
      speedCap = Math.min(speedCap, Math.max(o.car.u - t.yieldSpeedDrop, vPlanNow * t.yieldMinPlanFraction));
    }
    if (side > 0 && latTarget < need) {
      latTarget = need;
      urgent = true;
    } else if (side < 0 && latTarget > need) {
      latTarget = need;
      urgent = true;
    }
    // No room on our side and they're level or ahead: back off rather than squeeze.
    const noRoom = side > 0 ? need > maxD + 0.3 : need < minD - 0.3;
    if (noRoom && gap >= -1) speedCap = Math.min(speedCap, o.car.u - 2);
  }
  const desiredOffset = clampD(latTarget) - raceHere;
  const maxStep = (urgent ? t.offsetRateUrgent : t.offsetRate) * dt;
  let offset = ai.offset + Math.max(-maxStep, Math.min(maxStep, desiredOffset - ai.offset));

  // --- Steering: pure pursuit towards a point ahead on (racing line + offset).
  const look = t.lookaheadBase + t.lookaheadPerSpeed * Math.abs(u);
  const sl = s + look;
  const wl = w.at(w.wl, sl), wr = w.at(w.wr, sl);
  let dTarget = Math.max(-wr + t.edgeMargin, Math.min(wl - t.edgeMargin, w.at(w.raceD, sl) + offset));
  // The racing line can swing across the track before the steering point (chicanes): keep the
  // clearance there too, assuming a car alongside follows the line's swing like we do.
  const swing = w.at(w.raceD, sl) - raceHere;
  for (const o of others) {
    let gap = o.race.s - s;
    if (gap < -L / 2) gap += L;
    if (Math.abs(gap) > t.alongsideLength) continue;
    const side = myD >= o.race.d ? 1 : -1;
    const need = o.race.d + swing + side * st.sideClearance;
    if (side > 0) dTarget = Math.max(dTarget, Math.min(need, wl - t.edgeMargin));
    else dTarget = Math.min(dTarget, Math.max(need, -wr + t.edgeMargin));
  }
  offset = dTarget - w.at(w.raceD, sl);
  const target = w.point(sl, dTarget);
  const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw);
  const lx = -Math.cos(car.yaw), lz = Math.sin(car.yaw);
  const dx = target.x - car.x, dz = target.z - car.z;
  const alpha = Math.atan2(dx * lx + dz * lz, dx * fx + dz * fz);
  const wheel = Math.atan((2 * p.wheelbase * Math.sin(alpha)) / look);
  const steer = Math.max(-1, Math.min(1, wheel / steerLock(p, Math.abs(u))));

  // --- Speed.
  const vPlan = Math.min(plan.speedAt(s + Math.max(u, 0) * t.speedLookahead), plan.speedAt(s));
  const vTarget = Math.min(vPlan, speedCap);
  const err = vTarget - u;
  const throttle = err > 0 ? Math.min(1, err * t.throttleGain + 0.2) : 0;
  const brake = err < -1 ? Math.min(1, -err * t.brakeGain) : 0;

  // ERS: boost on straights when attacking or defending, or freely when the battery is full-ish.
  const charge = car.battery / p.ersCapacity;
  const onStraight = throttle >= 0.99 && plan.speedAt(s + 100) > u + t.ersStraightMargin;
  let racing = threatGap > -st.ersAttackRange;
  for (const o of others) {
    let gap = o.race.s - s;
    if (gap < -L / 2) gap += L;
    if (gap > 0 && gap < st.ersAttackRange) racing = true;
  }
  const boost = onStraight && ((racing && charge > t.ersMinCharge) || charge > t.ersFreeCharge) ? 1 : 0;

  // Stuck (stopped) or lost (spun / facing across the track) both count towards a reset.
  const headingErr = Math.abs(Math.atan2(Math.sin(car.yaw - w.headingAt(s)), Math.cos(car.yaw - w.headingAt(s))));
  const lost = Math.abs(u) < t.stuckSpeed || headingErr > t.wrongWayAngle;
  const stuckFor = lost ? ai.stuckFor + dt : 0;
  return {
    inputs: { steer, throttle, brake, boost },
    state: { offset, stuckFor, defendSide },
    wantsReset: stuckFor > t.stuckTime,
  };
}
