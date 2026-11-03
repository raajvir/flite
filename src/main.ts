/** Entry point: wires keyboard -> worker -> interpolation -> renderer. */
import carFile from '../data/cars/box.json';
import { DemoDriver } from './input/demoDriver';
import { KeyboardDriver } from './input/keyboard';
import { CarCamera } from './render/camera';
import { SnapshotInterpolator } from './render/interpolation';
import { createWorld, followSun } from './render/scene';
import type { FromWorker, ToWorker } from './worker/protocol';

const body = {
  length: carFile.body.length.value,
  width: carFile.body.width.value,
  height: carFile.body.height.value,
};

const world = createWorld(document.body, body);
const cam = new CarCamera(window.innerWidth / window.innerHeight);
const keyboard = new KeyboardDriver();
const interp = new SnapshotInterpolator();
const hud = document.getElementById('hud') as HTMLElement;

const worker = new Worker(new URL('./worker/simWorker.ts', import.meta.url), { type: 'module' });
const send = (m: ToWorker) => worker.postMessage(m);

let simRate = 0;
let recording = false;

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const m = e.data;
  if (m.type === 'snapshot') {
    interp.push(m.state);
    simRate = m.stepsPerSecond;
  } else if (m.type === 'telemetryCSV') {
    downloadText(`telemetry-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`, m.csv);
  }
};

const query = new URLSearchParams(location.search);
const paramSet = query.get('set') === 'sim' ? 'sim' : 'feel';
const demo = query.has('demo') ? new DemoDriver() : null;
send({ type: 'start', paramSet });

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'KeyR') send({ type: 'reset' });
  if (e.code === 'KeyC') cam.toggle();
  if (e.code === 'KeyT') {
    recording = !recording;
    send({ type: 'telemetry', recording });
  }
});

window.addEventListener('resize', () => {
  cam.camera.aspect = window.innerWidth / window.innerHeight;
  cam.camera.updateProjectionMatrix();
  world.renderer.setSize(window.innerWidth, window.innerHeight);
});

// Frame timing stats: average fps and worst frame over the last second.
let last = performance.now();
let fpsFrames = 0;
let fpsStart = last;
let fps = 0;
let worstFrameMs = 0;
let worstShown = 0;

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  const kb = keyboard.update(dt);
  send({ type: 'inputs', inputs: demo ? demo.update(dt) : kb });

  const s = interp.sample(dt);
  if (s) {
    world.car.position.set(s.x, s.y, s.z);
    world.car.rotation.y = s.yaw;
    followSun(world.sun, s.x, s.z);
    cam.update(dt, s);
  }
  world.renderer.render(world.scene, cam.camera);

  fpsFrames++;
  worstFrameMs = Math.max(worstFrameMs, dt * 1000);
  if (now - fpsStart >= 1000) {
    fps = (fpsFrames * 1000) / (now - fpsStart);
    worstShown = worstFrameMs;
    fpsFrames = 0;
    fpsStart = now;
    worstFrameMs = 0;
  }
  if (s) {
    hud.textContent =
      `speed  ${(Math.abs(s.u) * 3.6).toFixed(0).padStart(4)} km/h\n` +
      `fps    ${fps.toFixed(0).padStart(4)}   worst ${worstShown.toFixed(1)} ms\n` +
      `sim    ${simRate.toFixed(0).padStart(4)} Hz\n` +
      `set    ${paramSet}   cam ${cam.mode}${demo ? '   DEMO' : ''}` +
      (recording ? '\n● REC telemetry (T to save)' : '');
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function downloadText(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
