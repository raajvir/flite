import { describe, expect, it } from 'vitest';
import { aiCarParams } from '../../src/ai/aiParams';
import { RacingPlan } from '../../src/ai/aiDriver';
import { Session } from '../../src/game/session';
import { DriverAssist } from '../../src/input/driverAssist';
import { loadTrack } from '../../src/sim/tracks';
import { initialState } from '../../src/sim/types';
import { CAR, params } from '../sim/helpers';

const world = await loadTrack('monza');
const feel = params('feel');
const NONE = { steer: 0, throttle: 0, brake: 0 };

describe('sector times', () => {
  it('a completed lap has three sectors that add up to the lap time', () => {
    const sess = new Session(world, [{ params: aiCarParams(CAR), ai: { skill: 0.9 } }], 3, 0);
    while (sess.t < 260 && sess.cars[0]!.race.lap < 3) sess.step(NONE);
    const r = sess.cars[0]!.race;
    const sum = r.lastSectors.reduce<number>((a, b) => a + (b ?? NaN), 0);
    expect(sum).toBeCloseTo(r.lastLap!, 1);
    expect(sess.snapshot().bestSectorsOverall.every((x) => x !== null)).toBe(true);
  }, 60_000);
});

describe('hot lap', () => {
  it('starts alone before the line at speed and shows a delta from the second lap', () => {
    const sess = new Session(world, [{ params: aiCarParams(CAR), ai: { skill: 0.9 } }], 999, 0, undefined, { distance: 400, speed: 45 });
    expect(sess.cars[0]!.state.u).toBe(45);
    while (sess.t < 260 && sess.cars[0]!.race.lap < 3) sess.step(NONE);
    for (let i = 0; i < 20_000; i++) sess.step(NONE);
    expect(sess.snapshot().cars[0]!.delta).not.toBeNull();
    expect(Math.abs(sess.snapshot().cars[0]!.delta!)).toBeLessThan(3); // same AI, near-identical laps
  }, 60_000);
});

describe('ghost cars', () => {
  it('in ghost mode overlapping cars feel nothing', () => {
    const sess = new Session(world, [{ params: feel }, { params: feel }], 1, 0);
    sess.contactMode = 'ghost';
    sess.cars[1]!.state = { ...sess.cars[0]!.state, x: sess.cars[0]!.state.x + 1 };
    const before = sess.cars[1]!.state.x;
    sess.step(NONE);
    expect(Math.abs(sess.cars[1]!.state.x - before)).toBeLessThan(1e-3);
  });
});

describe('driving aids', () => {
  const assist = new DriverAssist(world);
  const plan = new RacingPlan(world, feel, 0.85);
  assist.plan = plan;

  it('steering assist pulls a car drifting off the left edge back to the right', () => {
    assist.steering = 1;
    const s = 300, d = world.at(world.wl, s) - 0.5;
    const pt = world.point(s, d);
    // Pointing slightly left (off the track), at 40 m/s.
    const car = { ...initialState({ x: pt.x, y: 0, z: pt.z, yaw: world.headingAt(s) + 0.08 }), u: 40 };
    const out = assist.apply({ steer: 0, throttle: 1, brake: 0 }, car);
    expect(out.steer).toBeLessThan(-0.1);
    assist.steering = 0;
    expect(assist.apply({ steer: 0, throttle: 1, brake: 0 }, car).steer).toBe(0);
  });

  it('braking assist brakes when arriving at the first chicane too fast', () => {
    assist.braking = 1;
    const s = 840;
    const pt = world.point(s, world.at(world.raceD, s));
    const car = { ...initialState({ x: pt.x, y: 0, z: pt.z, yaw: world.headingAt(s) }), u: 85 };
    const out = assist.apply({ steer: 0, throttle: 1, brake: 0 }, car);
    expect(out.brake).toBeGreaterThan(0.3);
    expect(out.throttle).toBeLessThan(0.7);
    assist.braking = 0;
  });
});
