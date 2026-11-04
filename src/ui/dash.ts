/**
 * Bottom dashboard: speed, gear, rpm/shift lights, ERS battery, slipstream,
 * per-tire grip, position and lap times. Plain DOM, updated every frame.
 */
import type { CarParams } from '../sim/params';
import type { SurfaceTable } from '../sim/surfaces';
import type { CarState } from '../sim/types';

const RPM_SEGMENTS = 16;

const CSS = `
#dash { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; gap: 14px;
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
#dash .boost { color: #5ff0ff; font-weight: 800; text-shadow: 0 0 8px #5ff0ff; visibility: hidden; margin-left: 6px; }
#dash .tires { display: grid; grid-template-columns: 22px 22px; gap: 4px 10px; margin-top: 4px; }
#dash .tire { width: 22px; height: 30px; border-radius: 5px; background: #2ecc40; }
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
  private readonly tires: HTMLElement[] = [];
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
    center.append(row, rpm);

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
      this.tires.push(t);
      tires.append(t);
    }
    grip.append(el('div', 'label', 'grip'), tires, this.surf);

    this.root.append(left, center, right, grip);
    document.body.appendChild(this.root);
  }

  update(s: CarState, p: CarParams, surfaces: SurfaceTable, race: DashRace | null): void {
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

    // Tires: colour by combined slip (green ok, yellow working, red sliding); note non-asphalt surfaces.
    const offAsphalt = new Set<string>();
    s.wheels.forEach((w, i) => {
      const rho = Math.hypot(w.kappa / p.tirePeakSlipRatio, w.tanAlpha / Math.tan(p.tirePeakSlipAngle));
      this.tires[i]!.style.background = rho < 0.6 ? '#2ecc40' : rho < 1.0 ? '#ffd21f' : '#ff3b30';
      const name = surfaces.list[w.surface]?.name ?? '';
      if (name && name !== 'asphalt') offAsphalt.add(name.replace('_', ' '));
    });
    this.surf.textContent = [...offAsphalt].join(', ');
  }
}
