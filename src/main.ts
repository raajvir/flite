/** Entry point: wires input -> worker -> interpolation -> renderer for every car. */
import * as THREE from 'three';
import carFile from '../data/cars/openwheel.json';
import { CarSound } from './audio/sound';
import { DemoDriver } from './input/demoDriver';
import { GamepadDriver } from './input/gamepad';
import { KeyboardDriver } from './input/keyboard';
import { CarCamera } from './render/camera';
import { createCarModel, type CarModel } from './render/carModel';
import { TireEffects } from './render/effects';
import { SnapshotInterpolator } from './render/interpolation';
import { createWorld, followSun } from './render/scene';
import { buildTrackMesh } from './render/trackMesh';
import { loadCarParams, type CarFile, type ParamSetName } from './sim/params';
import { loadTrack, surfaceTable, type TrackName } from './sim/tracks';
import type { TrackWorld } from './sim/trackWorld';
import type { CarState } from './sim/types';
import { TuningPanel } from './ui/tuningPanel';
import type { RaceSnapshot } from './game/session';
import type { FromWorker, ToWorker } from './worker/protocol';

const CAR = carFile as unknown as CarFile;
const query = new URLSearchParams(location.search);
const trackName: TrackName = query.get('track') === 'test' ? 'test' : 'monza';
const aiCount = Math.max(0, Math.min(15, Number(query.get('ai') ?? 7)));
const laps = Math.max(1, Number(query.get('laps') ?? 3));
let paramSet: ParamSetName = query.get('set') === 'sim' ? 'sim' : 'feel';

/** Body colours: player first, then the AI field. */
const CAR_COLORS = [0xd8352a, 0x1f6fd6, 0xf2c418, 0x1fa34a, 0xf07c1b, 0x8e44c9, 0x16b8c4, 0xeeeeee, 0x333840, 0xe85a9b, 0x7a5230, 0x9ad11f, 0x2d3fa3, 0xc0392b, 0x5dade2, 0xa3a3a3];

const defaults = { feel: loadCarParams(CAR, 'feel'), sim: loadCarParams(CAR, 'sim') };
const panel = new TuningPanel({
  getSet: () => paramSet,
  getDefaults: (set) => defaults[set],
  onChange: (set, overrides) => {
    if (set !== paramSet) return;
    params = loadCarParams(CAR, set, overrides);
    send({ type: 'setParams', paramSet: set, overrides });
  },
});
let params = loadCarParams(CAR, paramSet, panel.overrides(paramSet));
if (query.has('tuning')) panel.toggle();

const world = createWorld(document.body, trackName === 'test');
const track: TrackWorld | null = trackName === 'test' ? null : loadTrack(trackName);
if (track) world.scene.add(buildTrackMesh(track));
const surfaces = surfaceTable();
const fog = world.scene.fog;

const cam = new CarCamera(window.innerWidth / window.innerHeight);
const keyboard = new KeyboardDriver();
const gamepad = new GamepadDriver();
const hud = document.getElementById('hud') as HTMLElement;
const center = document.getElementById('center') as HTMLElement;

// ?demo: autopilot (race: the worker's AI drives your car; test area: scripted laps). ?demo=donut on the test area.
const demoMode = query.get('demo');
const testDemo =
  trackName === 'test' && demoMode === 'donut'
    ? { update: () => ({ steer: 1, throttle: 1, brake: 0 }) }
    : trackName === 'test' && demoMode !== null
      ? new DemoDriver(params)
      : null;

// --- Per-car render objects, created when the first snapshot tells us how many cars there are.
interface CarView {
  model: CarModel;
  interp: SnapshotInterpolator;
  effects: TireEffects;
  marker: THREE.Mesh;
  last: CarState | null;
}
const views: CarView[] = [];
function ensureViews(n: number): void {
  while (views.length < n) {
    const i = views.length;
    const model = createCarModel(
      { a: params.derived.a, b: params.derived.b, trackFront: params.trackFront, trackRear: params.trackRear, wheelRadius: params.wheelRadius },
      CAR_COLORS[i % CAR_COLORS.length]!,
    );
    world.scene.add(model.root);
    // Big marker above each car, only visible in the top-down debug view.
    const marker = new THREE.Mesh(new THREE.ConeGeometry(22, 44, 4), new THREE.MeshBasicMaterial({ color: CAR_COLORS[i % CAR_COLORS.length]! }));
    marker.rotation.x = Math.PI;
    marker.visible = false;
    world.scene.add(marker);
    views.push({ model, interp: new SnapshotInterpolator(), effects: new TireEffects(world.scene, params, surfaces), marker, last: null });
  }
}

