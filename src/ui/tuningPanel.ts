/**
 * Live tuning panel (press O). Sliders for car parameters and keyboard feel.
 *
 * - Changes apply instantly (sent to the sim worker as overrides).
 * - Values are remembered per handling set (feel / sim) in this browser.
 * - "Copy settings" puts the changed values on the clipboard as JSON, ready to
 *   be baked into data/cars/*.json as new defaults.
 */
import { DIFFICULTY } from '../ai/difficulty';
import { KEYBOARD_TUNING } from '../input/keyboard';
import type { CarParams, NumberKey, ParamOverrides, ParamSetName } from '../sim/params';

type KeyboardKey = keyof typeof KEYBOARD_TUNING;

interface SliderSpec {
  key: NumberKey;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Display transform, e.g. radians -> degrees. */
  show?: (v: number) => string;
  /** Rendered as an on/off switch (value 0 or 1). */
  toggle?: boolean;
  hint?: string;
}

interface KeyboardSpec {
  key: KeyboardKey;
  label: string;
  min: number;
  max: number;
  step: number;
  hint?: string;
}

const deg = (v: number) => `${((v * 180) / Math.PI).toFixed(1)}°`;
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const num = (d: number) => (v: number) => v.toFixed(d);

const GROUPS: { title: string; items: SliderSpec[] }[] = [
  {
    title: 'Assists',
    items: [
      { key: 'tcsEnabled', label: 'Traction control', min: 0, max: 1, step: 1, toggle: true },
      { key: 'tcsSlip', label: 'TC slip limit', min: 0.6, max: 4, step: 0.05, show: num(2), hint: 'higher = looser, more wheelspin' },
      { key: 'absEnabled', label: 'ABS', min: 0, max: 1, step: 1, toggle: true },
      { key: 'absSlip', label: 'ABS slip limit', min: 0.04, max: 0.4, step: 0.01, show: num(2), hint: 'higher = brakes closer to locking' },
      { key: 'stabilityAssist', label: 'Stability assist', min: 0, max: 20000, step: 250, show: num(0), hint: 'yaw damping; 0 = off' },
      { key: 'stabilityGripFraction', label: 'Stability rotation limit', min: 0.5, max: 1.2, step: 0.01, show: num(2), hint: 'how much of the grip the assist lets you use for turning' },
      { key: 'assistLockRelease', label: 'Donut mode', min: 0, max: 1, step: 0.05, show: pct, hint: 'assists back off at full lock + throttle, slow' },
    ],
  },
  {
    title: 'Brakes',
    items: [
      { key: 'brakeBiasFront', label: 'Brake balance (front)', min: 0.4, max: 0.75, step: 0.005, show: pct, hint: 'more front = stable; more rear = rotates, can spin' },
      { key: 'brakeMaxTorque', label: 'Brake power', min: 5000, max: 22000, step: 250, show: num(0), hint: 'total N·m' },
    ],
  },
  {
    title: 'Tires',
    items: [
      { key: 'tireMuY', label: 'Cornering grip', min: 1, max: 3, step: 0.05, show: num(2) },
      { key: 'tireMuX', label: 'Traction / braking grip', min: 1, max: 3, step: 0.05, show: num(2) },
      { key: 'tirePeakSlipAngle', label: 'Peak slip angle', min: 0.05, max: 0.2, step: 0.005, show: deg, hint: 'bigger = lazier but more progressive' },
      { key: 'tireShapeC', label: 'Grip drop after peak', min: 1.05, max: 1.9, step: 0.01, show: num(2), hint: 'higher = snappier, harder to catch' },
      { key: 'tireLoadSensitivity', label: 'Load sensitivity', min: 0, max: 0.3, step: 0.01, show: num(2) },
    ],
  },
  {
    title: 'Balance',
    items: [
      { key: 'rollStiffnessFront', label: 'Roll balance (front)', min: 0.3, max: 0.8, step: 0.01, show: pct, hint: 'higher = more understeer' },
      { key: 'cgHeight', label: 'Centre of gravity height', min: 0.18, max: 0.45, step: 0.01, show: num(2), hint: 'm; higher = more weight transfer' },
      { key: 'diffLocking', label: 'Diff locking', min: 0, max: 600, step: 10, show: num(0), hint: 'higher = rears turn together, more stable on power' },
    ],
  },
  {
    title: 'Aero',
    items: [
      { key: 'liftArea', label: 'Downforce', min: 0, max: 7, step: 0.1, show: num(1) },
      { key: 'aeroBalanceFront', label: 'Aero balance (front)', min: 0.3, max: 0.55, step: 0.01, show: pct, hint: 'higher = more front grip at speed' },
      { key: 'dragArea', label: 'Drag', min: 0.5, max: 1.8, step: 0.05, show: num(2) },
    ],
  },
  {
    title: 'Steering',
    items: [
      { key: 'maxSteerAngle', label: 'Max lock', min: 0.15, max: 0.5, step: 0.01, show: deg },
      { key: 'steerRate', label: 'Steering speed', min: 0.5, max: 5, step: 0.1, show: num(1), hint: 'rad/s at the wheels' },
      { key: 'steerSpeedFalloff', label: 'Lock at speed', min: 15, max: 70, step: 1, show: num(0), hint: 'speed (m/s) where lock halves; higher = more lock at speed' },
    ],
  },
  {
    title: 'Engine & gearbox',
    items: [
      { key: 'upshiftRpm', label: 'Upshift rpm', min: 9000, max: 12400, step: 100, show: num(0) },
      { key: 'shiftTime', label: 'Shift time', min: 0, max: 0.2, step: 0.005, show: num(3), hint: 's of torque cut per shift' },
      { key: 'engineBrakeTorque', label: 'Engine braking', min: 0, max: 400, step: 10, show: num(0) },
    ],
  },
  {
    title: 'Suspension (body motion)',
    items: [
      { key: 'bodyRollGradient', label: 'Roll amount', min: 0, max: 0.005, step: 0.0001, show: (v) => `${((v * 9.81 * 180) / Math.PI).toFixed(1)}°/g` },
      { key: 'bodyPitchGradient', label: 'Dive / squat amount', min: 0, max: 0.005, step: 0.0001, show: (v) => `${((v * 9.81 * 180) / Math.PI).toFixed(1)}°/g` },
      { key: 'suspensionFrequency', label: 'Stiffness', min: 1, max: 6, step: 0.1, show: (v) => `${v.toFixed(1)} Hz` },
      { key: 'suspensionDamping', label: 'Damping', min: 0.2, max: 1.2, step: 0.05, show: num(2), hint: '<1 bounces a little' },
    ],
  },
];

