/** Entry point: wires input -> worker -> interpolation -> renderer. */
import carFile from '../data/cars/openwheel.json';
import { CarSound } from './audio/sound';
import { DemoDriver } from './input/demoDriver';
import { KeyboardDriver } from './input/keyboard';
import { CarCamera } from './render/camera';
import { createCarModel } from './render/carModel';
import { SnapshotInterpolator } from './render/interpolation';
import { createWorld, followSun } from './render/scene';
import { loadCarParams, type CarFile, type ParamSetName } from './sim/params';
import type { CarState } from './sim/types';
import type { FromWorker, ToWorker } from './worker/protocol';

const CAR = carFile as unknown as CarFile;
const query = new URLSearchParams(location.search);
let paramSet: ParamSetName = query.get('set') === 'sim' ? 'sim' : 'feel';
let params = loadCarParams(CAR, paramSet);

const world = createWorld(document.body);
const car = createCarModel({
  a: params.derived.a,
  b: params.derived.b,
  trackFront: params.trackFront,
  trackRear: params.trackRear,
  wheelRadius: params.wheelRadius,
});
world.scene.add(car.root);

const cam = new CarCamera(window.innerWidth / window.innerHeight);
const keyboard = new KeyboardDriver();
const interp = new SnapshotInterpolator();
const demo = query.has('demo') ? new DemoDriver(params) : null;
const hud = document.getElementById('hud') as HTMLElement;

const worker = new Worker(new URL('./worker/simWorker.ts', import.meta.url), { type: 'module' });
const send = (m: ToWorker) => worker.postMessage(m);

const sound = new CarSound();
let simRate = 0;
let recording = false;

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const m = e.data;
  if (m.type === 'snapshot') {
    interp.push(m.state);
    simRate = m.stepsPerSecond;
  } else if (m.type === 'telemetryCSV') {
    downloadText(`telemetry-${paramSet}-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`, m.csv);
  }
};
send({ type: 'start', paramSet });

// Audio needs a user gesture before it may start.
window.addEventListener('pointerdown', () => sound.start());
window.addEventListener('keydown', (e) => {
  sound.start();
  if (e.repeat) return;
  if (e.code === 'KeyM') sound.toggleMute();
  if (e.code === 'KeyR') send({ type: 'reset' });
  if (e.code === 'KeyC') cam.toggle();
  if (e.code === 'KeyP') {
    paramSet = paramSet === 'feel' ? 'sim' : 'feel';
    params = loadCarParams(CAR, paramSet);
    send({ type: 'setParams', paramSet });
  }
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

function applyState(s: CarState): void {
  car.root.position.set(s.x, s.y, s.z);
  car.root.rotation.y = s.yaw;
  // Body on its suspension (from the sim): nose down = +pitch, lean right = +roll.
  car.body.rotation.x = -s.pitch;
  car.body.rotation.z = -s.roll;
  car.steerPivots[0].rotation.y = s.steerAngle;
  car.steerPivots[1].rotation.y = s.steerAngle;
  car.wheels.forEach((w, i) => (w.rotation.x = -s.wheels[i]!.spin));
}

// Frame timing stats: average fps and worst frame over the last second.
let last = performance.now();
let fpsFrames = 0;
let fpsStart = last;
let fps = 0;
let worstFrameMs = 0;
let worstShown = 0;

const slipBar = (w: CarState['wheels'][number]) => {
  const rho = Math.hypot(w.kappa / params.tirePeakSlipRatio, w.tanAlpha / Math.tan(params.tirePeakSlipAngle));
  return rho < 0.6 ? '·' : rho < 1.0 ? 'o' : 'O';
};

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  const kb = keyboard.update(dt);
  const latest = interp.latest();
  const inputs = demo && latest ? demo.update(latest) : kb;
  send({ type: 'inputs', inputs });

  const s = interp.sample(dt);
  if (s) {
    applyState(s);
    followSun(world.sun, s.x, s.z);
    cam.update(dt, s);
    sound.update(s, s.gear < 0 ? inputs.brake : inputs.throttle, {
      peakSlipRatio: params.tirePeakSlipRatio,
      tanPeakSlipAngle: Math.tan(params.tirePeakSlipAngle),
      wheelRadius: params.wheelRadius,
    });
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
    const [fl, fr, rl, rr] = s.wheels;
    hud.textContent =
      `speed  ${(Math.hypot(s.u, s.v) * 3.6).toFixed(0).padStart(4)} km/h   gear ${s.gear < 0 ? 'R' : s.gear}\n` +
      `rpm    ${s.rpm.toFixed(0).padStart(5)}   lat ${(Math.abs(s.ayFiltered) / 9.81).toFixed(1)} g\n` +
      `grip   ${slipBar(fl)} ${slipBar(fr)}   (· ok  o working  O sliding)\n` +
      `       ${slipBar(rl)} ${slipBar(rr)}\n` +
      `fps    ${fps.toFixed(0).padStart(4)}   worst ${worstShown.toFixed(1)} ms\n` +
      `sim    ${simRate.toFixed(0).padStart(4)} Hz\n` +
      `set    ${paramSet} (P)   cam ${cam.mode}${demo ? '   DEMO' : ''}` +
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
