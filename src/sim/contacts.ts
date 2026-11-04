/**
 * Car-to-car contact. Each car is two circles (front and rear) of radius
 * collisionRadius. Overlapping circles push apart with a spring-damper force
 * plus a little sliding friction. Pure and deterministic; results are body-frame
 * ExternalForces fed into step().
 */
import type { CarParams } from './params';
import type { ContactParams } from './surfaces';
import { NO_FORCE, type CarState, type ExternalForce } from './types';

interface Circle {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** offset from the CG, world */
  rx: number;
  rz: number;
}

function circles(s: CarState, p: CarParams): [Circle, Circle] {
  const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
  const lx = -Math.cos(s.yaw), lz = Math.sin(s.yaw);
  // CG velocity in world.
  const vx = s.u * fx + s.v * lx, vz = s.u * fz + s.v * lz;
  const make = (sign: number): Circle => {
    const rx = sign * p.collisionOffset * fx, rz = sign * p.collisionOffset * fz;
    // v_point = v_cg + omega x r, omega about +Y: (omega*rz, -omega*rx)
    return { x: s.x + rx, z: s.z + rz, vx: vx + s.yawRate * rz, vz: vz - s.yawRate * rx, rx, rz };
  };
  return [make(1), make(-1)];
}

export function carContacts(states: readonly CarState[], params: readonly CarParams[], c: ContactParams): ExternalForce[] {
  const n = states.length;
  const fx = new Float64Array(n), fz = new Float64Array(n), tq = new Float64Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    const si = states[i]!, pi = params[i]!;
    for (let j = i + 1; j < n; j++) {
      const sj = states[j]!, pj = params[j]!;
      const reach = pi.collisionOffset + pj.collisionOffset + pi.collisionRadius + pj.collisionRadius;
      if (Math.abs(si.x - sj.x) > reach || Math.abs(si.z - sj.z) > reach) continue;
      const ci = circles(si, pi), cj = circles(sj, pj);
      const rsum = pi.collisionRadius + pj.collisionRadius;
      for (const a of ci) {
        for (const b of cj) {
          const dx = b.x - a.x, dz = b.z - a.z;
          const dist = Math.hypot(dx, dz);
          const overlap = rsum - dist;
          if (overlap <= 0 || dist < 1e-6) continue;
          any = true;
          const nx = dx / dist, nz = dz / dist;
          const rvx = b.vx - a.vx, rvz = b.vz - a.vz;
          const vn = rvx * nx + rvz * nz; // < 0 = approaching
          const N = Math.max(0, c.carStiffness * overlap - c.carDamping * vn);
          const tx = rvx - vn * nx, tz = rvz - vn * nz;
          const vt = Math.hypot(tx, tz);
          const f = vt > 0.2 ? (c.carFriction * N) / vt : (c.carFriction * N) / 0.2;
          // Force on b: +N n - friction along its relative sliding; on a: the opposite.
          const Fx = N * nx - f * tx, Fz = N * nz - f * tz;
          fx[j]! += Fx;
          fz[j]! += Fz;
          tq[j]! += b.rz * Fx - b.rx * Fz;
          fx[i]! -= Fx;
          fz[i]! -= Fz;
          tq[i]! += a.rz * -Fx - a.rx * -Fz;
        }
      }
    }
  }
  if (!any) return states.map(() => NO_FORCE);
  return states.map((s, i) => {
    const fwdX = -Math.sin(s.yaw), fwdZ = -Math.cos(s.yaw);
    const leftX = -Math.cos(s.yaw), leftZ = Math.sin(s.yaw);
    return { fx: fx[i]! * fwdX + fz[i]! * fwdZ, fy: fx[i]! * leftX + fz[i]! * leftZ, mz: tq[i]! };
  });
}
