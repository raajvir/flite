import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { RacingPlan } from '../../src/ai/aiDriver';
import { BrakingLine } from '../../src/render/brakingLine';
import { loadTrack } from '../../src/sim/tracks';
import { params } from '../sim/helpers';

const world = loadTrack('monza');
const p = params('feel');

function colours(s: number, speed: number) {
  const scene = new THREE.Scene();
  const line = new BrakingLine(scene, world);
  line.setPlan(new RacingPlan(world, p, 0.95), p);
  const at = world.point(s, world.at(world.raceD, s));
  line.update(at.x, at.z, speed);
  const mesh = scene.children[0] as THREE.Mesh;
  const col = (mesh.geometry.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
  let red = 0, yellow = 0, green = 0;
  for (let i = 0; i < col.length; i += 3) {
    const [r, g] = [col[i]!, col[i + 1]!];
    if (r > 0.9 && g < 0.4) red++;
    else if (r > 0.9 && g > 0.7) yellow++;
    else green++;
  }
  return { red, yellow, green };
}

describe('braking line', () => {
  it('shows red ahead when arriving at the first chicane at 300 km/h', () => {
    const late = colours(830, 330 / 3.6); // past the plan's braking point at full speed: must be braking
    expect(late.red).toBeGreaterThan(0);
    const early = colours(500, 300 / 3.6); // ~430 m before: not yet
    expect(early.red).toBe(0);
  });

  it('is all green when crawling', () => {
    const c = colours(750, 10);
    expect(c.red).toBe(0);
    expect(c.yellow).toBe(0);
  });
});