// --- Top-down debug view (V): whole track, surfaces coloured, big car markers.
const debugCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 5000);
let debugView = query.get('view') === 'map';
function fitDebugCam(): void {
  if (!track) return;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < track.n; i++) {
    minX = Math.min(minX, track.x[i]!);
    maxX = Math.max(maxX, track.x[i]!);
    minZ = Math.min(minZ, track.z[i]!);
    maxZ = Math.max(maxZ, track.z[i]!);
  }
  const pad = 80;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const aspect = window.innerWidth / window.innerHeight;
  let hw = (maxX - minX) / 2 + pad, hh = (maxZ - minZ) / 2 + pad;
  if (hw / hh > aspect) hh = hw / aspect;
  else hw = hh * aspect;
  debugCam.left = -hw;
  debugCam.right = hw;
  debugCam.top = hh;
  debugCam.bottom = -hh;
  debugCam.position.set(cx, 2000, cz);
  debugCam.up.set(0, 0, -1); // north up
  debugCam.lookAt(cx, 0, cz);
  debugCam.updateProjectionMatrix();
}
fitDebugCam();

// --- Worker.
const worker = new Worker(new URL('./worker/simWorker.ts', import.meta.url), { type: 'module' });
const send = (m: ToWorker) => worker.postMessage(m);
const sound = new CarSound();
let simRate = 0;
let recording = false;
let playerIndex = 0;
let race: RaceSnapshot | null = null;

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const m = e.data;
  if (m.type === 'snapshot') {
    ensureViews(m.states.length);
    m.states.forEach((s, i) => views[i]!.interp.push(s));
    playerIndex = m.playerIndex;
    race = m.race;
    simRate = m.stepsPerSecond;
  } else if (m.type === 'telemetryCSV') {
    downloadText(`telemetry-${paramSet}-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`, m.csv);
  }
};
send({
  type: 'start',
  options: { track: trackName, paramSet, overrides: panel.overrides(paramSet), aiCount, laps, autopilot: trackName !== 'test' && demoMode !== null },
});

