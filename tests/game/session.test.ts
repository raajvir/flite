import { describe, expect, it } from 'vitest';
import { Session } from '../../src/game/session';
import { carContacts } from '../../src/sim/contacts';
import { telemetryRow, TELEMETRY_COLUMNS } from '../../src/sim/telemetry';
import { loadTrack, surfaceTable } from '../../src/sim/tracks';
import { initialState } from '../../src/sim/types';
import { params } from '../sim/helpers';

const world = loadTrack('monza');
const feel = params('feel');
const NONE = { steer: 0, throttle: 0, brake: 0 };

describe('Monza track data', () => {
  it('length is within 1% of the official length', () => {
    expect(Math.abs(world.length - 5793) / 5793).toBeLessThan(0.01);
  });

  it('has kerbs, gravel and camber where authored', () => {
    expect(world.surfaceAt(930, -6.2).name).toMatch(/kerb/); // first chicane, inside kerb
    expect(world.surfaceAt(5300, world.at(world.wl, 5300) + 10).name).toBe('gravel'); // last corner outside
    expect(world.at(world.bank, 5300)).toBeGreaterThan(0.05); // last corner camber
  });
});

describe('race session', () => {
  it('an AI car laps Monza on the track in a sensible time', () => {
    const sess = new Session(world, [{ params: feel, ai: { skill: 0.9 } }], 2, 0);
    let worstOff = -Infinity;
    while (sess.t < 200 && !sess.cars[0]!.race.finished) {
      sess.step(NONE);
      const c = sess.cars[0]!;
      const edge = c.race.d >= 0 ? world.at(world.wl, c.race.s) : world.at(world.wr, c.race.s);
      worstOff = Math.max(worstOff, Math.abs(c.race.d) - edge);
    }
    const lap = sess.cars[0]!.race.lastLap;
    expect(lap).not.toBeNull();
    expect(lap!).toBeGreaterThan(75);
    expect(lap!).toBeLessThan(110);
    expect(worstOff).toBeLessThan(1.5); // never more than a kerb's width off the track
  }, 60_000);

  it('a full field is deterministic', () => {
    const run = () => {
      const setups = [{ params: feel }, ...[0.9, 0.88, 0.86].map((skill) => ({ params: feel, ai: { skill } }))];
      const sess = new Session(world, setups, 3, 1, [3, 0, 1, 2]);
      for (let i = 0; i < 15_000; i++) sess.step({ steer: 0, throttle: 1, brake: 0 });
      return sess.cars.map((c) => c.state);
    };
    expect(run()).toEqual(run());
  }, 60_000);

  it('cars wait for the countdown, then go', () => {
    const sess = new Session(world, [{ params: feel, ai: { skill: 0.9 } }], 1, 2);
    for (let i = 0; i < 1900; i++) sess.step(NONE);
    expect(Math.abs(sess.cars[0]!.state.u)).toBeLessThan(0.01);
    for (let i = 0; i < 2000; i++) sess.step(NONE);
    expect(sess.cars[0]!.state.u).toBeGreaterThan(10);
  });

  it('counts laps and orders cars by progress', () => {
    const sess = new Session(world, [{ params: feel, ai: { skill: 0.92 } }, { params: feel, ai: { skill: 0.85 } }], 3, 0);
    for (let i = 0; i < 30_000; i++) sess.step(NONE);
    const snap = sess.snapshot();
    expect(snap.cars[0]!.lap).toBe(1);
    expect(snap.order).toHaveLength(2);
  }, 60_000);

  it('resetting puts a car back on the racing line, stopped', () => {
    const sess = new Session(world, [{ params: feel }], 1, 0);
    sess.cars[0]!.state = { ...sess.cars[0]!.state, x: sess.cars[0]!.state.x + 30, u: 20 };
    sess.resetCar(0);
    const p = world.project(sess.cars[0]!.state.x, sess.cars[0]!.state.z);
    expect(Math.abs(p.d - world.at(world.raceD, p.s))).toBeLessThan(1);
    expect(sess.cars[0]!.state.u).toBe(0);
  });
});

