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

describe('car model proportions (mid-90s open-wheeler)', () => {
  it('is about 4.45 m long, 2.0 m wide and under 1 m tall', async () => {
    const THREE = await import('three');
    const p = params('feel');
    const m = createCarModel({ a: p.derived.a, b: p.derived.b, trackFront: p.trackFront, trackRear: p.trackRear, wheelRadius: p.wheelRadius });
    m.root.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(m.root).getSize(new THREE.Vector3());
    expect(size.z).toBeGreaterThan(4.35);
    expect(size.z).toBeLessThan(4.55);
    expect(size.x).toBeGreaterThan(1.9);
    expect(size.x).toBeLessThanOrEqual(2.0);
    expect(size.y).toBeLessThan(1.0);
  });
});
