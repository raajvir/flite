/**
 * Scripted demo driver (?demo in the URL). Produces DriverInputs exactly like
 * the keyboard does — proof that anything (later: the AI) can drive the car
 * through the same interface. Script: accelerate down the cone lane, brake,
 * then circle the cone ring, repeat.
 */
import type { DriverInputs } from '../sim/types';

interface Phase { duration: number; inputs: DriverInputs }

const SCRIPT: Phase[] = [
  { duration: 6.0, inputs: { steer: 0, throttle: 1, brake: 0 } },
  { duration: 1.6, inputs: { steer: 0, throttle: 0, brake: 1 } },
  { duration: 9.0, inputs: { steer: -0.55, throttle: 0.55, brake: 0 } },
  { duration: 7.0, inputs: { steer: 0.7, throttle: 0.6, brake: 0 } },
  { duration: 2.5, inputs: { steer: 0, throttle: 0, brake: 1 } },
];
const LENGTH = SCRIPT.reduce((a, p) => a + p.duration, 0);

export class DemoDriver {
  private t = 0;
  update(dt: number): DriverInputs {
    this.t = (this.t + dt) % LENGTH;
    let acc = 0;
    for (const p of SCRIPT) {
      acc += p.duration;
      if (this.t < acc) return { ...p.inputs };
    }
    return { steer: 0, throttle: 0, brake: 0 };
  }
}
