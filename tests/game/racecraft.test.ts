import { describe, expect, it } from 'vitest';
import { aiDrive, initialAIState, RacingPlan, type AIState } from '../../src/ai/aiDriver';
import { newRaceCar, type RaceCar } from '../../src/sim/race';
import { loadTrack } from '../../src/sim/tracks';
import { initialState, type CarState } from '../../src/sim/types';
import { params } from '../sim/helpers';

const world = loadTrack('monza');
const p = params('feel');
const plan = new RacingPlan(world, p, 0.9);

/** A car placed at track position (s, d) with speed u, plus its race record. */
function placed(s: number, d: number, u: number): { car: CarState; race: RaceCar } {
  const pt = world.point(s, d);
  const car = { ...initialState({ x: pt.x, y: 0, z: pt.z, yaw: world.headingAt(s) }), u };
  return { car, race: { ...newRaceCar(world, pt.x, pt.z), s, d } };
}

/** Run the AI's decision loop for `seconds` with everyone frozen in place; returns the final AI state. */
function think(me: ReturnType<typeof placed>, others: ReturnType<typeof placed>[], seconds = 1, ai: AIState = initialAIState()) {
  let st = ai;
  let last = aiDrive(me.car, me.race, plan, p, st, others, 0.01);
  for (let i = 0; i < seconds * 100; i++) {
    last = aiDrive(me.car, me.race, plan, p, st, others, 0.01);
    st = last.state;
  }
  return last;
}

// Main straight, ~400 m before the first chicane (a right-hander: the inside is the right, d < 0).
const S = 500;
const lineD = world.at(world.raceD, S);

describe('AI defending', () => {
  it('covers the inside of the next corner when a faster car closes from behind', () => {
    const me = placed(S, lineD, 70);
    const attacker = placed(S - 30, lineD, 78);
    const res = think(me, [attacker]);
    expect(res.state.defendSide).toBe(-1); // covering the right (inside of the right-hander)
    expect(res.state.offset).toBeLessThan(-1.5); // and moving there
  });

  it('does not make a late move once the attacker is right behind', () => {
    const me = placed(S, lineD, 70);
    const attacker = placed(S - 5, lineD, 78);
    expect(think(me, [attacker]).state.defendSide).toBe(0);
  });

  it('does not move under braking', () => {
    const me = placed(820, world.at(world.raceD, 820), 85); // into the braking zone, well above plan speed
    const attacker = placed(790, world.at(world.raceD, 790), 88);
    expect(think(me, [attacker]).state.defendSide).toBe(0);
  });

  it('ignores a slower car behind', () => {
    const me = placed(S, lineD, 70);
    const slow = placed(S - 20, lineD, 60);
    expect(think(me, [slow]).state.defendSide).toBe(0);
  });
});

describe('AI leaves space', () => {
  it('moves away from a car alongside, even when it wanted to defend into that side', () => {
    // Start in the middle of the track (offset from the racing line puts us at d = 0).
    const start = { ...initialAIState(), offset: -lineD };
    const me = placed(S, 0, 70);
    const alongsideRight = placed(S, -1.5, 70); // overlapping on our right
    const attacker = placed(S - 30, 0, 78); // would make us defend to the right
    const res = think(me, [alongsideRight, attacker], 1, start);
    expect(res.state.offset).toBeGreaterThan(start.offset + 0.5); // moved LEFT to make room
  });

  it('moves away from a car alongside on the left too', () => {
    const start = { ...initialAIState(), offset: -lineD };
    const me = placed(S, 0, 70);
    const alongsideLeft = placed(S, 1.5, 70);
    const res = think(me, [alongsideLeft], 1, start);
    expect(res.state.offset).toBeLessThan(start.offset - 0.5); // moved RIGHT
  });

  it('lifts off rather than squeezing when there is no room left', () => {
    const maxD = world.at(world.wl, S) - 1.3;
    const me = placed(S, maxD, 70); // against the left edge
    const right = placed(S + 0.5, maxD - 1.2, 70); // alongside, slightly ahead, on our right
    const res = think(me, [right], 0.2);
    expect(res.inputs.throttle).toBe(0);
  });
});

describe('a full AI race', () => {
  it('reversed grid: everyone finishes, nobody is pushed off, barely any contact after the opening lap', async () => {
    const { Session } = await import('../../src/game/session');
    const { skillsFor } = await import('../../src/ai/difficulty');
    const { carContacts } = await import('../../src/sim/contacts');
    const { aiCarParams } = await import('../../src/ai/aiParams');
    const { CAR } = await import('../sim/helpers');
    const ap = aiCarParams(CAR);
    const skills = skillsFor(0.8, 6);
    const sess = new Session(world, skills.map((skill) => ({ params: ap, ai: { skill } })), 2, 0, [5, 4, 3, 2, 1, 0]);
    let worstOff = 0;
    let lateContact = 0;
    while (sess.t < 260 && !sess.cars.every((c) => c.race.finished)) {
      sess.step({ steer: 0, throttle: 0, brake: 0 });
      if (Math.round(sess.t * 1000) % 50 !== 0) continue;
      for (const c of sess.cars) {
        const edge = c.race.d >= 0 ? world.at(world.wl, c.race.s) : world.at(world.wr, c.race.s);
        worstOff = Math.max(worstOff, Math.abs(c.race.d) - edge);
      }
      if (sess.t > 40) {
        const ext = carContacts(sess.cars.map((c) => c.state), sess.cars.map((c) => c.params), world.surfaces.contact);
        if (ext.some((e) => e.fx !== 0 || e.fy !== 0)) lateContact++;
      }
    }
    expect(sess.cars.every((c) => c.race.finished)).toBe(true);
    expect(worstOff).toBeLessThan(4);
    expect(lateContact * 0.05).toBeLessThan(1); // < 1 s of (light) contact in total after lap 1
  }, 120_000);
});
