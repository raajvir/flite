/** M1 scene: flat ground, grid, a few cones for speed reference, box car. */
import * as THREE from 'three';

export const PALETTE = {
  sky: 0x9fd3f0,
  ground: 0x7cc46a,
  grid: 0x4a8a3f,
  car: 0xe8452c,
  carNose: 0xffffff,
  cone: 0xff8a1f,
};

const SHADOW_SIZE = 60; // m, half-width of shadow camera box
const GROUND_SIZE = 4000; // m

export interface World {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  car: THREE.Group;
  sun: THREE.DirectionalLight;
}

export function createWorld(canvasParent: HTMLElement, body: { length: number; width: number; height: number }): World {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvasParent.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.sky, 300, 1500);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x6a8a5a, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -SHADOW_SIZE;
  sc.right = SHADOW_SIZE;
  sc.top = SHADOW_SIZE;
  sc.bottom = -SHADOW_SIZE;
  sc.near = 1;
  sc.far = 300;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new THREE.MeshLambertMaterial({ color: PALETTE.ground }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(1000, 100, PALETTE.grid, PALETTE.grid);
  grid.position.y = 0.01;
  scene.add(grid);

  addCones(scene);

  const car = createBoxCar(body);
  scene.add(car);

  return { renderer, scene, car, sun };
}

function addCones(scene: THREE.Scene): void {
  const geo = new THREE.ConeGeometry(0.3, 0.75, 8);
  const mat = new THREE.MeshLambertMaterial({ color: PALETTE.cone, flatShading: true });
  // Two lines of cones down the start straight plus a ring, for a sense of speed and a turning target.
  const positions: [number, number][] = [];
  for (let i = 1; i <= 30; i++) positions.push([-8, -i * 25], [8, -i * 25]);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    positions.push([60 + Math.cos(a) * 30, -150 + Math.sin(a) * 30]);
  }
  for (const [x, z] of positions) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, 0.375, z);
    m.castShadow = true;
    scene.add(m);
  }
}

/** Box car. Group origin = sim reference point (rear axle centre on the ground). */
function createBoxCar(body: { length: number; width: number; height: number }): THREE.Group {
  const g = new THREE.Group();
  const bodyMesh = new THREE.Mesh(
    new THREE.BoxGeometry(body.width, body.height, body.length),
    new THREE.MeshLambertMaterial({ color: PALETTE.car, flatShading: true }),
  );
  // Car extends forwards (-Z) from the rear axle; put rear axle ~0.7 m from the back.
  bodyMesh.position.set(0, body.height / 2 + 0.05, -(body.length / 2 - 0.7));
  bodyMesh.castShadow = true;
  g.add(bodyMesh);

  // White stripe on the nose so you can see which way is forward.
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(body.width * 0.3, 0.05, body.length * 0.35),
    new THREE.MeshLambertMaterial({ color: PALETTE.carNose }),
  );
  nose.position.set(0, body.height + 0.08, -(body.length - 0.7) + body.length * 0.2);
  g.add(nose);
  return g;
}

/** Keep the shadow camera centred on the car so shadows stay sharp. */
export function followSun(sun: THREE.DirectionalLight, x: number, z: number): void {
  sun.position.set(x + 40, 80, z + 25);
  sun.target.position.set(x, 0, z);
}
