/**
 * Car parameter loading. Car files (data/cars/*.json) store every value as
 * { value, unit, source } so guesses are visibly marked "estimate".
 * This module flattens one parameter set ("feel" or "sim") to plain numbers
 * and fails loudly if anything is missing.
 */

export type ParamSetName = 'feel' | 'sim';

export interface ParamEntry {
  value: number;
  unit: string;
  source: string;
  note?: string;
}

/** Parameters for the M1 kinematic bicycle model. */
export interface CarParams {
  mass: number;
  wheelbase: number;
  maxSteerAngle: number;
  steerRate: number;
  engineForce: number;
  brakeForce: number;
  reverseForce: number;
  maxReverseSpeed: number;
  dragCoefficient: number;
  rollingResistanceCoefficient: number;
  maxLateralAcceleration: number;
}

const REQUIRED_KEYS: readonly (keyof CarParams)[] = [
  'mass',
  'wheelbase',
  'maxSteerAngle',
  'steerRate',
  'engineForce',
  'brakeForce',
  'reverseForce',
  'maxReverseSpeed',
  'dragCoefficient',
  'rollingResistanceCoefficient',
  'maxLateralAcceleration',
];

export interface CarFile {
  name: string;
  body: Record<string, ParamEntry>;
  sets: Record<string, Record<string, ParamEntry>>;
}

export function loadCarParams(file: CarFile, set: ParamSetName): CarParams {
  const raw = file.sets[set];
  if (!raw) throw new Error(`Car "${file.name}" has no "${set}" parameter set`);
  const out: Partial<CarParams> = {};
  for (const key of REQUIRED_KEYS) {
    const entry = raw[key];
    if (!entry || typeof entry.value !== 'number' || !Number.isFinite(entry.value)) {
      throw new Error(`Car "${file.name}" set "${set}": missing or invalid "${key}"`);
    }
    out[key] = entry.value;
  }
  return out as CarParams;
}
