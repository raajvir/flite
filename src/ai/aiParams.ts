/**
 * Car parameters for AI drivers: the forgiving "feel" set, minus donut mode, with the
 * stability assist allowing nearly all the grip, plus a performance edge above 100% difficulty.
 * (Donut mode releases the assists at full lock + full throttle at low speed — a
 * deliberate player trick. An AI exiting a slow chicane can hit those exact inputs
 * by accident and spin, so AI cars always keep their assists.)
 */
import { loadCarParams, type CarFile, type CarParams } from '../sim/params';
import { aiBonus } from './difficulty';

/** Lets the AI's stability assist allow turning on (nearly) all the grip: the AI drives smoothly. */
const AI_STABILITY_GRIP_FRACTION = 0.95;

/**
 * @param difficulty 0..1.5; above 1 the AI cars get extra grip and power (a deliberate edge)
 */
export function aiCarParams(file: CarFile, difficulty = 1): CarParams {
  const base = loadCarParams(file, 'feel');
  const b = aiBonus(difficulty);
  return loadCarParams(file, 'feel', {
    assistLockRelease: 0,
    stabilityGripFraction: AI_STABILITY_GRIP_FRACTION,
    tireMuX: base.tireMuX * b.grip,
    tireMuY: base.tireMuY * b.grip,
    powerScale: base.powerScale * b.power,
  });
}
