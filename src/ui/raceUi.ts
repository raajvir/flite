/**
 * Race overlay in the style of TV/racing-game timing graphics (original design):
 *   - timing tower (left): position, team colour, driver code, gap to leader
 *   - lap box (top right): lap counter and lap times
 *   - mini-map (bottom left): track outline with a dot per car
 *   - banners (centre): fastest lap, final lap, finish position
 * Plain DOM/SVG, updated every frame from the race snapshot.
 */
import type { RaceSnapshot } from '../game/session';
import type { TrackWorld } from '../sim/trackWorld';
import type { CarState } from '../sim/types';
import { fmtTime } from './dash';

/** Fictional three-letter driver codes for the AI field (player is "YOU"). */
export const DRIVER_CODES = ['KAI', 'DMT', 'LOR', 'BRV', 'OKE', 'MAR', 'SIL', 'TEO', 'VAN', 'QUI', 'RAF', 'ELI', 'JUN', 'ODA', 'PAX', 'REN'];

const CSS = `
.rui { position: fixed; pointer-events: none; color: #fff; font: 600 13px/1.25 ui-sans-serif, system-ui, sans-serif; }
#tower { left: 14px; top: 14px; width: 210px; background: rgba(12, 14, 20, 0.82); border-radius: 8px; overflow: hidden;
  box-shadow: 0 6px 20px rgba(0,0,0,0.35); }
#tower .head { display: flex; justify-content: space-between; padding: 7px 10px; background: #e10600; font-weight: 800;
  letter-spacing: 0.08em; text-transform: uppercase; font-size: 12px; }
#tower .row { display: grid; grid-template-columns: 26px 4px 1fr auto; align-items: center; gap: 7px; padding: 3px 10px;
  height: 22px; border-top: 1px solid rgba(255,255,255,0.05); }
#tower .row.me { background: rgba(255,255,255,0.16); }
#tower .pos { font-family: ui-monospace, Menlo, monospace; text-align: right; font-weight: 800; }
#tower .strip { width: 4px; height: 16px; border-radius: 2px; }
#tower .code { font-weight: 800; letter-spacing: 0.04em; }
#tower .gap { font-family: ui-monospace, Menlo, monospace; color: #c9d4de; font-size: 12px; }
#tower .row.fl .gap { color: #c78bff; }
#lapbox { right: 14px; top: 14px; min-width: 190px; background: rgba(12, 14, 20, 0.82); border-radius: 8px; padding: 8px 12px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.35); }
#lapbox .lap { font-size: 12px; color: #9fb0c0; letter-spacing: 0.1em; text-transform: uppercase; }
#lapbox .lapnum { font: 800 26px/1.1 ui-monospace, Menlo, monospace; }
#lapbox .t { display: flex; justify-content: space-between; font-family: ui-monospace, Menlo, monospace; gap: 12px; }
#lapbox .t span:first-child { color: #9fb0c0; font-family: ui-sans-serif, system-ui; font-weight: 700; font-size: 11px; letter-spacing: 0.08em; }
#lapbox .cur { font-size: 18px; margin: 2px 0 4px; }
#minimap { left: 14px; bottom: 14px; width: 220px; height: 220px; background: rgba(12, 14, 20, 0.6); border-radius: 10px; }
#minimap svg { width: 100%; height: 100%; }
#banner { left: 50%; top: 22%; transform: translateX(-50%); padding: 10px 22px; border-radius: 8px; font-weight: 800;
  font-size: 22px; letter-spacing: 0.06em; text-transform: uppercase; background: rgba(12,14,20,0.85); border-left: 6px solid #e10600;
  opacity: 0; transition: opacity 0.3s; }
#banner.show { opacity: 1; }
`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export class RaceUi {
  private readonly tower = el('div', 'rui');
  private readonly towerHead = el('div', 'head');
  private readonly rows: HTMLDivElement[] = [];
  private readonly lapbox = el('div', 'rui');
  private readonly lapNum = el('div', 'lapnum');
  private readonly cur = el('div', 't cur');
  private readonly last = el('div', 't');
  private readonly best = el('div', 't');
  private readonly minimap = el('div', 'rui');
  private readonly dots: SVGCircleElement[] = [];
  private readonly banner = el('div', 'rui');
  private bannerUntil = 0;
  private lastFastest: number | null = null;
  private announcedFinalLap = false;
  private announcedFinish = false;
  private readonly toMap: (x: number, z: number) => [number, number];

  constructor(
    world: TrackWorld | null,
    private readonly colors: number[],
    private readonly playerIndex: () => number,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.tower.id = 'tower';
    this.towerHead.append(el('span', '', 'Lap'), el('span'));
    this.tower.append(this.towerHead);
    this.lapbox.id = 'lapbox';
    this.lapbox.append(el('div', 'lap', 'lap'), this.lapNum, this.cur, this.last, this.best);
    this.minimap.id = 'minimap';
    this.banner.id = 'banner';
    document.body.append(this.tower, this.lapbox, this.minimap, this.banner);

    // Mini-map outline (north up).
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    this.minimap.append(svg);
    if (!world) {
      this.toMap = () => [50, 50];
      this.minimap.style.display = 'none';
      return;
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < world.n; i++) {
      minX = Math.min(minX, world.x[i]!);
      maxX = Math.max(maxX, world.x[i]!);
      minZ = Math.min(minZ, world.z[i]!);
      maxZ = Math.max(maxZ, world.z[i]!);
    }
    const scale = 88 / Math.max(maxX - minX, maxZ - minZ);
    const ox = 50 - ((minX + maxX) / 2) * scale, oz = 50 - ((minZ + maxZ) / 2) * scale;
    this.toMap = (x, z) => [x * scale + ox, z * scale + oz];
    let d = '';
    for (let i = 0; i <= world.n; i += 4) {
      const [px, pz] = this.toMap(world.x[i % world.n]!, world.z[i % world.n]!);
      d += `${i === 0 ? 'M' : 'L'}${px.toFixed(2)},${pz.toFixed(2)}`;
    }
    for (const [w, c] of [[4.2, 'rgba(255,255,255,0.25)'], [2.2, '#e8edf2']] as const) {
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', d + 'Z');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', c);
      path.setAttribute('stroke-width', String(w));
      path.setAttribute('stroke-linejoin', 'round');
      svg.append(path);
    }
    const [sx, sz] = this.toMap(world.x[0]!, world.z[0]!);
    const start = document.createElementNS(svgNS, 'circle');
    start.setAttribute('cx', String(sx));
    start.setAttribute('cy', String(sz));
    start.setAttribute('r', '1.8');
    start.setAttribute('fill', '#e10600');
    svg.append(start);
    for (let i = 0; i < 24; i++) {
      const dot = document.createElementNS(svgNS, 'circle');
      dot.setAttribute('r', '2.6');
      dot.setAttribute('stroke', '#111');
      dot.setAttribute('stroke-width', '0.6');
      dot.style.display = 'none';
      svg.append(dot);
      this.dots.push(dot);
    }
  }

  private code(i: number): string {
    return i === this.playerIndex() ? 'YOU' : DRIVER_CODES[(i - 1 + DRIVER_CODES.length) % DRIVER_CODES.length]!;
  }

  private color(i: number): string {
    return `#${(this.colors[i % this.colors.length] ?? 0xffffff).toString(16).padStart(6, '0')}`;
  }

  private flash(text: string, now: number, seconds = 3): void {
    this.banner.textContent = text;
    this.banner.classList.add('show');
    this.bannerUntil = now + seconds;
  }

  update(race: RaceSnapshot | null, states: (CarState | null)[], now: number): void {
    if (now > this.bannerUntil) this.banner.classList.remove('show');
    // Mini-map dots (player drawn last = on top).
    const me = this.playerIndex();
    const order = states.map((_, i) => i).filter((i) => i !== me).concat([me]);
    order.forEach((i, k) => {
      const s = states[i];
      const dot = this.dots[k];
      if (!dot || !s) return;
      const [x, z] = this.toMap(s.x, s.z);
      dot.setAttribute('cx', x.toFixed(2));
      dot.setAttribute('cy', z.toFixed(2));
      dot.setAttribute('fill', this.color(i));
      dot.setAttribute('r', i === me ? '3.4' : '2.6');
      dot.setAttribute('stroke', i === me ? '#fff' : '#111');
      dot.style.display = '';
    });

    if (!race) {
      this.tower.style.display = 'none';
      this.lapNum.textContent = 'PRACTICE';
      return;
    }
    const mine = race.cars[me]!;
    const lap = Math.min(Math.max(mine.lap, 1), race.laps);
    (this.towerHead.lastChild as HTMLElement).textContent = `${lap}/${race.laps}`;
    // Tower rows.
    while (this.rows.length < race.order.length) {
      const r = el('div', 'row');
      r.append(el('span', 'pos'), el('span', 'strip'), el('span', 'code'), el('span', 'gap'));
      this.rows.push(r);
      this.tower.append(r);
    }
    race.order.forEach((car, k) => {
      const r = this.rows[k]!;
      const c = race.cars[car]!;
      const [pos, strip, code, gap] = Array.from(r.children) as HTMLElement[];
      pos!.textContent = String(k + 1);
      strip!.style.background = this.color(car);
      code!.textContent = this.code(car);
      gap!.textContent = c.finished && k === 0 ? 'WIN' : k === 0 ? 'Leader' : `+${c.gap.toFixed(3)}`;
      r.classList.toggle('me', car === me);
      r.classList.toggle('fl', race.fastest?.car === car);
    });

    // Lap box.
    this.lapNum.textContent = mine.finished ? 'FINISH' : `${lap} / ${race.laps}`;
    this.cur.innerHTML = `<span>TIME</span><span>${fmtTime(mine.lap >= 1 ? mine.lapTime : null)}</span>`;
    this.last.innerHTML = `<span>LAST</span><span>${fmtTime(mine.lastLap)}</span>`;
    this.best.innerHTML = `<span>BEST</span><span>${fmtTime(mine.bestLap)}</span>`;

    // Banners.
    if (race.fastest && race.fastest.time !== this.lastFastest) {
      if (this.lastFastest !== null || race.fastest.car === me) this.flash(`Fastest lap · ${this.code(race.fastest.car)} · ${fmtTime(race.fastest.time)}`, now);
      this.lastFastest = race.fastest.time;
    }
    if (!this.announcedFinalLap && race.laps > 1 && mine.lap === race.laps) {
      this.announcedFinalLap = true;
      this.flash('Final lap', now);
    }
    if (!this.announcedFinish && mine.finished) {
      this.announcedFinish = true;
      this.flash(`Finished P${race.order.indexOf(me) + 1}`, now, 6);
    }
  }
}
