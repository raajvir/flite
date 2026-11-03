/** Messages between the main thread and the sim worker. */
import type { ParamSetName } from '../sim/params';
import type { CarState, DriverInputs } from '../sim/types';

export type ToWorker =
  | { type: 'start'; paramSet: ParamSetName }
  | { type: 'setParams'; paramSet: ParamSetName }
  | { type: 'inputs'; inputs: DriverInputs }
  | { type: 'reset' }
  | { type: 'telemetry'; recording: boolean };

export type FromWorker =
  | {
      type: 'snapshot';
      /** Latest sim state (state.t is sim time in s). */
      state: CarState;
      /** Sim steps actually executed per wall-clock second (should read ~1000). */
      stepsPerSecond: number;
    }
  | { type: 'telemetryCSV'; csv: string; rows: number };