window.addEventListener('pointerdown', () => sound.start());
window.addEventListener('keydown', (e) => {
  sound.start();
  gamepad.active = false; // keyboard used: hand control back to it
  if (e.repeat) return;
  if (e.code === 'KeyM') sound.toggleMute();
  if (e.code === 'KeyO') panel.toggle();
  if (e.code === 'KeyR') {
    send({ type: e.shiftKey ? 'restart' : 'reset' });
    if (e.shiftKey) views.forEach((v) => v.interp.clear());
  }
  if (e.code === 'KeyC') cam.toggle();
  if (e.code === 'KeyV') debugView = !debugView;
  if (e.code === 'KeyP') {
    paramSet = paramSet === 'feel' ? 'sim' : 'feel';
    const overrides = panel.overrides(paramSet);
    params = loadCarParams(CAR, paramSet, overrides);
    send({ type: 'setParams', paramSet, overrides });
    panel.render();
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
  fitDebugCam();
});

function applyState(v: CarView, s: CarState): void {
  const m = v.model;
  m.root.position.set(s.x, s.y, s.z);
  // Yaw, then tilt to the ground slope (camber), in that order.
  m.root.rotation.set(Math.atan(s.slopeF), s.yaw, -Math.atan(s.slopeL), 'YXZ');
  // Body on its suspension, plus a little shake from surface bumps.
  const [fl, fr, rl, rr] = s.wheels;
  const bumpFront = (fl.bump + fr.bump) / 2, bumpRear = (rl.bump + rr.bump) / 2;
  const bumpLeft = (fl.bump + rl.bump) / 2, bumpRight = (fr.bump + rr.bump) / 2;
  m.body.position.y = (bumpFront + bumpRear) / 2;
  m.body.rotation.x = -s.pitch + (bumpFront - bumpRear) / 3;
  m.body.rotation.z = -s.roll + (bumpRight - bumpLeft) / 1.6;
  m.steerPivots[0].rotation.y = s.steerAngle;
  m.steerPivots[1].rotation.y = s.steerAngle;
  m.wheels.forEach((w, i) => (w.rotation.x = -s.wheels[i]!.spin));
  v.marker.position.set(s.x, 60, s.z);
  v.marker.visible = debugView;
}

// Frame timing stats: average fps and worst frame over the last second.
let last = performance.now();
let fpsFrames = 0;
let fpsStart = last;
let fps = 0;
let worstFrameMs = 0;
let worstShown = 0;

const fmt = (t: number | null) => {
  if (t === null) return '--:--.---';
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(3).padStart(6, '0')}`;
};
const slipBar = (w: CarState['wheels'][number]) => {
  const rho = Math.hypot(w.kappa / params.tirePeakSlipRatio, w.tanAlpha / Math.tan(params.tirePeakSlipAngle));
  return rho < 0.6 ? '·' : rho < 1.0 ? 'o' : 'O';
};

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  const kb = keyboard.update(dt);
  const pad = gamepad.read();
  const latest = views[playerIndex]?.interp.latest() ?? null;
  const inputs = testDemo && latest ? testDemo.update(latest) : pad && gamepad.active ? pad : kb;
  send({ type: 'inputs', inputs });

  let player: CarState | null = null;
  views.forEach((v, i) => {
    const s = v.interp.sample(dt);
    if (!s) return;
    applyState(v, s);
    v.effects.update(dt, s, params);
    if (i === playerIndex) player = s;
  });
  const ps = player as CarState | null;
  if (ps) {
    followSun(world.sun, ps.x, ps.z);
    cam.update(dt, ps);
    sound.update(ps, ps.gear < 0 ? inputs.brake : inputs.throttle, params, surfaces);
  }
  const mapView = debugView && track !== null;
  world.scene.fog = mapView ? null : fog; // fog would wash out the map seen from 2 km up
  world.renderer.render(world.scene, mapView ? debugCam : cam.camera);

  fpsFrames++;
  worstFrameMs = Math.max(worstFrameMs, dt * 1000);
  if (now - fpsStart >= 1000) {
    fps = (fpsFrames * 1000) / (now - fpsStart);
    worstShown = worstFrameMs;
    fpsFrames = 0;
    fpsStart = now;
    worstFrameMs = 0;
  }
  if (ps) {
    const s = ps;
    const [fl, fr, rl, rr] = s.wheels;
    let raceText = '';
    if (race) {
      const me = race.cars[playerIndex]!;
      const pos = race.order.indexOf(playerIndex) + 1;
      raceText =
        `P${pos}/${race.order.length}   lap ${Math.min(Math.max(me.lap, 1), race.laps)}/${race.laps}${me.finished ? '  FINISHED' : ''}\n` +
        `lap    ${fmt(me.lap >= 1 ? me.lapTime : null)}\n` +
        `last   ${fmt(me.lastLap)}   best ${fmt(me.bestLap)}\n`;
      const c = race.countdown;
      center.textContent = c > 0 ? String(Math.ceil(c)) : race.t < race.countdown + 1 ? 'GO!' : '';
    }
    hud.textContent =
      raceText +
      `speed  ${(Math.hypot(s.u, s.v) * 3.6).toFixed(0).padStart(4)} km/h   gear ${s.gear < 0 ? 'R' : s.gear}\n` +
      `rpm    ${s.rpm.toFixed(0).padStart(5)}   lat ${(Math.abs(s.ayFiltered) / 9.81).toFixed(1)} g\n` +
      `grip   ${slipBar(fl)} ${slipBar(fr)}   ${surfaces.list[fl.surface]?.name ?? ''}\n` +
      `       ${slipBar(rl)} ${slipBar(rr)}\n` +
      `fps    ${fps.toFixed(0).padStart(4)}   worst ${worstShown.toFixed(1)} ms   sim ${simRate.toFixed(0)} Hz\n` +
      `set    ${paramSet} (P)   cam ${debugView ? 'map' : cam.mode}   ${demoMode !== null ? 'DEMO' : gamepad.active ? 'gamepad' : 'keyboard'}` +
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
