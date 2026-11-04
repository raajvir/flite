/**
 * Sim worker: runs the simulation at a fixed 1000 Hz, independent of the display.
 *
 * Browsers can't wake a worker every 1 ms, so we use an accumulator:
 * every few ms we look at how much real time has passed and run that many
 * 1 ms steps, then send the newest states to the main thread.
 *
 * Two modes: a race on a real track (Session: player + AI cars), or the flat
 * test area with just the player's car.
 */
import carFile from '../../data/cars/openwheel.json';
import { Session } from '../game/session';
import { SIM_DT } from '../sim/constants';
import { loadCarParams, type CarFile, type CarParams, type ParamOverrides, type ParamSetName } from '../sim/params';
import { step } from '../sim/step';
import { telemetryRow, telemetryToCSV, type TelemetryValue } from '../sim/telemetry';
import { loadTrack, surfaceTable } from '../sim/tracks';
import { initialState, NEUTRAL_INPUTS, type CarState, type DriverInputs } from '../sim/types';
import type { FromWorker, StartOptions, ToWorker } from './protocol';

/** Worker loop period. Browsers clamp timers to ~4 ms anyway. */
const TICK_MS = 4;
/** If the tab stalls (e.g. backgrounded), don't try to catch up more than this. */
const MAX_STEPS_PER_TICK = 250;
/** Telemetry sample every N sim steps (10 -> 100 Hz). */
const TELEMETRY_DECIMATION = 10;
/** AI skill spread: best to worst. */
const AI_SKILL_MAX = 0.93;
const AI_SKILL_MIN = 0.85;

const ctx = self as unknown as {
  postMessage(msg: FromWorker): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};

const CAR = carFile as unknown as CarFile;
const surfaceNames = surfaceTable().list.map((s) => s.name);

let options: StartOptions | null = null;
let session: Session | null = null;
/** Test-area mode: single car. */
let solo: { state: CarState; params: CarParams } | null = null;
let playerIndex = 0;
let inputs: DriverInputs = { ...NEUTRAL_INPUTS };
let running = false;
let accumulator = 0;
let lastWall = 0;
let stepCount = 0;
let rateWindowStart = 0;
let rateWindowSteps = 0;
let stepsPerSecond = 0;
let recording = false;
let telemetry: TelemetryValue[][] = [];

const load = (set: ParamSetName, overrides: ParamOverrides): CarParams => loadCarParams(CAR, set, overrides);

function build(o: StartOptions): void {
  const playerParams = load(o.paramSet, o.overrides);
  if (o.track === 'test') {
    session = null;
    solo = { state: initialState({ x: 0, y: 0, z: 0, yaw: 0 }, playerParams.idleRpm), params: playerParams };
    playerIndex = 0;
    return;
  }
  solo = null;
  const world = loadTrack(o.track);
  const aiParams = load('feel', {});
  const setups: { params: CarParams; ai?: { skill: number } }[] = [o.autopilot ? { params: aiParams, ai: { skill: AI_SKILL_MAX } } : { params: playerParams }];
  for (let k = 0; k < o.aiCount; k++) {
    const skill = AI_SKILL_MAX - ((AI_SKILL_MAX - AI_SKILL_MIN) * k) / Math.max(1, o.aiCount - 1);
    setups.push({ params: aiParams, ai: { skill } });
  }
  // Player starts at the back of the grid; AI in skill order ahead.
  const grid = setups.map((_, i) => (i === 0 ? o.aiCount : i - 1));
  session = new Session(world, setups, o.laps, 3, grid);
  playerIndex = 0;
}

function playerState(): CarState | null {
  return session ? session.cars[playerIndex]!.state : solo ? solo.state : null;
}

function step1(): void {
  if (session) session.step(inputs);
  else if (solo) solo.state = step(solo.state, inputs, solo.params, SIM_DT);
  stepCount++;
  if (recording && stepCount % TELEMETRY_DECIMATION === 0) {
    const s = playerState();
    if (s) telemetry.push(telemetryRow(s, inputs, surfaceNames));
  }
}

function tick(): void {
  const now = performance.now();
  accumulator += (now - lastWall) / 1000;
  lastWall = now;
  let n = 0;
  while (accumulator >= SIM_DT && n < MAX_STEPS_PER_TICK) {
    step1();
    accumulator -= SIM_DT;
    n++;
  }
  if (n === MAX_STEPS_PER_TICK) accumulator = 0; // drop the backlog instead of spiralling

  rateWindowSteps += n;
  if (now - rateWindowStart >= 1000) {
    stepsPerSecond = (rateWindowSteps * 1000) / (now - rateWindowStart);
    rateWindowStart = now;
    rateWindowSteps = 0;
  }
  if (n > 0) {
    const states = session ? session.cars.map((c) => c.state) : solo ? [solo.state] : [];
    ctx.postMessage({ type: 'snapshot', states, playerIndex, race: session ? session.snapshot() : null, stepsPerSecond });
  }
  setTimeout(tick, TICK_MS);
}

ctx.onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'start':
      options = msg.options;
      build(options);
      if (!running) {
        running = true;
        lastWall = performance.now();
        rateWindowStart = lastWall;
        tick();
      }
      break;
    case 'setParams': {
      if (!options) break;
      options = { ...options, paramSet: msg.paramSet, overrides: msg.overrides };
      const p = load(msg.paramSet, msg.overrides);
      if (session) session.setParams(playerIndex, p);
      if (solo) solo.params = p;
      break;
    }
    case 'inputs':
      inputs = msg.inputs;
      break;
    case 'reset':
      if (session) session.resetCar(playerIndex);
      if (solo) solo.state = initialState({ x: 0, y: 0, z: 0, yaw: 0 }, solo.params.idleRpm);
      break;
    case 'restart':
      if (options) build(options);
      break;
    case 'telemetry':
      if (msg.recording) {
        telemetry = [];
        recording = true;
      } else if (recording) {
        recording = false;
        ctx.postMessage({ type: 'telemetryCSV', csv: telemetryToCSV(telemetry), rows: telemetry.length });
        telemetry = [];
      }
      break;
  }
};
