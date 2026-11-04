/**
 * Bottom dashboard: speed, gear, rpm/shift lights, ERS battery, slipstream,
 * per-tire grip, position and lap times. Plain DOM, updated every frame.
 */
import type { CarParams } from '../sim/params';
import { loadFactor } from '../sim/tire';
import type { SurfaceTable } from '../sim/surfaces';
import type { CarState } from '../sim/types';

const RPM_SEGMENTS = 16;

const CSS = `
#dash { position: fixed; right: 14px; bottom: 14px; display: flex; gap: 14px;
  align-items: stretch; padding: 10px 16px; border-radius: 12px; background: rgba(14, 18, 24, 0.72);
  color: #eef3f8; font: 13px/1.3 ui-sans-serif, system-ui, sans-serif; pointer-events: none;
  box-shadow: 0 6px 24px rgba(0,0,0,0.3); white-space: nowrap; }
#dash .col { display: flex; flex-direction: column; justify-content: center; min-width: 120px; }
#dash .label { color: #8fa1b3; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; }
#dash .pos { font-size: 26px; font-weight: 800; }
#dash .mono { font-family: ui-monospace, Menlo, monospace; }
#dash .center { align-items: center; min-width: 200px; }
#dash .speed { font: 800 44px/1 ui-monospace, Menlo, monospace; }
#dash .unit { color: #8fa1b3; font-size: 11px; margin-left: 4px; }
#dash .gear { font: 800 34px/1 ui-monospace, Menlo, monospace; color: #ffd21f; margin-left: 14px; }
#dash .row { display: flex; align-items: baseline; }
#dash .rpm { display: flex; gap: 2px; margin-top: 6px; }
#dash .rpm i { width: 9px; height: 8px; border-radius: 2px; background: #2a3440; }
#dash .bar { width: 130px; height: 9px; border-radius: 5px; background: #2a3440; overflow: hidden; margin: 3px 0 6px; }
#dash .bar > b { display: block; height: 100%; width: 0%; border-radius: 5px; }
#dash .ers > b { background: linear-gradient(90deg, #2e9bff, #5ff0ff); }
#dash .draft > b { background: #9ad11f; }
#dash .steer { position: relative; width: 130px; height: 6px; border-radius: 3px; background: #2a3440; margin-top: 8px; }
#dash .steer > b { position: absolute; top: 0; bottom: 0; background: #ffd21f; border-radius: 3px; }
#dash .steer > i { position: absolute; left: 50%; top: -2px; bottom: -2px; width: 2px; background: #8fa1b3; }
#dash .boost { color: #5ff0ff; font-weight: 800; text-shadow: 0 0 8px #5ff0ff; visibility: hidden; margin-left: 6px; }
#dash .tires { display: grid; grid-template-columns: 22px 22px; gap: 4px 10px; margin-top: 4px; }
#dash .tire { position: relative; width: 22px; height: 30px; border-radius: 5px; background: #2a3440;
  overflow: hidden; box-sizing: border-box; border: 2px solid transparent; }
#dash .tire > b { position: absolute; left: 0; right: 0; bottom: 0; height: 0%; background: #5ff0ff; }
#dash .surf { font-size: 10px; color: #c9d4de; min-height: 12px; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export interface DashRace {
  position: number;
  cars: number;
  lap: number;
  laps: number;
  lapTime: number | null;
  lastLap: number | null;
  bestLap: number | null;
  draft: number;
  finished: boolean;
}

export const fmtTime = (t: number | null): string => {
  if (t === null) return '-:--.---';
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(3).padStart(6, '0')}`;
};

export class Dash {
  private readonly root = el('div');
  private readonly pos = el('div', 'pos mono');
  private readonly lap = el('div', 'mono');
  private readonly times = el('div', 'mono');
  private readonly speed = el('span', 'speed', '0');
  private readonly gear = el('span', 'gear', 'N');
  private readonly rpm: HTMLElement[] = [];
  private readonly ersBar = el('b');
  private readonly ersText = el('span', 'mono');
  private readonly boost = el('span', 'boost', 'BOOST');
  private readonly draftBar = el('b');
  private readonly steerBar = el('b');
  private readonly tires: HTMLElement[] = [];
  private readonly tireFill: HTMLElement[] = [];
  private readonly surf = el('div', 'surf');

  constructor() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root.id = 'dash';

    const left = el('div', 'col');
    left.append(el('div', 'label', 'position'), this.pos, this.lap, this.times);

