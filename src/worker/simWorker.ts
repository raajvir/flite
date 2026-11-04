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
import { aiCarParams } from '../ai/aiParams';
import { skillsFor } from '../ai/difficulty';
import { Session, type SessionSnapshot } from '../game/session';
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
/** Rewind history: a snapshot every N steps, keeping this many (100 x 120 = 12 s). */
const HISTORY_EVERY = 100;
const HISTORY_LENGTH = 120;
/** Telemetry sample every N sim steps (10 -> 100 Hz). */
const TELEMETRY_DECIMATION = 10;

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
let paused = false;
type Snap = { t: number; session: SessionSnapshot | null; solo: CarState | null };
let history: Snap[] = [];
let simT = 0;
let telemetry: TelemetryValue[][] = [];

const load = (set: ParamSetName, overrides: ParamOverrides): CarParams => loadCarParams(CAR, set, overrides);

function build(o: StartOptions): void {
  history = [];
  simT = 0;
  const playerParams = load(o.paramSet, o.overrides);
  if (o.track === 'test') {
    session = null;
    solo = { state: initialState({ x: 0, y: 0, z: 0, yaw: 0 }, playerParams.idleRpm, playerParams.ersCapacity), params: playerParams };
    playerIndex = 0;
    return;
  }
  solo = null;
  const world = loadTrack(o.track);
  const aiParams = aiCarParams(CAR);
  const skills = skillsFor(o.aiDifficulty, o.aiCount);
  const setups: { params: CarParams; ai?: { skill: number } }[] = [
    o.autopilot ? { params: aiParams, ai: { skill: skillsFor(o.aiDifficulty, 1)[0]! } } : { params: playerParams },
  ];
  for (const skill of skills) setups.push({ params: aiParams, ai: { skill } });
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
  simT += SIM_DT;
  if (stepCount % HISTORY_EVERY === 0) {
    history.push({ t: simT, session: session ? session.save() : null, solo: solo ? solo.state : null });
    if (history.length > HISTORY_LENGTH) history.shift();
  }
  if (recording && stepCount % TELEMETRY_DECIMATION === 0) {
    const s = playerState();
    if (s) telemetry.push(telemetryRow(s, inputs, surfaceNames));
  }
}

function tick(): void {
  const now = performance.now();
  accumulator += (now - lastWall) / 1000;
  lastWall = now;
  if (paused) accumulator = 0;
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
  if (n > 0) postSnapshot();
  setTimeout(tick, TICK_MS);
}

function postSnapshot(): void {
  const states = session ? session.cars.map((c) => c.state) : solo ? [solo.state] : [];
  const rewindAvailable = history.length ? simT - history[0]!.t : 0;
  ctx.postMessage({ type: 'snapshot', states, playerIndex, race: session ? session.snapshot() : null, stepsPerSecond, paused, rewindAvailable });
}

/** Restore the newest saved moment at least `seconds` ago (or the oldest we have). */
function rewind(seconds: number): void {
  if (!history.length) return;
  const target = simT - seconds;
  let k = history.length - 1;
  while (k > 0 && history[k]!.t > target) k--;
  const snap = history[k]!;
  history = history.slice(0, k + 1);
  simT = snap.t;
  if (session && snap.session) session.restore(snap.session);
  if (solo && snap.solo) solo.state = snap.solo;
  accumulator = 0;
  postSnapshot();
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
    case 'setAIDifficulty':
      if (options) options = { ...options, aiDifficulty: msg.difficulty };
      if (session && options) {
        const skills = skillsFor(msg.difficulty, options.aiCount);
        session.setAISkills(options.autopilot ? [skillsFor(msg.difficulty, 1)[0]!, ...skills] : skills);
      }
      break;
    case 'reset':
      if (session) session.resetCar(playerIndex);
      if (solo) solo.state = initialState({ x: 0, y: 0, z: 0, yaw: 0 }, solo.params.idleRpm, solo.params.ersCapacity);
      break;
    case 'restart':
      if (options) build(options);
      break;
    case 'pause':
      paused = msg.paused;
      postSnapshot();
      break;
    case 'rewind':
      rewind(msg.seconds);
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
