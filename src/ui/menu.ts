/**
 * Start menu and pause menu (original design in the spirit of racing-game front-ends).
 *
 * Start menu: pick circuit, laps, opponents, AI difficulty and handling set, then Start.
 * Starting reloads the page with the choices in the URL (simple and reliable: the
 * worker and scene are built once per race).
 */
import type { CircuitName, TrackInfo } from '../sim/tracks';

const CSS = `
.menu { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 20;
  background: linear-gradient(90deg, rgba(8,10,14,0.92) 0%, rgba(8,10,14,0.7) 60%, rgba(8,10,14,0.35) 100%);
  color: #fff; font: 600 14px/1.4 ui-sans-serif, system-ui, sans-serif; }
.menu .panel { width: min(920px, calc(100vw - 32px)); }
.menu h1 { font: 900 44px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.04em; margin: 0 0 4px;
  text-transform: uppercase; }
.menu h1 span { color: #e10600; }
.menu .sub { color: #9fb0c0; margin-bottom: 18px; }
.menu h2 { font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: #9fb0c0; margin: 16px 0 8px; }
.menu .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; max-height: 46vh; overflow-y: auto; padding-right: 4px; }
.menu .card { background: rgba(255,255,255,0.06); border: 2px solid transparent; border-radius: 10px; padding: 10px;
  cursor: pointer; transition: border-color 0.15s, background 0.15s; }
.menu .card:hover { background: rgba(255,255,255,0.1); }
.menu .card.sel { border-color: #e10600; background: rgba(225,6,0,0.12); }
.menu .card svg { width: 100%; height: 64px; }
.menu .card .name { font-weight: 800; }
.menu .card .len { color: #9fb0c0; font-size: 12px; }
.menu .opts { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px 18px; }
.menu .seg { display: flex; gap: 6px; flex-wrap: wrap; }
.menu .seg button, .menu .btn { background: rgba(255,255,255,0.08); color: #fff; border: 0; border-radius: 6px;
  padding: 7px 12px; font: 700 13px/1 ui-sans-serif, system-ui; cursor: pointer; }
.menu .seg button.sel { background: #e10600; }
.menu input[type=range] { width: 100%; accent-color: #e10600; }
.menu .start { margin-top: 22px; display: flex; gap: 10px; }
.menu .btn.go { background: #e10600; font-size: 16px; padding: 12px 28px; letter-spacing: 0.08em; text-transform: uppercase; }
.menu .btn.wide { display: block; width: 260px; margin: 8px 0; text-align: left; padding: 12px 16px; font-size: 15px; }
.menu .btn.wide:hover { background: #e10600; }
`;

export interface MenuChoice {
  track: CircuitName | 'test';
  laps: number;
  ai: number;
  difficulty: number;
  /** Drive mode id */
  mode: string;
  /** Hot lap (time trial) instead of a race */
  hotlap: boolean;
}

export interface CircuitInfo extends TrackInfo {
  id: CircuitName;
}

function injectCss(): void {
  if (document.getElementById('menu-css')) return;
  const style = document.createElement('style');
  style.id = 'menu-css';
  style.textContent = CSS;
  document.head.appendChild(style);
}

function outline(pts: [number, number][]): SVGSVGElement {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of pts) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const k = 90 / Math.max(maxX - minX, maxZ - minZ);
  const ox = 50 - ((minX + maxX) / 2) * k, oz = 50 - ((minZ + maxZ) / 2) * k;
  const d = pts.map(([x, z], i) => `${i === 0 ? 'M' : 'L'}${(x * k + ox).toFixed(1)},${(z * k + oz).toFixed(1)}`).join('');
  const path = document.createElementNS(svgNS, 'path');
  path.setAttribute('d', d + 'Z');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#fff');
  path.setAttribute('stroke-width', '3');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

