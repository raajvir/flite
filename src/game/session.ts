/**
 * A race session: several cars on one track, stepped together at 1000 Hz.
 * Pure TypeScript (no DOM), deterministic, used by the worker and by tests.
 *
 * Per step: car-to-car contacts -> AI decisions (every AI_EVERY steps) -> physics
 * step for every car -> race bookkeeping (every RACE_EVERY steps).
 */
import { aiDrive, initialAIState, RacingPlan, type AIState } from '../ai/aiDriver';
import { SIM_DT } from '../sim/constants';
import { carContacts } from '../sim/contacts';
import { draftEffects, type DraftEffect } from '../sim/draft';
import type { CarParams } from '../sim/params';
import { newRaceCar, standings, updateRaceCar, type RaceCar } from '../sim/race';
import { step } from '../sim/step';
import type { TrackWorld } from '../sim/trackWorld';
import { initialState, NEUTRAL_INPUTS, type CarState, type DriverInputs } from '../sim/types';

const AI_EVERY = 10; // AI thinks at 100 Hz
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
export interface SessionSnapshot {
  t: number;
  steps: number;
  cars: { state: CarState; race: RaceCar; inputs: DriverInputs; aiState: AIState | null }[];
}

export interface RaceSnapshot {
  t: number;
  countdown: number;
  laps: number;
  order: number[];
  cars: { lap: number; lastLap: number | null; bestLap: number | null; lapTime: number; finished: boolean; draft: number }[];
}

export class Session {
  readonly cars: SessionCar[];
  private readonly plans = new Map<string, RacingPlan>();
  /** Latest slipstream effect per car (for the HUD). */
  drafts: DraftEffect[] = [];
  private steps = 0;
  t = 0;

  constructor(
    readonly world: TrackWorld,
    setups: CarSetup[],
    readonly laps = 3,
    readonly countdown = 3,
    /** Grid slot for each car (default: in setup order) */
    gridOrder?: number[],
  ) {
    this.cars = setups.map((setup, i) => {
      const slot = gridOrder?.[i] ?? i;
      const s = world.wrap(-GRID_BEHIND_LINE - slot * GRID_ROW_SPACING);
      const d = (slot % 2 === 0 ? 1 : -1) * GRID_STAGGER;
      const pos = world.point(s, d);
      const state = initialState({ x: pos.x, y: 0, z: pos.z, yaw: world.headingAt(s) }, setup.params.idleRpm, setup.params.ersCapacity);
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
        const others = cars.filter((_, j) => j !== i).map((o) => ({ car: o.state, race: o.race }));
        const dec = aiDrive(c.state, c.race, c.ai.plan, c.params, c.ai.state, others, dt * AI_EVERY);
        c.inputs = dec.inputs;
        c.ai.state = dec.state;
        if (dec.wantsReset) this.resetCar(i);
      }
    }
    for (const c of cars) if (!c.ai) c.inputs = go ? playerInputs : { ...NEUTRAL_INPUTS };

    const ext = carContacts(
      cars.map((c) => c.state),
      cars.map((c) => c.params),
      this.world.surfaces.contact,
    );
    this.drafts = draftEffects(
      cars.map((c) => c.state),
      cars.map((c) => c.params),
    );
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i]!;
      const d = this.drafts[i]!;
      c.state = step(c.state, c.inputs, c.params, dt, this.world, { ...ext[i]!, dragScale: d.dragScale, liftScale: d.liftScale });
    }
    this.steps++;
    this.t += dt;
    if (this.steps % RACE_EVERY === 0) {
      for (const c of cars) c.race = updateRaceCar(c.race, this.world, c.state.x, c.state.z, this.t, this.laps);
    }
  }

  /** Put a car back on the racing line at its current distance, stopped, facing the right way. */
  resetCar(i: number): void {
    const c = this.cars[i]!;
    const s = c.race.s;
    const d = this.world.at(this.world.raceD, s);
    const pos = this.world.point(s, d);
    const fresh = initialState({ x: pos.x, y: 0, z: pos.z, yaw: this.world.headingAt(s) }, c.params.idleRpm, c.state.battery);
    c.state = { ...fresh, t: c.state.t, distance: c.state.distance };
    if (c.ai) c.ai.state = initialAIState();
  }

  save(): SessionSnapshot {
    return {
      t: this.t,
      steps: this.steps,
      cars: this.cars.map((c) => ({ state: c.state, race: c.race, inputs: c.inputs, aiState: c.ai?.state ?? null })),
    };
  }

  restore(snap: SessionSnapshot): void {
    this.t = snap.t;
    this.steps = snap.steps;
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
      })),
    };
  }
}
