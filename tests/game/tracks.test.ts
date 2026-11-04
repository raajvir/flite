import { describe, expect, it } from 'vitest';
import { aiCarParams } from '../../src/ai/aiParams';
import { Session } from '../../src/game/session';
import { CIRCUITS, loadTrack, TRACKS } from '../../src/sim/tracks';
import { CAR } from '../sim/helpers';

const ap = aiCarParams(CAR);

describe.each(CIRCUITS)('%s', (name) => {
  const world = loadTrack(name);

  it('length is within 1% of the official length', () => {
    const official = (TRACKS[name].track as { official_length_m: number }).official_length_m;
    expect(Math.abs(world.length - official) / official).toBeLessThan(0.01);
  });

  it('the AI laps it without leaving the track, in a sensible time', () => {
    const sess = new Session(world, [{ params: ap, ai: { skill: 0.9 } }], 2, 0);
    let worstOff = -Infinity;
    let worstJump = 0;
    let lastY = sess.cars[0]!.state.y;
    while (sess.t < 260 && !sess.cars[0]!.race.finished) {
      sess.step({ steer: 0, throttle: 0, brake: 0 });
      const c = sess.cars[0]!;
      const edge = c.race.d >= 0 ? world.at(world.wl, c.race.s) : world.at(world.wr, c.race.s);
      worstOff = Math.max(worstOff, Math.abs(c.race.d) - edge);
      worstJump = Math.max(worstJump, Math.abs(c.state.y - lastY));
      lastY = c.state.y;
    }
    const lap = sess.cars[0]!.race.lastLap;
    expect(lap).not.toBeNull();
    expect(lap! / (world.length / 1000)).toBeGreaterThan(12); // s per km: not impossibly fast
    expect(lap! / (world.length / 1000)).toBeLessThan(25); // not crawling
    expect(worstOff).toBeLessThan(1.5);
    expect(worstJump).toBeLessThan(0.2); // height is continuous: never snaps to another level
  }, 120_000);
});

describe('elevation', () => {
  it('the Belgian circuit has its big climb (~100 m)', () => {
    const w = loadTrack('spa');
    expect(Math.max(...w.elev) - Math.min(...w.elev)).toBeGreaterThan(80);
  });

  it('the Japanese circuit crosses itself on a bridge with clearance', () => {
    const w = loadTrack('suzuka');
    const x = (TRACKS.suzuka.track as { crossovers: { s_over: number; s_under: number; clearance_m: number }[] }).crossovers[0]!;
    expect(w.at(w.elev, x.s_over) - w.at(w.elev, x.s_under)).toBeGreaterThan(x.clearance_m - 0.5);
    // At the crossing point a car's height picks the right level.
    const p = w.point(x.s_under, 0);
    expect(Math.abs(w.project(p.x, p.z, w.at(w.elev, x.s_under)).s - x.s_under)).toBeLessThan(5);
    expect(Math.abs(w.project(p.x, p.z, w.at(w.elev, x.s_over)).s - x.s_over)).toBeLessThan(5);
  });
});