export function showStartMenu(
  circuits: CircuitInfo[],
  initial: MenuChoice,
  modes: { id: string; name: string; builtin: boolean }[],
  onStart: (c: MenuChoice) => void,
): HTMLElement {
  injectCss();
  const choice = { ...initial };
  const root = document.createElement('div');
  root.className = 'menu';
  const panel = document.createElement('div');
  panel.className = 'panel';
  root.append(panel);
  panel.innerHTML = `<h1>fl<span>i</span>te</h1><div class="sub">Low-poly open-wheel racing on real circuits</div><h2>Circuit</h2>`;

  const cards = document.createElement('div');
  cards.className = 'cards';
  const allCards: [HTMLElement, MenuChoice['track']][] = [];
  const pickTrack = (id: MenuChoice['track']) => {
    choice.track = id;
    allCards.forEach(([c, cid]) => c.classList.toggle('sel', cid === id));
  };
  for (const c of circuits) {
    const card = document.createElement('div');
    card.className = 'card';
    card.append(outline(c.outline));
    card.insertAdjacentHTML('beforeend', `<div class="name">${c.name}</div><div class="len">${(c.length_m / 1000).toFixed(3)} km${c.layout_note ? ' · older layout' : ''}</div>`);
    card.addEventListener('click', () => pickTrack(c.id));
    cards.append(card);
    allCards.push([card, c.id]);
  }
  const test = document.createElement('div');
  test.className = 'card';
  test.innerHTML = `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="6 6"/></svg><div class="name">Test area</div><div class="len">cones · free driving</div>`;
  test.addEventListener('click', () => pickTrack('test'));
  cards.append(test);
  allCards.push([test, 'test']);
  panel.append(cards);
  pickTrack(choice.track);

  const opts = document.createElement('div');
  opts.className = 'opts';
  const seg = (label: string, values: [string, number | string][], current: number | string, set: (v: number | string) => void) => {
    const box = document.createElement('div');
    box.innerHTML = `<h2>${label}</h2>`;
    const row = document.createElement('div');
    row.className = 'seg';
    const buttons: HTMLButtonElement[] = [];
    for (const [text, v] of values) {
      const b = document.createElement('button');
      b.textContent = text;
      b.classList.toggle('sel', v === current);
      b.addEventListener('click', () => {
        set(v);
        buttons.forEach((o) => o.classList.toggle('sel', o === b));
      });
      buttons.push(b);
      row.append(b);
    }
    box.append(row);
    return box;
  };
  const slider = (label: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string, set: (v: number) => void) => {
    const box = document.createElement('div');
    const h = document.createElement('h2');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    const show = () => (h.textContent = `${label}: ${fmt(Number(input.value))}`);
    input.addEventListener('input', () => {
      set(Number(input.value));
      show();
    });
    show();
    box.append(h, input);
    return box;
  };
  opts.append(
    seg('Session', [['Race', 'race'], ['Hot lap', 'hotlap']], choice.hotlap ? 'hotlap' : 'race', (v) => (choice.hotlap = v === 'hotlap')),
    seg('Laps', [['1', 1], ['3', 3], ['5', 5], ['10', 10]], choice.laps, (v) => (choice.laps = Number(v))),
    slider('Opponents', 0, 15, 1, choice.ai, (v) => (v === 0 ? 'practice' : String(v)), (v) => (choice.ai = v)),
    slider('AI difficulty', 0, 1, 0.01, choice.difficulty, (v) => `${Math.round(v * 100)}%`, (v) => (choice.difficulty = v)),
    seg('Drive mode', modes.map((m) => [m.builtin ? m.name : `★ ${m.name}`, m.id] as [string, string]), choice.mode, (v) => (choice.mode = String(v))),
  );
  panel.append(opts);

  const start = document.createElement('div');
  start.className = 'start';
  const go = document.createElement('button');
  go.className = 'btn go';
  go.textContent = 'Start';
  go.addEventListener('click', () => onStart(choice));
  start.append(go);
  panel.append(start);
  const credits = document.createElement('div');
  credits.className = 'sub';
  credits.style.marginTop = '18px';
  credits.style.fontSize = '11px';
  credits.innerHTML =
    'Track data: TUM racetrack-database (LGPL-3.0) · Elevation: EU-DEM (Copernicus) and NASA SRTM via OpenTopoData · ' +
    'Map alignment: © OpenStreetMap contributors · Circuit names are generic.';
  panel.append(credits);
  document.body.append(root);
  return root;
}

export interface PauseActions {
  resume: () => void;
  rewind: () => void;
  restart: () => void;
  settings: () => void;
  mainMenu: () => void;
}

export class PauseMenu {
  private readonly root = document.createElement('div');

  constructor(actions: PauseActions) {
    injectCss();
    this.root.className = 'menu';
    this.root.style.display = 'none';
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = '<h1>Paused</h1><div class="sub">Esc to resume</div>';
    const items: [string, () => void][] = [
      ['Resume', actions.resume],
      ['Rewind 5 seconds (Z)', actions.rewind],
      ['Restart race', actions.restart],
      ['Settings (O)', actions.settings],
      ['Main menu', actions.mainMenu],
    ];
    for (const [text, fn] of items) {
      const b = document.createElement('button');
      b.className = 'btn wide';
      b.textContent = text;
      b.addEventListener('click', () => {
        fn();
        b.blur();
      });
      panel.append(b);
    }
    const controls = document.createElement('div');
    controls.className = 'sub';
    controls.style.marginTop = '18px';
    controls.style.maxWidth = '620px';
    controls.textContent =
      'Controls: ↑/W throttle · ↓/S brake (hold when stopped = reverse) · ←/→ or A/D steer · Shift ERS boost · ' +
      'Esc pause · Z rewind 5 s · R back on track · Backspace restart · C camera · V map · B mirror · L braking line · ' +
      'P feel/sim · O tuning · M mute · F fps · T telemetry. Gamepad: stick, triggers, A/RB boost.';
    panel.append(controls);
    this.root.append(panel);
    document.body.append(this.root);
  }

  set visible(v: boolean) {
    this.root.style.display = v ? 'flex' : 'none';
  }
}