const KEYBOARD_ITEMS: KeyboardSpec[] = [
  { key: 'steerBuild', label: 'Steer build-up', min: 1, max: 10, step: 0.1, hint: 'how fast a held key reaches full steer' },
  { key: 'steerReturn', label: 'Steer return', min: 1, max: 15, step: 0.1, hint: 'how fast it centres on release' },
  { key: 'steerReverse', label: 'Steer flick', min: 1, max: 20, step: 0.1, hint: 'switching left <-> right' },
  { key: 'throttleBuild', label: 'Throttle build-up', min: 1, max: 20, step: 0.5 },
  { key: 'brakeBuild', label: 'Brake build-up', min: 1, max: 20, step: 0.5 },
];

const STORAGE_KEY = 'flite.tuning.v1';
const KEYBOARD_DEFAULTS = { ...KEYBOARD_TUNING };

export interface RaceSettings {
  /** 0..1 */
  aiDifficulty: number;
  brakingLine: boolean;
}

const RACE_DEFAULTS: RaceSettings = { aiDifficulty: DIFFICULTY.default, brakingLine: true };

interface Stored {
  feel: ParamOverrides;
  sim: ParamOverrides;
  keyboard: Partial<Record<KeyboardKey, number>>;
  race: RaceSettings;
}

function loadStored(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Stored>;
      return { feel: s.feel ?? {}, sim: s.sim ?? {}, keyboard: s.keyboard ?? {}, race: { ...RACE_DEFAULTS, ...s.race } };
    }
  } catch {
    // storage blocked or corrupt: start clean
  }
  return { feel: {}, sim: {}, keyboard: {}, race: { ...RACE_DEFAULTS } };
}

