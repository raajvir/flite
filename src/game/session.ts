/**
 * A race session: several cars on one track, stepped together at 1000 Hz.
 * Pure TypeScript (no DOM), deterministic, used by the worker and by tests.
 *
 * Per step: car-to-car contacts -> AI decisions (every AI_EVERY steps) -> physics
 * step for every car -> race bookkeeping (every RACE_EVERY steps).
 */
import { aiDrive, DEFAULT_STYLE, initialAIState, RacingPlan, type AIState, type AIStyle } from '../ai/aiDriver';
import { SIM_DT } from '../sim/constants';
import { carContacts } from '../sim/contacts';
import { draftEffects, type DraftEffect } from '../sim/draft';
import type { CarParams } from '../sim/params';
import { newRaceCar, SECTORS, standings, updateRaceCar, type RaceCar } from '../sim/race';
import { step } from '../sim/step';
import type { TrackWorld } from '../sim/trackWorld';
import { initialState, NEUTRAL_INPUTS, type CarState, type DriverInputs } from '../sim/types';

const AI_EVERY = 10; // AI thinks at 100 Hz
const CHECKPOINT = 50; // m between timing checkpoints (for gaps)
const RACE_EVERY = 10; // laps/positions at 100 Hz
const GRID_ROW_SPACING = 8; // m between grid slots
const GRID_STAGGER = 3; // m left/right of the centreline
const GRID_BEHIND_LINE = 10; // m from the line to pole position

export interface CarSetup {
  params: CarParams;
  /** Absent = player-controlled */
  ai?: { skill: number };
}

export interface SessionCar {
  state: CarState;
  params: CarParams;
  race: RaceCar;
  inputs: DriverInputs;
  ai: { plan: RacingPlan; state: AIState } | null;
}

/**
 * Everything needed to put the session back to an earlier moment (for rewind).
 * Car states, race records and AI states are never mutated in place (each step makes
 * new objects), so a snapshot only needs references, not deep copies.
 */
/** How cars interact: full contact, contact with collision assist, or ghosts (pass through, no tow). */
export type ContactMode = 'full' | 'assisted' | 'ghost';

/** Hot lap: a single car starting this far before the line, already at speed. */
export interface FlyingStart {
  distance: number;
  speed: number;
}

export interface SessionSnapshot {
  t: number;
  steps: number;
  timing: { first: Map<number, number>; carCp: number[]; carCpTime: number[] };
  traces: { trace: number[]; best: number[] | null; delta: number | null }[];
  cars: { state: CarState; race: RaceCar; inputs: DriverInputs; aiState: AIState | null }[];
}

export interface RaceSnapshot {
  t: number;
  countdown: number;
  laps: number;
  order: number[];
  cars: {
    lap: number;
    lastLap: number | null;
    bestLap: number | null;
    lapTime: number;
    finished: boolean;
    draft: number;
    /** Time behind the leader at the latest common checkpoint, s (0 for the leader) */
    gap: number;
    sectors: (number | null)[];
    lastSectors: (number | null)[];
    bestSectors: (number | null)[];
    /** Live time difference to this car's best lap at the same point (negative = faster), s */
    delta: number | null;
  }[];
  /** Fastest time anyone has done in each sector */
  bestSectorsOverall: (number | null)[];
  /** Fastest lap of the race so far: car index and time */
  fastest: { car: number; time: number } | null;
}

export class Session {
  readonly cars: SessionCar[];
  private readonly plans = new Map<string, RacingPlan>();
  /** Racing personality shared by all AI cars. */
  style: AIStyle = { ...DEFAULT_STYLE };
  contactMode: ContactMode = 'full';
  /** Per car: times through the current lap at each checkpoint, the best lap's, and the live delta. */
  private traces: { trace: number[]; best: number[] | null; delta: number | null }[] = [];
  /** Latest slipstream effect per car (for the HUD). */
  drafts: DraftEffect[] = [];
  /** Timing: first time any car reached each checkpoint, and each car's latest checkpoint + time. */
  private firstAt = new Map<number, number>();
  private carCp: number[] = [];
  private carCpTime: number[] = [];
  private steps = 0;
  t = 0;

