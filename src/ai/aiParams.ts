/**
 * Car parameters for AI drivers: the forgiving "feel" set, minus donut mode.
 * (Donut mode releases the assists at full lock + full throttle at low speed — a
 * deliberate player trick. An AI exiting a slow chicane can hit those exact inputs
 * by accident and spin, so AI cars always keep their assists.)
 */
import { loadCarParams, type CarFile, type CarParams } from '../sim/params';

export function aiCarParams(file: CarFile): CarParams {
  return loadCarParams(file, 'feel', { assistLockRelease: 0 });
}
