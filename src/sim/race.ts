/** Race bookkeeping: laps, lap times, positions (pure). */
import type { TrackWorld } from './trackWorld';

export interface RaceCar {
  /** Distance along the track at the last update, m */
  s: number;
  /** Lateral offset, m (left +) */
  d: number;
  /** Total progress = completed laps * length + s (negative before crossing the line the first time) */
  progress: number;
  lap: number;
  lapStart: number;
  lastLap: number | null;
  bestLap: number | null;
  finished: boolean;
  finishTime: number | null;
  /** Sector splits of the lap in progress (null = not reached yet) */
  sectors: (number | null)[];
  lastSectors: (number | null)[];
  bestSectors: (number | null)[];
  /** Sector the car is in (0..SECTORS-1) and when it entered it */
  sectorIdx: number;
  sectorStart: number;
}

/** Laps are split into this many equal-length sectors. */
export const SECTORS = 3;
const emptySectors = () => Array<number | null>(SECTORS).fill(null);

/** Window around the line used to detect a forward crossing, m. */
const LINE_WINDOW = 200;

export function newRaceCar(world: TrackWorld, x: number, z: number): RaceCar {
  const p = world.project(x, z);
  // Grid slots sit just behind the line, so they start "before" lap 1.
  const behind = p.s > world.length - LINE_WINDOW;
  return {
    s: p.s,
    d: p.d,
    progress: behind ? p.s - world.length : p.s,
    lap: 0,
    lapStart: 0,
    lastLap: null,
    bestLap: null,
    finished: false,
    finishTime: null,
    sectors: emptySectors(),
    lastSectors: emptySectors(),
    bestSectors: emptySectors(),
    sectorIdx: 0,
    sectorStart: 0,
  };
}

const best = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));

export function updateRaceCar(rc: RaceCar, world: TrackWorld, x: number, z: number, t: number, laps: number, y?: number): RaceCar {
  const p = world.project(x, z, y);
  const L = world.length;
  let ds = p.s - rc.s;
  if (ds < -L / 2) ds += L;
  if (ds > L / 2) ds -= L;
  const next: RaceCar = { ...rc, s: p.s, d: p.d, progress: rc.progress + ds };
  const crossedForward = rc.s > L - LINE_WINDOW && p.s < LINE_WINDOW;
  const crossedBack = rc.s < LINE_WINDOW && p.s > L - LINE_WINDOW;
  // Sectors: crossing into the next third of the lap closes the current sector.
  const sIdx = Math.min(SECTORS - 1, Math.floor(p.s / (L / SECTORS)));
  if (rc.lap >= 1 && !crossedForward && sIdx === rc.sectorIdx + 1) {
    next.sectors = rc.sectors.slice();
    next.sectors[rc.sectorIdx] = t - rc.sectorStart;
    next.sectorIdx = sIdx;
    next.sectorStart = t;
  }
  if (crossedForward) {
    if (rc.lap >= 1) {
      const lt = t - rc.lapStart;
      next.lastLap = lt;
      next.bestLap = rc.bestLap === null ? lt : Math.min(rc.bestLap, lt);
      const done = rc.sectors.slice();
      done[SECTORS - 1] = t - rc.sectorStart;
      next.lastSectors = done;
      next.bestSectors = rc.bestSectors.map((b, k) => best(b, done[k] ?? null));
    }
    next.sectors = emptySectors();
    next.sectorIdx = 0;
    next.sectorStart = t;
    next.lap = rc.lap + 1;
    next.lapStart = t;
    if (next.lap > laps && !rc.finished) {
      next.finished = true;
      next.finishTime = t;
    }
  } else if (crossedBack) {
    next.lap = Math.max(0, rc.lap - 1);
  }
  return next;
}

/** Car indices sorted by race order (finished cars by finish time, then by progress). */
export function standings(cars: readonly RaceCar[]): number[] {
  return cars
    .map((c, i) => i)
    .sort((a, b) => {
      const ca = cars[a]!, cb = cars[b]!;
      if (ca.finished && cb.finished) return ca.finishTime! - cb.finishTime!;
      if (ca.finished !== cb.finished) return ca.finished ? -1 : 1;
      return cb.progress - ca.progress;
    });
}
