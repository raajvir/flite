/** Messages between the main thread and the sim worker. */
import type { RaceSnapshot } from '../game/session';
import type { ParamOverrides, ParamSetName } from '../sim/params';
import type { TrackName } from '../sim/tracks';
import type { CarState, DriverInputs } from '../sim/types';

export interface StartOptions {
  track: TrackName;
  paramSet: ParamSetName;
  overrides: ParamOverrides;
  /** Number of AI opponents (ignored on the test area) */
  aiCount: number;
  laps: number;
  /** The AI drives the player's car too (demo mode) */
  autopilot: boolean;
  /** 0..1 */
  aiDifficulty: number;
}

export type ToWorker =
  | { type: 'start'; options: StartOptions }
  | { type: 'setParams'; paramSet: ParamSetName; overrides: ParamOverrides }
  | { type: 'inputs'; inputs: DriverInputs }
  | { type: 'setAIDifficulty'; difficulty: number }
  /** Put the player back on track (R) */
  | { type: 'reset' }
  /** Restart the race from the grid (Shift+R) */
  | { type: 'restart' }
  | { type: 'telemetry'; recording: boolean };

export type FromWorker =
  | {
      type: 'snapshot';
      /** All cars; states[playerIndex] is the player. state.t is sim time in s. */
      states: CarState[];
      playerIndex: number;
      race: RaceSnapshot | null;
      /** Sim steps actually executed per wall-clock second (should read ~1000). */
      stepsPerSecond: number;
    }
  | { type: 'telemetryCSV'; csv: string; rows: number };
