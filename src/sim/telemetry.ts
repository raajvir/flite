/**
 * Telemetry CSV formatting (pure). Per-wheel surface type arrives in M3.
 */
import { WHEEL_NAMES, type CarState, type DriverInputs } from './types';

const PER_WHEEL = ['load_N', 'slip_ratio', 'slip_angle_rad', 'omega_radps'] as const;

export const TELEMETRY_COLUMNS: readonly string[] = [
  't_s',
  'distance_m',
  'speed_mps',
  'steer_in',
  'throttle_in',
  'brake_in',
  'gear',
  'rpm',
  'steer_angle_rad',
  'yaw_rate_radps',
  'ax_mps2',
  'ay_mps2',
  'sideslip_rad',
  'body_pitch_rad',
  'body_roll_rad',
  ...WHEEL_NAMES.flatMap((w) => PER_WHEEL.map((c) => `${w}_${c}`)),
  'x_m',
  'z_m',
  'yaw_rad',
];

export function telemetryRow(s: CarState, i: DriverInputs): number[] {
  return [
    s.t,
    s.distance,
    Math.hypot(s.u, s.v),
    i.steer,
    i.throttle,
    i.brake,
    s.gear,
    s.rpm,
    s.steerAngle,
    s.yawRate,
    s.axFiltered,
    s.ayFiltered,
    Math.atan2(s.v, Math.max(Math.abs(s.u), 1e-3)),
    s.pitch,
    s.roll,
    ...s.wheels.flatMap((w) => [w.load, w.kappa, Math.atan(w.tanAlpha), w.omega]),
    s.x,
    s.z,
    s.yaw,
  ];
}

export function telemetryToCSV(rows: readonly number[][]): string {
  const lines = [TELEMETRY_COLUMNS.join(',')];
  for (const r of rows) lines.push(r.map((v) => Number(v.toFixed(6))).join(','));
  return lines.join('\n') + '\n';
}