  constructor(
    readonly world: TrackWorld,
    setups: CarSetup[],
    readonly laps = 3,
    readonly countdown = 3,
    /** Grid slot for each car (default: in setup order) */
    gridOrder?: number[],
    /** Hot lap: start the (single) car before the line at speed instead of from the grid */
    flying?: FlyingStart,
  ) {
    this.cars = setups.map((setup, i) => {
      const slot = gridOrder?.[i] ?? i;
      const s = flying ? world.wrap(-flying.distance) : world.wrap(-GRID_BEHIND_LINE - slot * GRID_ROW_SPACING);
      const d = flying ? world.at(world.raceD, s) : (slot % 2 === 0 ? 1 : -1) * GRID_STAGGER;
      const pos = world.point(s, d);
      const state0 = initialState({ x: pos.x, y: world.heightAt(s, d).h, z: pos.z, yaw: world.headingAt(s) }, setup.params.idleRpm, setup.params.ersCapacity);
      const state = flying ? { ...state0, u: flying.speed, gear: 5 } : state0;
      let ai: SessionCar['ai'] = null;
      if (setup.ai) ai = { plan: this.planFor(setup.params, setup.ai.skill), state: initialAIState() };
      return { state, params: setup.params, race: newRaceCar(world, pos.x, pos.z), inputs: { ...NEUTRAL_INPUTS }, ai };
    });
  }

  private planFor(p: CarParams, skill: number): RacingPlan {
    const key = `${skill.toFixed(4)}`;
    let plan = this.plans.get(key);
    if (!plan) this.plans.set(key, (plan = new RacingPlan(this.world, p, skill)));
    return plan;
  }

  /** Change AI skills mid-session (one value per AI car, in car order). */
  setAISkills(skills: number[]): void {
    let k = 0;
    for (const c of this.cars) {
      if (!c.ai) continue;
      const skill = skills[k++];
      if (skill !== undefined) c.ai.plan = this.planFor(c.params, skill);
    }
  }

  get started(): boolean {
    return this.t >= this.countdown;
  }

