/**
 * Cameras. All smoothing uses 1 - exp(-rate * dt) so it behaves the same at 60 Hz and 120 Hz.
 */
import * as THREE from 'three';

export type CameraMode = 'chase' | 'nose';

export const CHASE_TUNING = {
  distance: 7.5, // m behind
  height: 2.6, // m above
  lookAhead: 4.0, // m in front of the car
  lookHeight: 0.6, // m
  yawFollowRate: 6.0, // 1/s: how fast the camera swings round behind the car
  positionRate: 14.0, // 1/s
  baseFov: 62, // deg
  fovPerSpeed: 0.18, // extra deg per m/s, gives a sense of speed
  maxFov: 82,
};

export const NOSE_TUNING = { forward: 0.8, height: 1.05, fov: 72 };

const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

export class CarCamera {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'chase';
  private camYaw = 0;
  private readonly pos = new THREE.Vector3();
  private initialised = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CHASE_TUNING.baseFov, aspect, 0.1, 3000);
  }

  toggle(): void {
    this.mode = this.mode === 'chase' ? 'nose' : 'chase';
    this.initialised = false;
  }

  update(dt: number, car: { x: number; y: number; z: number; yaw: number; u: number }): void {
    const cam = this.camera;
    if (this.mode === 'nose') {
      const fx = -Math.sin(car.yaw);
      const fz = -Math.cos(car.yaw);
      cam.position.set(car.x + fx * NOSE_TUNING.forward, car.y + NOSE_TUNING.height, car.z + fz * NOSE_TUNING.forward);
      cam.lookAt(car.x + fx * 50, car.y + NOSE_TUNING.height * 0.8, car.z + fz * 50);
      this.setFov(NOSE_TUNING.fov);
      return;
    }

    const c = CHASE_TUNING;
    if (!this.initialised) {
      this.camYaw = car.yaw;
      this.initialised = true;
    } else {
      this.camYaw += angleDiff(car.yaw, this.camYaw) * damp(c.yawFollowRate, dt);
    }
    const bx = car.x + Math.sin(this.camYaw) * c.distance;
    const bz = car.z + Math.cos(this.camYaw) * c.distance;
    const target = new THREE.Vector3(bx, car.y + c.height, bz);
    if (this.pos.lengthSq() === 0) this.pos.copy(target);
    else this.pos.lerp(target, damp(c.positionRate, dt));
    cam.position.copy(this.pos);
    cam.lookAt(
      car.x - Math.sin(car.yaw) * c.lookAhead,
      car.y + c.lookHeight,
      car.z - Math.cos(car.yaw) * c.lookAhead,
    );
    this.setFov(Math.min(c.maxFov, c.baseFov + Math.abs(car.u) * c.fovPerSpeed));
  }

  private setFov(fov: number): void {
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
