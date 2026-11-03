/**
 * Telemetry CSV formatting (pure). Columns grow as the model grows:
 * gear, per-wheel load, slip and surface arrive in M2/M3.
 */
import type { CarState, DriverInputs } from './types';

export const TELEMETRY_COLUMNS = [
  't_s',
  'distance_m',
  'speed_mps',
  'steer_in',
  'throttle_in',
  'brake_in',
  'steer_angle_rad',
  'yaw_rate_radps',
  'x_m',
  'z_m',
  'yaw_rad',
] as const;

export function telemetryRow(s: CarState, i: DriverInputs): number[] {
  return [s.t, s.distance, s.u, i.steer, i.throttle, i.brake, s.steerAngle, s.yawRate, s.x, s.z, s.yaw];
}

export function telemetryToCSV(rows: readonly number[][]): string {
  const lines = [TELEMETRY_COLUMNS.join(',')];
  for (const r of rows) lines.push(r.map((v) => Number(v.toFixed(6))).join(','));
  return lines.join('\n') + '\n';
}