  /** Advance one fixed step. playerInputs drives every non-AI car. */
  step(playerInputs: DriverInputs): void {
    const dt = SIM_DT;
    const cars = this.cars;
    const go = this.started;

    if (this.steps % AI_EVERY === 0) {
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i]!;
        if (!c.ai) continue;
        if (!go) {
          c.inputs = { ...NEUTRAL_INPUTS };
          continue;
        }
        const others = this.contactMode === 'ghost' ? [] : cars.filter((_, j) => j !== i).map((o) => ({ car: o.state, race: o.race }));
        const dec = aiDrive(c.state, c.race, c.ai.plan, c.params, c.ai.state, others, dt * AI_EVERY, this.style);
        c.inputs = dec.inputs;
        c.ai.state = dec.state;
        if (dec.wantsReset) this.resetCar(i);
      }
    }
    for (const c of cars) if (!c.ai) c.inputs = go ? playerInputs : { ...NEUTRAL_INPUTS };

    const ghost = this.contactMode === 'ghost';
    const states = cars.map((c) => c.state);
    const ext = ghost
      ? states.map(() => ({ fx: 0, fy: 0, mz: 0 }))
      : carContacts(states, cars.map((c) => c.params), this.world.surfaces.contact, this.contactMode === 'full' ? 0 : 1);
    this.drafts = ghost
      ? states.map(() => ({ strength: 0, dragScale: 1, liftScale: 1 }))
      : draftEffects(states, cars.map((c) => c.params));
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i]!;
      const d = this.drafts[i]!;
      c.state = step(c.state, c.inputs, c.params, dt, this.world, { ...ext[i]!, dragScale: d.dragScale, liftScale: d.liftScale });
    }
    this.steps++;
    this.t += dt;
    if (this.steps % RACE_EVERY === 0) {
      cars.forEach((c, i) => {
        c.race = updateRaceCar(c.race, this.world, c.state.x, c.state.z, this.t, this.laps, c.state.y);
        this.updateTrace(i, c.race);
        const cp = Math.floor(c.race.progress / CHECKPOINT);
        if (cp > (this.carCp[i] ?? -Infinity)) {
          this.carCp[i] = cp;
          this.carCpTime[i] = this.t;
          if (!this.firstAt.has(cp)) this.firstAt.set(cp, this.t);
        }
      });
      // Forget checkpoints everyone has passed long ago.
      const oldest = Math.min(...this.carCp) - 4;
      for (const k of this.firstAt.keys()) if (k < oldest) this.firstAt.delete(k);
    }
  }

  /** Live delta to the best lap: times through the lap at each checkpoint, compared like-for-like. */
  private updateTrace(i: number, r: RaceCar): void {
    const tr = (this.traces[i] ??= { trace: [], best: null, delta: null });
    if (r.lap < 1) return;
    const k = Math.floor(r.s / CHECKPOINT);
    const elapsed = this.t - r.lapStart;
    if (k < tr.trace.length - 1) {
      // New lap started: keep the finished lap's trace if it was the best.
      if (r.lastLap !== null && r.lastLap === r.bestLap) tr.best = tr.trace.slice();
      tr.trace = [];
    }
    if (tr.trace[k] === undefined) {
      tr.trace[k] = elapsed;
      const b = tr.best?.[k];
      tr.delta = b === undefined ? null : elapsed - b;
    }
  }

  /** Put a car back on the racing line at its current distance, stopped, facing the right way. */
  resetCar(i: number): void {
    const c = this.cars[i]!;
    const s = c.race.s;
    const d = this.world.at(this.world.raceD, s);
    const pos = this.world.point(s, d);
    const fresh = initialState({ x: pos.x, y: this.world.heightAt(s, d).h, z: pos.z, yaw: this.world.headingAt(s) }, c.params.idleRpm, c.state.battery);
    c.state = { ...fresh, t: c.state.t, distance: c.state.distance };
    if (c.ai) c.ai.state = initialAIState();
  }

  save(): SessionSnapshot {
    return {
      t: this.t,
      steps: this.steps,
      timing: { first: new Map(this.firstAt), carCp: [...this.carCp], carCpTime: [...this.carCpTime] },
      traces: this.traces.map((t) => ({ trace: t.trace.slice(), best: t.best, delta: t.delta })),
      cars: this.cars.map((c) => ({ state: c.state, race: c.race, inputs: c.inputs, aiState: c.ai?.state ?? null })),
    };
  }

  restore(snap: SessionSnapshot): void {
    this.t = snap.t;
    this.steps = snap.steps;
    this.firstAt = new Map(snap.timing.first);
    this.carCp = [...snap.timing.carCp];
    this.carCpTime = [...snap.timing.carCpTime];
    this.traces = snap.traces.map((t) => ({ trace: t.trace.slice(), best: t.best, delta: t.delta }));
    snap.cars.forEach((sc, i) => {
      const c = this.cars[i]!;
      c.state = sc.state;
      c.race = sc.race;
      c.inputs = sc.inputs;
      if (c.ai && sc.aiState) c.ai.state = sc.aiState;
    });
  }

  setParams(i: number, p: CarParams): void {
    this.cars[i]!.params = p;
  }

  snapshot(): RaceSnapshot {
    let fastest: RaceSnapshot['fastest'] = null;
    this.cars.forEach((c, i) => {
      if (c.race.bestLap !== null && (fastest === null || c.race.bestLap < fastest.time)) fastest = { car: i, time: c.race.bestLap };
    });
    const finishes = this.cars.map((c) => c.race.finishTime).filter((t): t is number => t !== null);
    const leaderFinish = finishes.length ? Math.min(...finishes) : null;
    return {
      t: this.t,
      countdown: Math.max(0, this.countdown - this.t),
      laps: this.laps,
      order: standings(this.cars.map((c) => c.race)),
      cars: this.cars.map((c, i) => ({
        lap: c.race.lap,
        lastLap: c.race.lastLap,
        bestLap: c.race.bestLap,
        lapTime: c.race.lap >= 1 ? this.t - c.race.lapStart : 0,
        finished: c.race.finished,
        draft: this.drafts[i]?.strength ?? 0,
        gap: c.race.finished && c.race.finishTime !== null && leaderFinish !== null
          ? c.race.finishTime - leaderFinish
          : this.carCp[i] !== undefined
            ? Math.max(0, this.carCpTime[i]! - (this.firstAt.get(this.carCp[i]!) ?? this.carCpTime[i]!))
            : 0,
        sectors: c.race.sectors,
        lastSectors: c.race.lastSectors,
        bestSectors: c.race.bestSectors,
        delta: this.traces[i]?.delta ?? null,
      })),
      fastest,
      bestSectorsOverall: Array.from({ length: SECTORS }, (_, k) =>
        this.cars.reduce<number | null>((m, c) => {
          const v = c.race.bestSectors[k] ?? null;
          return v === null ? m : m === null ? v : Math.min(m, v);
        }, null),
      ),
    };
  }
}
