/**
 * Whole-car behaviour. Ranges are "plausible for a modern open-wheel car"
 * sanity envelopes, not real data — M6 validates the sim set against real laps.
 */
import { describe, expect, it } from 'vitest';
import { GRAVITY } from '../../src/sim/constants';
import { COAST, FULL_BRAKE, FULL_THROTTLE, isFiniteState, kmh, params, run, runUntil, start } from './helpers';

describe.each(['sim', 'feel'] as const)('vehicle (%s set)', (set) => {
  const p = params(set);

  it('stays perfectly still with no inputs', () => {
    const s = run(p, start(p), COAST, 5);
    expect(s.u).toBe(0);
    expect(s.v).toBe(0);
    expect(s.x).toBe(0);
    expect(s.z).toBe(0);
  });

  it('accelerates forwards and shifts up through the gears', () => {
    let maxGear = 1;
    const [s, t] = runUntil(p, start(p), FULL_THROTTLE, (s) => {
      maxGear = Math.max(maxGear, s.gear);
      return kmh(s.u) >= 200;
    }, 20);
    expect(t).toBeGreaterThan(3);
    expect(t).toBeLessThan(8);
    expect(maxGear).toBeGreaterThanOrEqual(4);
    expect(s.z).toBeLessThan(0); // forward = -Z
    expect(Math.abs(s.x)).toBeLessThan(0.5); // straight
  });

  it('0-100 km/h in a plausible time', () => {
    const [, t] = runUntil(p, start(p), FULL_THROTTLE, (s) => kmh(s.u) >= 100, 10);
    expect(t).toBeGreaterThan(1.8);
    expect(t).toBeLessThan(4);
  });

  it('top speed is limited by drag to a plausible value', () => {
    const s = run(p, start(p), FULL_THROTTLE, 60);
    expect(kmh(s.u)).toBeGreaterThan(310);
    expect(kmh(s.u)).toBeLessThan(380);
    expect(isFiniteState(s)).toBe(true);
  });

  it('brakes from 300 to 100 km/h hard (downforce helps), staying straight', () => {
    const [fast] = runUntil(p, start(p), FULL_THROTTLE, (s) => kmh(s.u) >= 300, 30);
    let peakDecel = 0;
    const [s, t] = runUntil(p, fast, FULL_BRAKE, (s) => {
      peakDecel = Math.max(peakDecel, -s.axFiltered);
      return kmh(s.u) <= 100;
    }, 10);
    expect(t).toBeLessThan(2.5);
    expect(peakDecel / GRAVITY).toBeGreaterThan(3.5);
    expect(Math.abs(s.yaw)).toBeLessThan(0.05);
  });

  it('brakes to a stop and does not roll back while brake is held at speed', () => {
    const [fast] = runUntil(p, start(p), FULL_THROTTLE, (s) => kmh(s.u) >= 80, 10);
    const [s] = runUntil(p, fast, FULL_BRAKE, (s) => s.u <= 0.6, 10);
    expect(s.u).toBeGreaterThanOrEqual(0);
  });

  it('holding brake at standstill reverses, capped near reverseMaxSpeed', () => {
    const s = run(p, start(p), FULL_BRAKE, 8);
    expect(s.gear).toBe(-1);
    expect(s.u).toBeLessThan(-0.7 * p.reverseMaxSpeed);
    expect(s.u).toBeGreaterThan(-1.2 * p.reverseMaxSpeed);
    expect(s.z).toBeGreaterThan(0);
  });

  it('positive steer turns left', () => {
    const [fast] = runUntil(p, start(p), FULL_THROTTLE, (s) => kmh(s.u) >= 60, 10);
    const s = run(p, fast, { steer: 1, throttle: 0.3, brake: 0 }, 1);
    expect(s.yaw).toBeGreaterThan(0.2);
    expect(s.yawRate).toBeGreaterThan(0);
  });

  it('steady cornering reaches high lateral g at speed (downforce)', () => {
    // Hold ~200 km/h with a speed controller and moderate steer; measure lateral accel.
    const target = 200 / 3.6;
    let peakAy = 0;
    const [fast] = runUntil(p, start(p), FULL_THROTTLE, (s) => s.u >= target, 20);
    run(p, fast, (s) => ({ steer: 1, throttle: s.u < target ? 1 : 0, brake: 0 }), 4, (s) => {
      peakAy = Math.max(peakAy, Math.abs(s.ayFiltered));
    });
    expect(peakAy / GRAVITY).toBeGreaterThan(3);
  });

  it('wheels track road speed smoothly when coasting slowly (no step-to-step flip-flop)', () => {
    const [fast] = runUntil(p, start(p), FULL_THROTTLE, (s) => kmh(s.u) >= 120, 10);
    let [s] = runUntil(p, fast, { steer: 1, throttle: 0, brake: 1 }, (s) => Math.hypot(s.u, s.v) < 0.6, 15);
    s = run(p, s, COAST, 0.5);
    let worst = 0;
    run(p, s, COAST, 0.2, (n) => {
      for (const w of n.wheels) worst = Math.max(worst, Math.abs(w.omega * p.wheelRadius - n.u));
    });
    expect(worst).toBeLessThan(0.05);
  });

  it('survives abuse: full lock + throttle + brake stabbing for 30 s without NaN', () => {
    const s = run(p, start(p), (_s, t) => ({
      steer: Math.sin(t * 3) > 0 ? 1 : -1,
      throttle: Math.sin(t * 1.3) > -0.3 ? 1 : 0,
      brake: Math.sin(t * 0.7) > 0.8 ? 1 : 0,
    }), 30);
    expect(isFiniteState(s)).toBe(true);
    expect(Math.abs(s.u)).toBeLessThan(110);
  });

  it('comes to rest after a slide and does not jitter', () => {
    const [fast] = runUntil(p, start(p), FULL_THROTTLE, (s) => kmh(s.u) >= 120, 10);
    // Slide to a stop (stop before reverse engages), then let go of everything.
    let [s] = runUntil(p, fast, { steer: 1, throttle: 0, brake: 1 }, (s) => Math.hypot(s.u, s.v) < 0.6, 15);
    s = run(p, s, COAST, 10);
    expect(Math.abs(s.u)).toBeLessThan(0.05);
    expect(Math.abs(s.v)).toBeLessThan(0.05);
    expect(Math.abs(s.yawRate)).toBeLessThan(0.02);
  });
});