const CSS = `
#tuning { position: fixed; top: 0; right: 0; bottom: 0; width: 330px; overflow-y: auto;
  background: rgba(18, 24, 32, 0.88); color: #e8edf2; font: 12px/1.4 ui-sans-serif, system-ui, sans-serif;
  padding: 10px 12px 24px; box-sizing: border-box; display: none; z-index: 10; }
#tuning.open { display: block; }
#tuning h2 { font-size: 14px; margin: 0 0 4px; }
#tuning .sub { color: #9fb0c0; margin-bottom: 8px; }
#tuning .buttons { display: flex; gap: 6px; margin-bottom: 8px; }
#tuning button { flex: 1; background: #2c3a48; color: #e8edf2; border: 1px solid #44566a; border-radius: 4px;
  padding: 5px 6px; font: inherit; cursor: pointer; }
#tuning button:hover { background: #38495b; }
#tuning details { border-top: 1px solid #2f3d4b; padding: 4px 0; }
#tuning summary { cursor: pointer; font-weight: 600; padding: 3px 0; }
#tuning .row { margin: 6px 0 8px; }
#tuning .top { display: flex; justify-content: space-between; gap: 8px; }
#tuning .label { cursor: pointer; }
#tuning .value { font-family: ui-monospace, Menlo, monospace; color: #cfe3f5; }
#tuning .row.changed .label, #tuning .row.changed .value { color: #ffcf5a; }
#tuning input[type=range] { width: 100%; margin: 2px 0 0; accent-color: #ffcf5a; }
#tuning .hint { color: #8293a4; font-size: 11px; }
#tuning .def { color: #6f8090; font-size: 11px; }
`;

export interface TuningPanelOptions {
  /** Parameter set currently driven. */
  getSet: () => ParamSetName;
  /** Default (un-overridden) params for a set. */
  getDefaults: (set: ParamSetName) => CarParams;
  /** Called with the full override map whenever a car slider moves. */
  onChange: (set: ParamSetName, overrides: ParamOverrides) => void;
  /** Called when a race setting (AI difficulty, braking line) changes. */
  onRaceChange: (race: RaceSettings) => void;
}

export class TuningPanel {
  private readonly el: HTMLDivElement;
  private stored = loadStored();
  private readonly status: HTMLSpanElement;