    const center = el('div', 'col center');
    const row = el('div', 'row');
    row.append(this.speed, el('span', 'unit', 'km/h'), this.gear);
    const rpm = el('div', 'rpm');
    for (let i = 0; i < RPM_SEGMENTS; i++) {
      const seg = el('i');
      this.rpm.push(seg);
      rpm.append(seg);
    }
    const steer = el('div', 'steer');
    steer.append(el('i'), this.steerBar);
    center.append(row, rpm, steer);

    const right = el('div', 'col');
    const ersLabel = el('div', 'label', 'ERS (shift)');
    ersLabel.append(this.boost);
    const ers = el('div', 'bar ers');
    ers.append(this.ersBar);
    const draft = el('div', 'bar draft');
    draft.append(this.draftBar);
    right.append(ersLabel, ers, el('div', 'label', 'slipstream'), draft);

    const grip = el('div', 'col');
    const tires = el('div', 'tires');
    for (let i = 0; i < 4; i++) {
      const t = el('div', 'tire');
      const fill = el('b');
      t.append(fill);
      this.tires.push(t);
      this.tireFill.push(fill);
      tires.append(t);
    }
    grip.append(el('div', 'label', 'grip'), tires, this.surf);

    this.root.append(center, right, grip); // position/laps live in the timing tower and lap box
    document.body.appendChild(this.root);
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  update(s: CarState, p: CarParams, surfaces: SurfaceTable, race: DashRace | null, steerInput = 0): void {
    // Steering bar: centre = straight; fills left or right (our steer +1 = left).
    const k = Math.max(-1, Math.min(1, steerInput));
    this.steerBar.style.left = `${50 - Math.max(0, k) * 50}%`;
    this.steerBar.style.width = `${Math.abs(k) * 50}%`;
    // Position and laps.
    if (race) {
      this.pos.textContent = `P${race.position}/${race.cars}`;
      this.lap.textContent = race.finished ? 'FINISHED' : `Lap ${Math.min(Math.max(race.lap, 1), race.laps)}/${race.laps}`;
      this.times.textContent = `${fmtTime(race.lapTime)}\nlast ${fmtTime(race.lastLap)}\nbest ${fmtTime(race.bestLap)}`;
      this.times.style.whiteSpace = 'pre';
    } else {
      this.pos.textContent = 'Practice';
      this.lap.textContent = '';
      this.times.textContent = '';
    }

    // Speed, gear, rpm with shift lights (green -> yellow -> red; all flash blue at the shift point).
    this.speed.textContent = (Math.hypot(s.u, s.v) * 3.6).toFixed(0);
    this.gear.textContent = s.gear < 0 ? 'R' : String(s.gear);
    const frac = (s.rpm - p.idleRpm) / (p.revLimitRpm - p.idleRpm);
    const shiftNow = s.rpm >= p.upshiftRpm;
    this.rpm.forEach((seg, i) => {
      const on = i / RPM_SEGMENTS < frac;
      const k = i / RPM_SEGMENTS;
      seg.style.background = !on ? '#2a3440' : shiftNow ? '#3fa9ff' : k < 0.55 ? '#2ecc40' : k < 0.8 ? '#ffd21f' : '#ff3b30';
    });

    // ERS and slipstream.
    const charge = s.battery / p.ersCapacity;
    this.ersBar.style.width = `${(charge * 100).toFixed(1)}%`;
    this.boost.style.visibility = s.ersDeploy > 0 ? 'visible' : 'hidden';
    this.draftBar.style.width = `${((race?.draft ?? 0) * 100).toFixed(0)}%`;

    // Tires: fill = share of the grip available right now (at this load, on this surface) that
    // the tire is using; more opaque as it rises. Red outline = past the peak (sliding).
    const offAsphalt = new Set<string>();
    const tp = p.derived.tire;
    s.wheels.forEach((w, i) => {
      const surf = surfaces.list[w.surface];
      const mu = loadFactor(w.load, tp) * (surf?.grip ?? 1);
      const peakX = tp.muX * mu * w.load, peakY = tp.muY * mu * w.load;
      const used = w.load > 1 && peakX > 0 ? Math.hypot(w.fx / peakX, w.fy / peakY) : 0;
      const rho = Math.hypot(w.kappa / p.tirePeakSlipRatio, w.tanAlpha / Math.tan(p.tirePeakSlipAngle));
      const k = Math.min(1, used);
      const fill = this.tireFill[i]!;
      fill.style.height = `${(k * 100).toFixed(0)}%`;
      fill.style.opacity = (0.25 + 0.75 * k).toFixed(2);
      this.tires[i]!.style.borderColor = rho > 1 ? '#ff3b30' : 'transparent';
      const name = surf?.name ?? '';
      if (name && name !== 'asphalt') offAsphalt.add(name.replace('_', ' '));
    });
    this.surf.textContent = [...offAsphalt].join(', ');
  }
}
