/**
 * Original low-poly '90s-style open-wheel car, built from code (no external
 * assets, not a copy of any real car). Deliberately simple: a handful of
 * faceted shapes that read as a silhouette.
 *
 * Group origin = the sim's reference point: centre of gravity, on the ground.
 * Local axes match the sim: forward = -Z, left = -X, up = +Y.
 *
 *   root
 *    ├─ body            pitches/rolls on the suspension
 *    ├─ suspension arms fixed to the wheels (do NOT move with the body)
 *    └─ wheel pivots    front ones steer; wheels spin inside them
 */
import * as THREE from 'three';

export const CAR_COLORS = {
  body: 0xd8352a, // red
  black: 0x1e2024,
  white: 0xf2f2f2,
  tire: 0x55595f,
};

export interface CarGeometryInput {
  /** CG to front axle, m */
  a: number;
  /** CG to rear axle, m */
  b: number;
  trackFront: number;
  trackRear: number;
  wheelRadius: number;
}

export interface CarModel {
  root: THREE.Group;
  /** Pitch/roll applied here (body on its suspension). */
  body: THREE.Group;
  /** Steering pivots (front only) and spinning wheel meshes, in FL, FR, RL, RR order. */
  steerPivots: [THREE.Group, THREE.Group];
  wheels: [THREE.Object3D, THREE.Object3D, THREE.Object3D, THREE.Object3D];
  triangles: number;
}

const WHEEL_SEGMENTS = 10;
const TIRE_WIDTH_FRONT = 0.3;
const TIRE_WIDTH_REAR = 0.38;

/** One loft station: z position and the half-width/top/bottom of a 6-sided section. */
interface Station {
  z: number;
  halfWidth: number;
  top: number;
  bottom: number;
}

const materials = new Map<number, THREE.MeshLambertMaterial>();
function material(color: number): THREE.MeshLambertMaterial {
  let m = materials.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true, side: THREE.DoubleSide });
    materials.set(color, m);
  }
  return m;
}

function mesh(g: THREE.BufferGeometry, color: number): THREE.Mesh {
  const m = new THREE.Mesh(g, material(color));
  m.castShadow = true;
  return m;
}

function box(w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh {
  const m = mesh(new THREE.BoxGeometry(w, h, d), color);
  m.position.set(x, y, z);
  return m;
}

/** Join 6-sided cross-sections into one faceted, flat-shaded shell. */
function loft(stations: Station[], color: number): THREE.Mesh {
  const ring = (s: Station): THREE.Vector3[] => {
    const mid = s.bottom + (s.top - s.bottom) * 0.5;
    return [
      new THREE.Vector3(-s.halfWidth * 0.85, s.bottom, s.z),
      new THREE.Vector3(s.halfWidth * 0.85, s.bottom, s.z),
      new THREE.Vector3(s.halfWidth, mid, s.z),
      new THREE.Vector3(s.halfWidth * 0.8, s.top, s.z),
      new THREE.Vector3(-s.halfWidth * 0.8, s.top, s.z),
      new THREE.Vector3(-s.halfWidth, mid, s.z),
    ];
  };
  const rings = stations.map(ring);
  const pos: number[] = [];
  const push = (...vs: THREE.Vector3[]) => vs.forEach((v) => pos.push(v.x, v.y, v.z));
  for (let i = 0; i < rings.length - 1; i++) {
    const r0 = rings[i]!;
    const r1 = rings[i + 1]!;
    for (let k = 0; k < 6; k++) {
      const a = r0[k]!, b = r0[(k + 1) % 6]!, c = r1[(k + 1) % 6]!, d = r1[k]!;
      push(a, d, c, a, c, b);
    }
  }
  for (const r of [rings[0]!, rings[rings.length - 1]!]) {
    for (let k = 1; k < 5; k++) push(r[0]!, r[k]!, r[k + 1]!);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return mesh(g, color);
}

/** Flat triangle lying on a horizontal plane (cockpit opening). */
function flatTriangle(p: [number, number][], y: number, color: number): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p.flatMap(([x, z]) => [x, y, z]), 3));
  g.computeVertexNormals();
  return mesh(g, color);
}

/** Thin bar between two points (suspension arm). */
function bar(from: THREE.Vector3, to: THREE.Vector3, thickness: number, color: number): THREE.Mesh {
  const len = from.distanceTo(to);
  const m = mesh(new THREE.BoxGeometry(thickness, thickness, len), color);
  m.position.copy(from).add(to).multiplyScalar(0.5);
  m.lookAt(to);
  return m;
}

