/**
 * Car parameter loading.
 *
 * Car files (data/cars/*.json) store every value as { value, unit, source } so
 * guesses are visibly marked "estimate". A set may say "inherits": "<other set>"
 * and then list only the values it changes (that's how "feel" is defined on top
 * of "sim"). This module merges, validates and flattens one set to plain numbers,
 * and precomputes derived values so step() stays simple.
 */
import { solveShapeB, type TireParams } from './tire';

export type ParamSetName = 'feel' | 'sim';

export interface ParamEntry {
  value: unknown;
  unit: string;
  source: string;
  note?: string;
}

const NUMBER_KEYS = [
  'collisionAssist',
  'collisionRadius',
  'collisionOffset',
  'mass',
  'yawInertia',
  'wheelbase',
  'weightFront',
  'cgHeight',
  'trackFront',
  'trackRear',
  'rollStiffnessFront',
  'loadTransferLag',
  'bodyPitchGradient',
  'bodyRollGradient',
  'suspensionFrequency',
  'suspensionDamping',
  'wheelRate',
  'wheelDamping',
  'maxWheelLoadSwing',
  'dragArea',
  'liftArea',
  'aeroBalanceFront',
  'draftLength',
  'draftWidth',
  'draftSpread',
  'draftMaxDragReduction',
  'draftMaxLiftLoss',
  'maxSteerAngle',
  'steerRate',
  'steerSpeedFalloff',
  'wheelRadius',
  'wheelInertiaFront',
  'wheelInertiaRear',
  'rollingResistance',
  'tireMuX',
  'tireMuY',
  'tireLoadSensitivity',
  'tireNominalLoad',
  'tirePeakSlipRatio',
  'tirePeakSlipAngle',
  'tireShapeC',
  'tireCurvatureE',
  'tireRelaxationLength',
  'tireLowSpeed',
  'idleRpm',
  'revLimitRpm',
  'engineBrakeTorque',
  'reverseRatio',
  'finalDrive',
  'drivetrainEfficiency',
  'upshiftRpm',
  'downshiftRpm',
  'shiftTime',
  'reverseMaxSpeed',
  'reverseEngageSpeed',
  'ersPower',
  'ersCapacity',
  'ersHarvestPower',
  'ersHarvestMinSpeed',
  'diffLocking',
  'diffMaxLockTorque',
  'brakeMaxTorque',
  'brakeBiasFront',
  'absEnabled',
  'absSlip',
  'tcsEnabled',
  'tcsSlip',
  'stabilityAssist',
  'stabilityGripFraction',
  'stabilityFadeSpeed',
  'assistLockRelease',
  'assistReleaseSpeed',
  'donutMaxSpeed',
] as const;

export type NumberKey = (typeof NUMBER_KEYS)[number];

/** Live tweaks on top of a parameter set (from the tuning panel). */
export type ParamOverrides = Partial<Record<NumberKey, number>>;

export function isNumberKey(k: string): k is NumberKey {
  return (NUMBER_KEYS as readonly string[]).includes(k);
}

export type CarParams = Record<NumberKey, number> & {
  /** [rpm, N*m] points, rpm ascending */
  engineTorqueCurve: [number, number][];
  gearRatios: number[];
  derived: {
    /** CG to front axle, m */
    a: number;
    /** CG to rear axle, m */
    b: number;
    tire: TireParams;
  };
};

export interface CarFile {
  name: string;
  visual: Record<string, ParamEntry>;
  sets: Record<string, Record<string, ParamEntry | string>>;
}

function resolveSet(file: CarFile, set: string, seen: string[] = []): Record<string, ParamEntry> {
  const raw = file.sets[set];
  if (!raw) throw new Error(`Car "${file.name}" has no "${set}" parameter set`);
  if (seen.includes(set)) throw new Error(`Car "${file.name}": inheritance loop ${[...seen, set].join(' -> ')}`);
  const { inherits, ...own } = raw;
  const base = typeof inherits === 'string' ? resolveSet(file, inherits, [...seen, set]) : {};
  return { ...base, ...(own as Record<string, ParamEntry>) };
}

export function loadCarParams(file: CarFile, set: ParamSetName, overrides: ParamOverrides = {}): CarParams {
  const merged = resolveSet(file, set);
  const err = (k: string) => new Error(`Car "${file.name}" set "${set}": missing or invalid "${k}"`);

  const nums = {} as Record<NumberKey, number>;
  for (const key of NUMBER_KEYS) {
    const v = merged[key]?.value;
    if (typeof v !== 'number' || !Number.isFinite(v)) throw err(key);
    nums[key] = v;
  }
  for (const [key, v] of Object.entries(overrides)) {
    if (!isNumberKey(key)) throw new Error(`Unknown parameter override "${key}"`);
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Override "${key}" must be a finite number`);
    nums[key] = v;
  }

  const curve = merged.engineTorqueCurve?.value;
  if (
    !Array.isArray(curve) ||
    curve.length < 2 ||
    !curve.every((pt, i) => Array.isArray(pt) && pt.length === 2 && pt.every(Number.isFinite) && (i === 0 || pt[0] > curve[i - 1][0]))
  ) {
    throw err('engineTorqueCurve');
  }
  const gears = merged.gearRatios?.value;
  if (!Array.isArray(gears) || gears.length < 1 || !gears.every((g) => typeof g === 'number' && g > 0)) {
    throw err('gearRatios');
  }

  const tire: TireParams = {
    muX: nums.tireMuX,
    muY: nums.tireMuY,
    loadSensitivity: nums.tireLoadSensitivity,
    nominalLoad: nums.tireNominalLoad,
    peakSlipRatio: nums.tirePeakSlipRatio,
    tanPeakSlipAngle: Math.tan(nums.tirePeakSlipAngle),
    C: nums.tireShapeC,
    E: nums.tireCurvatureE,
    B: solveShapeB(nums.tireShapeC, nums.tireCurvatureE),
  };

  return {
    ...nums,
    engineTorqueCurve: curve as [number, number][],
    gearRatios: gears as number[],
    derived: {
      a: nums.wheelbase * (1 - nums.weightFront),
      b: nums.wheelbase * nums.weightFront,
      tire,
    },
  };
}

/** Render-only numbers (body size, pitch/roll gains). */
export function loadVisual(file: CarFile): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, e] of Object.entries(file.visual)) {
    if (typeof e.value !== 'number') throw new Error(`Car "${file.name}" visual "${k}" must be a number`);
    out[k] = e.value;
  }
  return out;
}
