/**
 * Telemetry CSV formatting (pure).
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
  'boost_in',
  'gear',
  'rpm',
  'battery_J',
  'ers_deploy_W',
  'steer_angle_rad',
  'yaw_rate_radps',
  'ax_mps2',
  'ay_mps2',
  'sideslip_rad',
  'body_pitch_rad',
  'body_roll_rad',
  ...WHEEL_NAMES.flatMap((w) => PER_WHEEL.map((c) => `${w}_${c}`)),
  ...WHEEL_NAMES.map((w) => `${w}_surface`),
  'x_m',
  'z_m',
  'yaw_rad',
];

export type TelemetryValue = number | string;

/** @param surfaceNames surface name for each surface id (from the surface table) */
export function telemetryRow(s: CarState, i: DriverInputs, surfaceNames: readonly string[] = []): TelemetryValue[] {
  return [
    s.t,
    s.distance,
    Math.hypot(s.u, s.v),
    i.steer,
    i.throttle,
    i.brake,
    i.boost ?? 0,
    s.gear,
    s.rpm,
    s.battery,
    s.ersDeploy,
    s.steerAngle,
    s.yawRate,
    s.axFiltered,
    s.ayFiltered,
    Math.atan2(s.v, Math.max(Math.abs(s.u), 1e-3)),
    s.pitch,
    s.roll,
    ...s.wheels.flatMap((w) => [w.load, w.kappa, Math.atan(w.tanAlpha), w.omega]),
    ...s.wheels.map((w) => surfaceNames[w.surface] ?? String(w.surface)),
    s.x,
    s.z,
    s.yaw,
  ];
}

export function telemetryToCSV(rows: readonly TelemetryValue[][]): string {
  const lines = [TELEMETRY_COLUMNS.join(',')];
  for (const r of rows) lines.push(r.map((v) => (typeof v === 'number' ? Number(v.toFixed(6)) : v)).join(','));
  return lines.join('\n') + '\n';
}