export function createCarModel(geo: CarGeometryInput): CarModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const zf = -geo.a; // front axle z (forward = -Z)
  const zr = geo.b; // rear axle z
  const R = geo.wheelRadius;
  const C = CAR_COLORS;

  // --- Main body: long sloping nose -> cockpit -> engine cover -> tail.
  body.add(
    loft(
      [
        { z: zf - 0.95, halfWidth: 0.15, top: 0.2, bottom: 0.1 },
        { z: zf, halfWidth: 0.2, top: 0.34, bottom: 0.1 },
        { z: zf + 1.05, halfWidth: 0.32, top: 0.56, bottom: 0.06 },
        { z: zf + 1.95, halfWidth: 0.34, top: 0.6, bottom: 0.06 },
        { z: zr - 0.25, halfWidth: 0.24, top: 0.48, bottom: 0.08 },
        { z: zr + 0.4, halfWidth: 0.14, top: 0.36, bottom: 0.1 },
      ],
      C.body,
    ),
  );

  // --- Sidepods: boxy, with a black intake on the front face.
  for (const side of [-1, 1]) {
    const pod = loft(
      [
        { z: zf + 1.25, halfWidth: 0.24, top: 0.5, bottom: 0.06 },
        { z: zr - 0.85, halfWidth: 0.24, top: 0.48, bottom: 0.06 },
        { z: zr - 0.15, halfWidth: 0.1, top: 0.32, bottom: 0.08 },
      ],
      C.body,
    );
    pod.position.x = side * 0.56;
    body.add(pod);
    body.add(box(0.3, 0.3, 0.02, C.black, side * 0.56, 0.28, zf + 1.24));
  }

  // --- Cockpit: black triangular opening, helmet, white airbox behind.
  body.add(flatTriangle([[0, zf + 0.95], [0.27, zf + 1.95], [-0.27, zf + 1.95]], 0.605, C.black));
  const helmet = mesh(new THREE.IcosahedronGeometry(0.16, 0), C.white);
  helmet.position.set(0, 0.7, zf + 1.6);
  body.add(helmet);
  body.add(box(0.22, 0.07, 0.04, C.black, 0, 0.7, zf + 1.45));
  body.add(
    loft(
      [
        { z: zf + 1.95, halfWidth: 0.17, top: 0.9, bottom: 0.58 },
        { z: zf + 2.35, halfWidth: 0.15, top: 0.84, bottom: 0.58 },
        { z: zf + 2.85, halfWidth: 0.1, top: 0.6, bottom: 0.5 },
      ],
      C.white,
    ),
  );
  body.add(box(0.2, 0.14, 0.02, C.black, 0, 0.77, zf + 1.94));

  // --- Front wing: flat plate with black endplates.
  const fwZ = zf - 0.7;
  body.add(box(1.9, 0.04, 0.5, C.body, 0, 0.1, fwZ));
  for (const side of [-1, 1]) body.add(box(0.04, 0.26, 0.6, C.black, side * 0.95, 0.17, fwZ));

  // --- Rear wing: flat plate with tall black endplates, on a pylon.
  const rwZ = zr + 0.45;
  body.add(box(1.0, 0.04, 0.45, C.body, 0, 0.92, rwZ));
  for (const side of [-1, 1]) body.add(box(0.04, 0.5, 0.6, C.black, side * 0.5, 0.78, rwZ));
  body.add(box(0.06, 0.5, 0.1, C.black, 0, 0.62, rwZ - 0.05));

  // --- Wheels (root level, so they stay on the ground) + arms fixed to them.
  const wheels: THREE.Object3D[] = [];
  const pivots: THREE.Group[] = [];
  const spec: [number, number, number][] = [
    [-geo.trackFront / 2, zf, TIRE_WIDTH_FRONT], // FL (left = -X)
    [geo.trackFront / 2, zf, TIRE_WIDTH_FRONT], // FR
    [-geo.trackRear / 2, zr, TIRE_WIDTH_REAR], // RL
    [geo.trackRear / 2, zr, TIRE_WIDTH_REAR], // RR
  ];
  spec.forEach(([x, z, width], i) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, R, z);
    const tire = mesh(new THREE.CylinderGeometry(R, R, width, WHEEL_SEGMENTS), C.tire);
    tire.geometry.rotateZ(Math.PI / 2); // axle along X
    pivot.add(tire);
    root.add(pivot);
    wheels.push(tire);
    if (i < 2) pivots.push(pivot);

    // Upper and lower arms: from the wheel hub inwards to the body side.
    const hub = new THREE.Vector3(x - Math.sign(x) * width * 0.5, R, z);
    for (const [dy, dz] of [[0.08, 0.18], [-0.1, -0.18]] as const) {
      root.add(bar(hub.clone().setY(R + dy), new THREE.Vector3(Math.sign(x) * 0.25, R + dy, z + dz), 0.035, C.black));
    }
  });

  let triangles = 0;
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const g = o.geometry as THREE.BufferGeometry;
      triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    }
  });

  return {
    root,
    body,
    steerPivots: [pivots[0]!, pivots[1]!],
    wheels: wheels as CarModel['wheels'],
    triangles,
  };
}
