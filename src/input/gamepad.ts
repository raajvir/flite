/**
 * Gamepad -> DriverInputs (standard mapping: Xbox/PlayStation layouts).
 * Left stick X = steer, right trigger = throttle, left trigger = brake.
 * Analog inputs need no smoothing; a small deadzone and a gentle curve on
 * steering make small corrections easier.
 */
import type { DriverInputs } from '../sim/types';

export const GAMEPAD_TUNING = {
  deadzone: 0.08,
  steerExponent: 1.5, // >1 = finer control near centre
  triggerDeadzone: 0.03,
};

export class GamepadDriver {
  /** True once the pad has been touched; stays true until the keyboard is used. */
  active = false;

  /** Poll the first connected gamepad. Returns null if none is connected. */
  read(): DriverInputs | null {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const pad = Array.from(pads).find((p) => p && p.connected);
    if (!pad) return null;
    const t = GAMEPAD_TUNING;
    const x = pad.axes[0] ?? 0;
    const mag = Math.max(0, (Math.abs(x) - t.deadzone) / (1 - t.deadzone));
    // Stick left (negative X) = steer left = positive steer in our convention.
    const steer = -Math.sign(x) * Math.pow(mag, t.steerExponent);
    const trig = (i: number) => {
      const v = pad.buttons[i]?.value ?? 0;
      return v < t.triggerDeadzone ? 0 : v;
    };
    const inputs = { steer, throttle: trig(7), brake: trig(6) };
    if (inputs.steer !== 0 || inputs.throttle > 0 || inputs.brake > 0) this.active = true;
    return inputs;
  }
}
