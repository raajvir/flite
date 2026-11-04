/**
 * M2 scene: a flat test area with cone courses.
 * Layout (car starts at the origin facing -Z):
 *   - 800 m straight with braking boards at the end (300/200/100 m)
 *   - slalom (cones every 25 m) beside the straight
 *   - skidpad circle (r = 40 m) and a hairpin, to the left at the far end
 */
import * as THREE from 'three';

export const PALETTE = {
  sky: 0x9fd3f0,
  grass: 0x7cc46a,
  asphalt: 0x6c7077,
  line: 0xf4f4f4,
  cone: 0xff8a1f,
  board: 0xffffff,
  boardText: 0x1b1d21,
};

const SHADOW_SIZE = 40; // m, half-width of shadow camera box
const GROUND_SIZE = 6000; // m

export interface World {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
}

export function createWorld(canvasParent: HTMLElement, testArea = true): World {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // cheaper than PCFSoft, still smooth enough
  canvasParent.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.sky, testArea ? 400 : 700, testArea ? 2200 : 3000);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x6a8a5a, 1.3));
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

  if (testArea) {
    // Asphalt pad covering all the courses (all asphalt in M2; surfaces come in M3),
    // with grass as four strips AROUND it — the two never overlap, so they can't
    // fight for the same pixels (that fight caused the green flashing).
    const pad = { x0: -350, x1: 350, z0: -1000, z1: 100 };
    const H = GROUND_SIZE / 2;
    addFlat(scene, (pad.x0 + pad.x1) / 2, (pad.z0 + pad.z1) / 2, pad.x1 - pad.x0, pad.z1 - pad.z0, PALETTE.asphalt, 0);
    addFlat(scene, (pad.x0 - H) / 2, 0, H + pad.x0, 2 * H, PALETTE.grass, 0); // left
    addFlat(scene, (pad.x1 + H) / 2, 0, H - pad.x1, 2 * H, PALETTE.grass, 0); // right
    addFlat(scene, (pad.x0 + pad.x1) / 2, (pad.z0 - H) / 2, pad.x1 - pad.x0, H + pad.z0, PALETTE.grass, 0); // far
    addFlat(scene, (pad.x0 + pad.x1) / 2, (pad.z1 + H) / 2, pad.x1 - pad.x0, H - pad.z1, PALETTE.grass, 0); // behind
    // Painted lines (the only overlays): start line + lane edges of the main straight.
    addFlat(scene, 0, 0, 14, 0.4, PALETTE.line, 0.02);
    for (const x of [-7, 7]) addFlat(scene, x, -400, 0.25, 800, PALETTE.line, 0.02);

    addCourses(scene);
  }
  return { renderer, scene, sun };
}

/**
 * Flat rectangle on the ground. y > 0 marks an overlay (paint): it's lifted
 * slightly and drawn with a polygon offset so it always wins over what's below.
 */
function addFlat(scene: THREE.Scene, x: number, z: number, w: number, d: number, color: number, y: number): void {
  const overlay = y > 0;
  const mat = new THREE.MeshLambertMaterial({ color, polygonOffset: overlay, polygonOffsetFactor: overlay ? -2 : 0, polygonOffsetUnits: overlay ? -4 : 0 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  scene.add(m);
}

function addCourses(scene: THREE.Scene): void {
  const cones: [number, number][] = [];
  // Main straight edge cones every 50 m.
  for (let i = 1; i <= 16; i++) cones.push([-7.5, -i * 50], [7.5, -i * 50]);
  // Slalom to the right of the straight.
  for (let i = 0; i < 14; i++) cones.push([40, -60 - i * 25]);
  // Skidpad: circle r = 40 m centred left of the far end.
  const skid = { x: -120, z: -700, r: 40 };
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    cones.push([skid.x + Math.cos(a) * skid.r, skid.z + Math.sin(a) * skid.r]);
  }
  addFlat(scene, skid.x, skid.z, 1, 1, PALETTE.line, 0.02);
  // Hairpin apex markers at the far end of the straight.
  for (let i = 0; i < 9; i++) {
    const a = Math.PI + (i / 8) * Math.PI;
    cones.push([-25 + Math.cos(a) * 18, -850 + Math.sin(a) * 18]);
  }

  const geo = new THREE.ConeGeometry(0.3, 0.75, 8);
  const mat = new THREE.MeshLambertMaterial({ color: PALETTE.cone, flatShading: true });
  const inst = new THREE.InstancedMesh(geo, mat, cones.length);
  const m = new THREE.Matrix4();
  cones.forEach(([x, z], i) => inst.setMatrixAt(i, m.makeTranslation(x, 0.375, z)));
  inst.castShadow = true;
  scene.add(inst);

  // Braking boards before the end of the straight (end at z = -800).
  for (const d of [300, 200, 100]) {
    const z = -800 + d;
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 1.2), new THREE.MeshLambertMaterial({ color: PALETTE.board }));
    board.position.set(9, 1.0, z);
    board.castShadow = true;
    scene.add(board);
    // Stripes = hundreds of metres, so 3 stripes = 300 m.
    for (let k = 0; k < d / 100; k++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.0), new THREE.MeshLambertMaterial({ color: PALETTE.boardText }));
      s.position.set(9, 1.35 - k * 0.25, z);
      scene.add(s);
    }
  }
}

/** Keep the shadow camera centred on the car so shadows stay sharp. */
export function followSun(sun: THREE.DirectionalLight, x: number, z: number): void {
  sun.position.set(x + 30, 70, z + 20);
  sun.target.position.set(x, 0, z);
}