describe('car-to-car contact', () => {
  it('overlapping cars are pushed apart with equal and opposite forces', () => {
    const a = initialState({ x: 0, y: 0, z: 0, yaw: 0 });
    const b = initialState({ x: 1.5, y: 0, z: 0, yaw: 0 }); // side by side, overlapping
    const [fa, fb] = carContacts([a, b], [feel, feel], surfaceTable().contact);
    // b is to the right (+X) of a; both face -Z so left = -X: a pushed left (+fy), b right (-fy).
    expect(fa!.fy).toBeGreaterThan(0);
    expect(fb!.fy).toBeLessThan(0);
    expect(fa!.fy).toBeCloseTo(-fb!.fy, 6);
  });

  it('cars far apart feel nothing', () => {
    const a = initialState({ x: 0, y: 0, z: 0, yaw: 0 });
    const b = initialState({ x: 50, y: 0, z: 0, yaw: 0 });
    expect(carContacts([a, b], [feel, feel], surfaceTable().contact)).toEqual([
      { fx: 0, fy: 0, mz: 0 },
      { fx: 0, fy: 0, mz: 0 },
    ]);
  });
});

describe('telemetry', () => {
  it('logs the surface under each wheel by name', () => {
    const row = telemetryRow(initialState({ x: 0, y: 0, z: 0, yaw: 0 }), NONE, surfaceTable().list.map((s) => s.name));
    expect(row).toHaveLength(TELEMETRY_COLUMNS.length);
    expect(row[TELEMETRY_COLUMNS.indexOf('FL_surface')]).toBe('asphalt');
  });
});

describe('AI difficulty', () => {
  it('maps 0..1 to a spread of skills, best first', async () => {
    const { skillsFor } = await import('../../src/ai/difficulty');
    const easy = skillsFor(0, 4), hard = skillsFor(1, 4);
    expect(hard[0]).toBeCloseTo(1, 9);
    expect(easy[0]!).toBeLessThan(hard[0]!);
    expect(hard[3]!).toBeLessThan(hard[0]!);
  });

  it('even at 100% difficulty the AI laps Monza without leaving the track', () => {
    const sess = new Session(world, [{ params: feel, ai: { skill: 1.0 } }], 2, 0);
    let worstOff = -Infinity;
    while (sess.t < 200 && !sess.cars[0]!.race.finished) {
      sess.step(NONE);
      const c = sess.cars[0]!;
      const edge = c.race.d >= 0 ? world.at(world.wl, c.race.s) : world.at(world.wr, c.race.s);
      worstOff = Math.max(worstOff, Math.abs(c.race.d) - edge);
    }
    expect(sess.cars[0]!.race.lastLap).not.toBeNull();
    expect(worstOff).toBeLessThan(1.5);
  }, 60_000);

  it('harder AI is faster', () => {
    const lap = (skill: number) => {
      const sess = new Session(world, [{ params: feel, ai: { skill } }], 2, 0);
      while (sess.t < 220 && !sess.cars[0]!.race.finished) sess.step(NONE);
      return sess.cars[0]!.race.lastLap!;
    };
    expect(lap(1.0)).toBeLessThan(lap(0.8) - 2);
  }, 120_000);
});

describe('collision assist', () => {
  it('a car with collision assist gets twisted and dragged much less by contact', async () => {
    const { loadCarParams } = await import('../../src/sim/params');
    const { CAR } = await import('../sim/helpers');
    const noAssist = loadCarParams(CAR, 'sim');
    const assist = loadCarParams(CAR, 'feel');
    // b overlaps a diagonally (front of a against rear of b), moving at different speeds.
    const a = { ...initialState({ x: 0, y: 0, z: 0, yaw: 0 }), u: 60 };
    const b = { ...initialState({ x: 1.6, y: 0, z: -2.2, yaw: 0 }), u: 50 };
    const [fa] = carContacts([a, b], [noAssist, noAssist], surfaceTable().contact);
    const [fa2] = carContacts([a, b], [assist, noAssist], surfaceTable().contact);
    expect(Math.abs(fa2!.mz)).toBeLessThan(Math.abs(fa!.mz) * 0.5); // far less twist from the touch
  });

  it('a single contact can only push so hard', () => {
    const a = initialState({ x: 0, y: 0, z: 0, yaw: 0 });
    const b = initialState({ x: 0.2, y: 0, z: 0, yaw: 0 }); // deeply overlapping
    const [fa] = carContacts([a, b], [feel, feel], surfaceTable().contact);
    expect(Math.hypot(fa!.fx, fa!.fy)).toBeLessThanOrEqual(4 * surfaceTable().contact.carMaxForce + 1);
  });
});
