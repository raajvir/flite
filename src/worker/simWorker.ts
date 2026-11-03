/**
 * Sim worker: runs step() at a fixed 1000 Hz, independent of the display.
 *
 * Browsers can't wake a worker every 1 ms, so we use an accumulator:
 * every few ms we look at how much real time has passed and run that many
 * 1 ms steps, then send the newest state to the main thread.
 */
import carFile from '../../data/cars/openwheel.json';
import { SIM_DT } from '../sim/constants';
import { loadCarParams, type CarFile, type CarParams, type ParamOverrides, type ParamSetName } from '../sim/params';
import { step as stepFn } from '../sim/step';
import { telemetryRow, telemetryToCSV } from '../sim/telemetry';
import { initialState, NEUTRAL_INPUTS, type CarState, type DriverInputs } from '../sim/types';
import type { FromWorker, ToWorker } from './protocol';

/** Worker loop period. Browsers clamp timers to ~4 ms anyway. */
const TICK_MS = 4;
/** If the tab stalls (e.g. backgrounded), don't try to catch up more than this. */
const MAX_STEPS_PER_TICK = 250;
/** Telemetry sample every N sim steps (10 -> 100 Hz). */
const TELEMETRY_DECIMATION = 10;
const START_POSE = { x: 0, y: 0, z: 0, yaw: 0 };

const ctx = self as unknown as {
  postMessage(msg: FromWorker): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};

let params: CarParams | null = null;
let state: CarState = initialState(START_POSE);

function load(set: ParamSetName, overrides: ParamOverrides): CarParams {
  return loadCarParams(carFile as unknown as CarFile, set, overrides);
}
let inputs: DriverInputs = { ...NEUTRAL_INPUTS };
let accumulator = 0;
let lastWall = 0;
let stepCount = 0;
let rateWindowStart = 0;
let rateWindowSteps = 0;
let stepsPerSecond = 0;

let recording = false;
let telemetry: number[][] = [];

function tick(): void {
  if (!params) return;
  const now = performance.now();
  accumulator += (now - lastWall) / 1000;
  lastWall = now;

  let n = 0;
  while (accumulator >= SIM_DT && n < MAX_STEPS_PER_TICK) {
    state = step1(state);
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
  if (n > 0) ctx.postMessage({ type: 'snapshot', state, stepsPerSecond });
  setTimeout(tick, TICK_MS);
}

function step1(s: CarState): CarState {
  const next = stepFn(s, inputs, params as CarParams, SIM_DT);
  stepCount++;
  if (recording && stepCount % TELEMETRY_DECIMATION === 0) telemetry.push(telemetryRow(next, inputs));
  return next;
}

ctx.onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'start': {
      const first = params === null;
      params = load(msg.paramSet, msg.overrides);
      if (first) {
        state = initialState(START_POSE, params.idleRpm);
        lastWall = performance.now();
        rateWindowStart = lastWall;
        tick();
      }
      break;
    }
    case 'setParams':
      params = load(msg.paramSet, msg.overrides);
      break;
    case 'inputs':
      inputs = msg.inputs;
      break;
    case 'reset':
      state = initialState(START_POSE, params?.idleRpm ?? 0);
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
