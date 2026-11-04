/**
 * Keyboard -> DriverInputs.
 *
 * Keys are on/off, but a car needs smooth values. Each axis moves towards
 * its target at a limited rate. Steering returns to centre faster than it
 * builds up, and switching direction is quickest of all. That makes quick
 * taps and counter-steer feel responsive without being twitchy.
 */
import type { DriverInputs } from '../sim/types';

/** Rates are in "full axis per second" (1.0 = 0 -> full in 1 s). */
export const KEYBOARD_TUNING = {
  steerBuild: 3.0,
  steerReturn: 6.0,
  steerReverse: 9.0,
  throttleBuild: 6.0,
  throttleRelease: 10.0,
  brakeBuild: 8.0,
  brakeRelease: 12.0,
};

const STEER_LEFT = new Set(['ArrowLeft', 'KeyA']);
const STEER_RIGHT = new Set(['ArrowRight', 'KeyD']);
const THROTTLE = new Set(['ArrowUp', 'KeyW']);
const BRAKE = new Set(['ArrowDown', 'KeyS', 'Space']);
const BOOST = new Set(['ShiftLeft', 'ShiftRight']);
const DRIVING_KEYS = new Set([...STEER_LEFT, ...STEER_RIGHT, ...THROTTLE, ...BRAKE]);

function approach(current: number, target: number, rate: number, dt: number): number {
  const d = target - current;
  const max = rate * dt;
  return current + (d > max ? max : d < -max ? -max : d);
}

export class KeyboardDriver {
  private readonly down = new Set<string>();
  private readonly out: DriverInputs = { steer: 0, throttle: 0, brake: 0 };
  private readonly tuning = KEYBOARD_TUNING;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (DRIVING_KEYS.has(e.code)) e.preventDefault();
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    // Lost focus = release everything, so the car never drives off on its own.
    target.addEventListener('blur', () => this.down.clear());
  }

  private any(keys: Set<string>): boolean {
    for (const k of keys) if (this.down.has(k)) return true;
    return false;
  }

  /** Advance smoothing by dt seconds and return the current inputs. */
  update(dt: number): DriverInputs {
    const t = this.tuning;
    const left = this.any(STEER_LEFT);
    const right = this.any(STEER_RIGHT);
    const steerTarget = (left ? 1 : 0) - (right ? 1 : 0);

    const s = this.out.steer;
    let steerRate: number;
    if (steerTarget === 0) steerRate = t.steerReturn;
    else if (s !== 0 && Math.sign(steerTarget) !== Math.sign(s)) steerRate = t.steerReverse;
    else steerRate = t.steerBuild;
    this.out.steer = approach(s, steerTarget, steerRate, dt);

    const thr = this.any(THROTTLE) ? 1 : 0;
    this.out.throttle = approach(this.out.throttle, thr, thr > this.out.throttle ? t.throttleBuild : t.throttleRelease, dt);
    const brk = this.any(BRAKE) ? 1 : 0;
    this.out.brake = approach(this.out.brake, brk, brk > this.out.brake ? t.brakeBuild : t.brakeRelease, dt);

    return { ...this.out, boost: this.any(BOOST) ? 1 : 0 };
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }
}