describe('assists (feel vs sim)', () => {
  it('ABS (feel) keeps braking wheels from locking; sim can lock', () => {
    const lockSlip = (set: 'feel' | 'sim') => {
      const p = params(set);
      const [fast] = runUntil(p, start(p), FULL_THROTTLE, (s) => kmh(s.u) >= 100, 10);
      let worst = 0;
      run(p, fast, FULL_BRAKE, 1, (s) => {
        for (const w of s.wheels) worst = Math.min(worst, w.kappa);
      });
      return worst;
    };
    expect(lockSlip('feel')).toBeGreaterThan(-0.3);
    expect(lockSlip('sim')).toBeLessThan(-0.3);
  });

  it('traction control (feel) limits wheelspin at launch; sim spins up', () => {
    const spin = (set: 'feel' | 'sim') => {
      const p = params(set);
      let worst = 0;
      run(p, start(p), FULL_THROTTLE, 1.5, (s) => {
        worst = Math.max(worst, s.wheels[2].kappa, s.wheels[3].kappa);
      });
      return worst;
    };
    expect(spin('feel')).toBeLessThan(0.4); // loose on purpose: a bit of wheelspin is fun
    expect(spin('sim')).toBeGreaterThan(spin('feel'));
  });

  it('feel set: full throttle at full lock from standstill makes a donut', () => {
    const p = params('feel');
    let s = run(p, start(p), { steer: 1, throttle: 1, brake: 0 }, 3);
    let yawSum = 0;
    let maxSpeed = 0;
    let n = 0;
    s = run(p, s, { steer: 1, throttle: 1, brake: 0 }, 4, (x) => {
      yawSum += x.yawRate;
      maxSpeed = Math.max(maxSpeed, Math.hypot(x.u, x.v));
      n++;
    });
    expect(yawSum / n).toBeGreaterThan(1.2); // spinning round, rad/s
    expect(maxSpeed).toBeLessThan(25); // on the spot, not driving off
    expect(isFiniteState(s)).toBe(true);
  });

  it('feel set: holding full lock + full throttle at speed does not break into a drift', () => {
    for (const kmhStart of [80, 140, 200]) {
      const p = params('feel');
      const [fast] = runUntil(p, start(p), FULL_THROTTLE, (s) => kmh(s.u) >= kmhStart, 20);
      let worstBeta = 0;
      let worstRear = 0;
      const tanPeak = Math.tan(p.tirePeakSlipAngle);
      run(p, fast, { steer: 1, throttle: 1, brake: 0 }, 2.5, (s) => {
        worstBeta = Math.max(worstBeta, Math.abs(Math.atan2(s.v, Math.abs(s.u))));
        const rear = (Math.abs(s.wheels[2].tanAlpha) + Math.abs(s.wheels[3].tanAlpha)) / 2;
        worstRear = Math.max(worstRear, rear / tanPeak);
      });
      // A drift = rear tires far past their peak and the car well out of line with its path.
      expect(worstBeta, `sideslip at ${kmhStart} km/h`).toBeLessThan(0.175); // < 10 deg
      expect(worstRear, `rear slip at ${kmhStart} km/h`).toBeLessThan(1.8); // rears not sliding away
    }
  });

  it('feel set recovers from a flick that spins the sim set', () => {
    const spinAngle = (set: 'feel' | 'sim') => {
      const p = params(set);
      const [fast] = runUntil(p, start(p), FULL_THROTTLE, (s) => kmh(s.u) >= 150, 15);
      const s = run(p, fast, (_s, t) => ({ steer: t < 0.5 ? 1 : t < 1.0 ? -1 : 0, throttle: 1, brake: 0 }), 4);
      // Sideslip at the end: small = recovered and pointing where it's going.
      return Math.abs(Math.atan2(s.v, Math.abs(s.u)));
    };
    expect(spinAngle('feel')).toBeLessThan(0.1);
  });
});
