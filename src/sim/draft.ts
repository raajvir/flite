/**
 * Drafting (slipstream). A car running close behind another, roughly in line,
 * sits in its wake: less air resistance (faster on straights) but also less
 * downforce (dirty air, less grip in corners). Strength falls off with distance
 * behind and with lateral offset; the wake widens with distance.
 * Pure and deterministic.
 */
import type { CarParams } from './params';
import type { CarState } from './types';

export interface DraftEffect {
  /** 0 = clean air, 1 = tucked right in behind */
  strength: number;
  dragScale: number;
  liftScale: number;
}

/** Below this distance behind, cars are side-by-side or touching rather than drafting, m. */
const MIN_GAP = 2;
/** Car ahead must be heading within this angle of us to give a tow, rad. */
const MAX_HEADING_DIFF = 0.6;

export function draftEffects(states: readonly CarState[], params: readonly CarParams[]): DraftEffect[] {
  return states.map((me, i) => {
    const p = params[i]!;
    const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
    const lx = -Math.cos(me.yaw), lz = Math.sin(me.yaw);
    let best = 0;
    for (let j = 0; j < states.length; j++) {
      if (j === i) continue;
      const o = states[j]!;
      const dx = o.x - me.x, dz = o.z - me.z;
      const ahead = dx * fx + dz * fz;
      if (ahead < MIN_GAP || ahead > p.draftLength) continue;
      const dh = Math.atan2(Math.sin(o.yaw - me.yaw), Math.cos(o.yaw - me.yaw));
      if (Math.abs(dh) > MAX_HEADING_DIFF) continue;
      const lateral = Math.abs(dx * lx + dz * lz);
      const width = p.draftWidth + p.draftSpread * ahead;
      if (lateral >= width) continue;
      const k = (1 - ahead / p.draftLength) * (1 - lateral / width);
      best = Math.max(best, k);
    }
    return { strength: best, dragScale: 1 - p.draftMaxDragReduction * best, liftScale: 1 - p.draftMaxLiftLoss * best };
  });
}
