/**
 * Tire smoke and skid marks, driven by slideIntensity().
 * Render-only: nothing here feeds back into the simulation.
 */
import * as THREE from 'three';
import type { CarParams } from '../sim/params';
import type { CarState } from '../sim/types';
import { slideIntensity } from './slide';

export const EFFECTS_TUNING = {
  markSegments: 8000, // ring buffer size; oldest marks get reused
  markMinStep: 0.25, // m between mark points
  markWidthFront: 0.26,
  markWidthRear: 0.34,
  markHeight: 0.03, // m above ground (plus polygon offset)
  markColor: 0x26282c,
  markOpacity: 0.55,
  smokePuffs: 300,
  smokeRate: 45, // puffs per second per wheel at full slide
  smokeLife: 1.6, // s
  smokeStartSize: 0.25, // m
  smokeEndSize: 1.6, // m
  smokeRise: 0.7, // m/s
  smokeCarryFraction: 0.15, // share of car velocity the puff keeps
  smokeColor: 0xf3f3f3,
  smokeOpacity: 0.55,
};

interface Puff {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  age: number;
  life: number;
  rot: number;
}

export class TireEffects {
  private readonly t = EFFECTS_TUNING;
  private readonly wheelLocal: [number, number][]; // three-local x, z of each contact patch
  private readonly marks: THREE.Mesh;
  private readonly markPos: Float32Array;
  private markNext = 0;
  private markCount = 0;
  private readonly lastPoint: ({ x: number; z: number } | null)[] = [null, null, null, null];

  private readonly smoke: THREE.InstancedMesh;
  private readonly puffs: Puff[] = [];
  private puffNext = 0;
  private readonly spawnAcc = [0, 0, 0, 0];
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v3 = new THREE.Vector3();
  private readonly s3 = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene, p: CarParams) {
    const a = p.derived.a, b = p.derived.b;
    this.wheelLocal = [
      [-p.trackFront / 2, -a],
      [p.trackFront / 2, -a],
      [-p.trackRear / 2, b],
      [p.trackRear / 2, b],
    ];

    this.markPos = new Float32Array(this.t.markSegments * 6 * 3);
    const g = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(this.markPos, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', attr);
    g.setDrawRange(0, 0);
    this.marks = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        color: this.t.markColor,
        transparent: true,
        opacity: this.t.markOpacity,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -8,
      }),
    );
    this.marks.frustumCulled = false;
    scene.add(this.marks);

    this.smoke = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshLambertMaterial({ color: this.t.smokeColor, flatShading: true, transparent: true, opacity: this.t.smokeOpacity, depthWrite: false }),
      this.t.smokePuffs,
    );
    this.smoke.frustumCulled = false;
    for (let i = 0; i < this.t.smokePuffs; i++) {
      this.puffs.push({ x: 0, y: 0, z: 0, vx: 0, vz: 0, age: 1, life: 0, rot: 0 });
      this.smoke.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
    }
    scene.add(this.smoke);
  }

  /** Number of skid-mark segments laid so far (for tests/debug). */
  get marksLaid(): number {
    return this.markCount;
  }

  /** Smoke puffs currently alive (for tests/debug). */
  get livePuffs(): number {
    return this.puffs.filter((p) => p.age < p.life).length;
  }

  update(dt: number, s: CarState, p: CarParams): void {
    const cos = Math.cos(s.yaw), sin = Math.sin(s.yaw);
    // Car velocity in world (for smoke drift): forward (-sin, -cos)*u + left (-cos, sin)*v
    const vwx = -sin * s.u - cos * s.v;
    const vwz = -cos * s.u + sin * s.v;
    let marksChanged = false;

    for (let i = 0; i < 4; i++) {
      const [lx, lz] = this.wheelLocal[i]!;
      // three's rotation.y = yaw: x' = x cos + z sin, z' = -x sin + z cos
      const wx = s.x + lx * cos + lz * sin;
      const wz = s.z - lx * sin + lz * cos;
      const k = slideIntensity(s, i, p);

      if (k > 0) {
        const last = this.lastPoint[i];
        if (!last) this.lastPoint[i] = { x: wx, z: wz };
        else if (Math.hypot(wx - last.x, wz - last.z) >= this.t.markMinStep) {
          this.addMark(last.x, last.z, wx, wz, i < 2 ? this.t.markWidthFront : this.t.markWidthRear);
          this.lastPoint[i] = { x: wx, z: wz };
          marksChanged = true;
        }
        this.spawnAcc[i]! += k * this.t.smokeRate * dt;
        while (this.spawnAcc[i]! >= 1) {
          this.spawnAcc[i]! -= 1;
          this.spawn(wx, wz, vwx, vwz);
        }
      } else {
        this.lastPoint[i] = null;
        this.spawnAcc[i] = 0;
      }
    }

    if (marksChanged) {
      const g = this.marks.geometry;
      g.attributes.position!.needsUpdate = true;
      g.setDrawRange(0, Math.min(this.markCount, this.t.markSegments) * 6);
    }
    this.updateSmoke(dt);
  }

  private addMark(x0: number, z0: number, x1: number, z1: number, width: number): void {
    const len = Math.hypot(x1 - x0, z1 - z0) || 1;
    const px = (-(z1 - z0) / len) * width * 0.5;
    const pz = ((x1 - x0) / len) * width * 0.5;
    const y = this.t.markHeight;
    const o = this.markNext * 18;
    const v = [
      x0 + px, y, z0 + pz, x0 - px, y, z0 - pz, x1 - px, y, z1 - pz,
      x0 + px, y, z0 + pz, x1 - px, y, z1 - pz, x1 + px, y, z1 + pz,
    ];
    this.markPos.set(v, o);
    this.markNext = (this.markNext + 1) % this.t.markSegments;
    this.markCount++;
  }

  private spawn(x: number, z: number, vx: number, vz: number): void {
    const puff = this.puffs[this.puffNext]!;
    this.puffNext = (this.puffNext + 1) % this.puffs.length;
    const c = this.t.smokeCarryFraction;
    puff.x = x + (Math.random() - 0.5) * 0.3;
    puff.y = 0.2;
    puff.z = z + (Math.random() - 0.5) * 0.3;
    puff.vx = vx * c + (Math.random() - 0.5) * 0.8;
    puff.vz = vz * c + (Math.random() - 0.5) * 0.8;
    puff.age = 0;
    puff.life = this.t.smokeLife * (0.75 + Math.random() * 0.5);
    puff.rot = Math.random() * Math.PI * 2;
  }

  private updateSmoke(dt: number): void {
    const t = this.t;
    for (let i = 0; i < this.puffs.length; i++) {
      const puff = this.puffs[i]!;
      if (puff.age >= puff.life) {
        if (puff.life > 0) {
          this.smoke.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
          puff.life = 0;
        }
        continue;
      }
      puff.age += dt;
      puff.x += puff.vx * dt;
      puff.z += puff.vz * dt;
      puff.y += t.smokeRise * dt;
      const k = Math.min(1, puff.age / puff.life);
      // Grow, then shrink away at the end (stands in for fading out).
      const size = (t.smokeStartSize + (t.smokeEndSize - t.smokeStartSize) * Math.sqrt(k)) * (1 - k * k * k);
      this.q.setFromAxisAngle(this.up, puff.rot);
      this.m4.compose(this.v3.set(puff.x, puff.y + size * 0.5, puff.z), this.q, this.s3.set(size, size * 0.8, size));
      this.smoke.setMatrixAt(i, this.m4);
    }
    this.smoke.instanceMatrix.needsUpdate = true;
  }
}
