import { describe, expect, it } from 'vitest';
import { createCarModel } from '../../src/render/carModel';
import { params } from '../sim/helpers';

describe('car model', () => {
  it('stays under the 3,000 triangle budget', () => {
    const p = params('feel');
    const m = createCarModel({ a: p.derived.a, b: p.derived.b, trackFront: p.trackFront, trackRear: p.trackRear, wheelRadius: p.wheelRadius });
    expect(m.triangles).toBeLessThan(3000);
    expect(m.wheels).toHaveLength(4);
  });
});