  constructor(private readonly opts: TuningPanelOptions) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.el = document.createElement('div');
    this.el.id = 'tuning';
    document.body.appendChild(this.el);
    this.status = document.createElement('span');
    Object.assign(KEYBOARD_TUNING, this.stored.keyboard);
    this.render();
  }

  get isOpen(): boolean {
    return this.el.classList.contains('open');
  }

  toggle(): void {
    this.el.classList.toggle('open');
  }

  get race(): RaceSettings {
    return { ...this.stored.race };
  }

  setBrakingLine(on: boolean): void {
    this.stored.race.brakingLine = on;
    this.save();
    this.opts.onRaceChange(this.race);
    this.render();
  }

  overrides(set: ParamSetName): ParamOverrides {
    return { ...this.stored[set] };
  }

  /** Re-draw (e.g. after switching feel/sim). */
  render(): void {
    const set = this.opts.getSet();
    const defaults = this.opts.getDefaults(set);
    const ov = this.stored[set];
    this.el.replaceChildren();

    const h = document.createElement('h2');
    h.textContent = `Tuning — ${set} set`;
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = 'O to close · P switches feel/sim · double-click a name to reset it · changed values are yellow';
    const buttons = document.createElement('div');
    buttons.className = 'buttons';
    buttons.append(
      this.button('Copy settings', () => void this.copy()),
      this.button(`Reset ${set}`, () => {
        this.stored[set] = {};
        this.save();
        this.opts.onChange(set, {});
        this.render();
      }),
    );
    this.el.append(h, sub, buttons, this.status);

    // Race settings (both handling sets).
    const rd = document.createElement('details');
    rd.open = true;
    const rs = document.createElement('summary');
    rs.textContent = 'Race';
    rd.append(rs);
    const race = this.stored.race;
    rd.append(
      this.row('AI difficulty', 'how much of the grip the AI dares to use; applies immediately', 0, 1, 0.01, race.aiDifficulty, RACE_DEFAULTS.aiDifficulty, pct, false, (v) => {
        race.aiDifficulty = v;
        this.save();
        this.opts.onRaceChange(this.race);
      }),
      this.row('Braking line (L)', 'green = flat out, yellow = slow down soon, red = brake now', 0, 1, 1, race.brakingLine ? 1 : 0, RACE_DEFAULTS.brakingLine ? 1 : 0, num(0), true, (v) => {
        race.brakingLine = v > 0;
        this.save();
        this.opts.onRaceChange(this.race);
      }),
    );
    this.el.append(rd);

    for (const g of GROUPS) {
      const d = document.createElement('details');
      d.open = g.title === 'Assists';
      const s = document.createElement('summary');
      s.textContent = g.title;
      d.append(s);
      for (const spec of g.items) {
        const def = defaults[spec.key];
        d.append(
          this.row(spec.label, spec.hint, spec.min, spec.max, spec.step, ov[spec.key] ?? def, def, spec.show ?? num(3), !!spec.toggle, (v) => {
            if (v === def) delete ov[spec.key];
            else ov[spec.key] = v;
            this.save();
            this.opts.onChange(set, { ...ov });
          }),
        );
      }
      this.el.append(d);
    }

    const kd = document.createElement('details');
    const ks = document.createElement('summary');
    ks.textContent = 'Keyboard feel (both sets)';
    kd.append(ks);
    for (const spec of KEYBOARD_ITEMS) {
      const def = KEYBOARD_DEFAULTS[spec.key];
      kd.append(
        this.row(spec.label, spec.hint, spec.min, spec.max, spec.step, KEYBOARD_TUNING[spec.key], def, num(1), false, (v) => {
          KEYBOARD_TUNING[spec.key] = v;
          if (v === def) delete this.stored.keyboard[spec.key];
          else this.stored.keyboard[spec.key] = v;
          this.save();
        }),
      );
    }
    this.el.append(kd);
  }

  private row(
    label: string,
    hint: string | undefined,
    min: number,
    max: number,
    step: number,
    value: number,
    def: number,
    show: (v: number) => string,
    toggle: boolean,
    set: (v: number) => void,
  ): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'row';
    const top = document.createElement('div');
    top.className = 'top';
    const name = document.createElement('span');
    name.className = 'label';
    name.textContent = label;
    name.title = 'Double-click to reset';
    const val = document.createElement('span');
    val.className = 'value';
    top.append(name, val);

    const input = document.createElement('input');
    input.type = toggle ? 'checkbox' : 'range';
    if (!toggle) {
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
    }
    const defText = document.createElement('div');
    defText.className = 'def';
    defText.textContent = `default ${toggle ? (def ? 'on' : 'off') : show(def)}`;

    const update = (v: number) => {
      if (toggle) input.checked = v > 0;
      else input.value = String(v);
      val.textContent = toggle ? (v > 0 ? 'on' : 'off') : show(v);
      row.classList.toggle('changed', Math.abs(v - def) > 1e-9);
    };
    update(value);

    input.addEventListener('input', () => {
      const v = toggle ? (input.checked ? 1 : 0) : Number(input.value);
      update(v);
      set(v);
    });
    // Hand the keyboard back to the car after using a control (arrow keys must drive, not move sliders).
    input.addEventListener('pointerup', () => input.blur());
    input.addEventListener('change', () => input.blur());
    name.addEventListener('dblclick', () => {
      update(def);
      set(def);
    });

    row.append(top, input, defText);
    if (hint) {
      const hEl = document.createElement('div');
      hEl.className = 'hint';
      hEl.textContent = hint;
      row.append(hEl);
    }
    return row;
  }

  private button(text: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = text;
    b.addEventListener('click', () => {
      onClick();
      b.blur();
    });
    return b;
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.stored));
    } catch {
      // storage blocked: settings just won't persist
    }
  }

  private async copy(): Promise<void> {
    const text = JSON.stringify(
      { feel: this.stored.feel, sim: this.stored.sim, keyboard: this.stored.keyboard, race: this.stored.race },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(text);
      this.status.textContent = 'Copied! Paste it to Claude to make these the defaults.';
    } catch {
      this.status.textContent = 'Clipboard blocked — values printed to the browser console.';
      console.log(text);
    }
  }
}
