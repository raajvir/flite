/**
 * Live tuning panel (press O). Sliders for car parameters and keyboard feel.
 *
 * - Changes apply instantly (sent to the sim worker as overrides).
 * - Drive modes: built-in (Default, Sim, Arcade) keep your edits; you can also
 *   save the current setup as your own named mode (car settings + keyboard feel).
 * - Everything is remembered in this browser.
 * - "Copy settings" puts the changed values on the clipboard as JSON, ready to
 *   be baked into data/cars/*.json as new defaults.
 */
import { DIFFICULTY } from '../ai/difficulty';
import { KEYBOARD_TUNING } from '../input/keyboard';
import type { ContactMode } from '../game/session';
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
      { key: 'powerScale', label: 'Engine power', min: 0.6, max: 1.6, step: 0.01, show: pct },
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

const STORAGE_KEY = 'flite.tuning.v2';
const OLD_STORAGE_KEY = 'flite.tuning.v1';
const KEYBOARD_DEFAULTS = { ...KEYBOARD_TUNING };

export interface RaceSettings {
  /** 0..1 */
  aiDifficulty: number;
  /** 0..1 */
  aiAggression: number;
  /** 0..1 */
  aiDefense: number;
  brakingLine: boolean;
  /** Car-to-car contact: full, assisted, or ghost cars */
  contact: ContactMode;
}

export interface InputSettings {
  trackpad: boolean;
  /** Pixels of finger movement for full lock */
  trackpadRange: number;
  /** Return-to-centre rate, per second (0 = stays where you leave it) */
  trackpadCentering: number;
  /** 0..1: nudges you back when you're drifting off the track */
  steeringAssist: number;
  /** 0..1: brakes for you when you arrive at a corner too fast */
  brakingAssist: number;
}

const RACE_DEFAULTS: RaceSettings = { aiDifficulty: DIFFICULTY.default, aiAggression: 0.5, aiDefense: 0.5, brakingLine: true, contact: 'full' };
export const INPUT_DEFAULTS: InputSettings = { trackpad: false, trackpadRange: 260, trackpadCentering: 1.5, steeringAssist: 0, brakingAssist: 0 };

export interface CustomMode {
  id: string;
  name: string;
  base: ParamSetName;
  overrides: ParamOverrides;
  keyboard: Partial<Record<KeyboardKey, number>>;
}

/** Built-in drive modes: one per parameter set. */
export const BUILTIN_MODES: { id: ParamSetName; name: string }[] = [
  { id: 'feel', name: 'Default' },
  { id: 'sim', name: 'Sim' },
  { id: 'arcade', name: 'Arcade' },
];

interface Stored {
  /** Edits to the built-in modes */
  builtin: Record<ParamSetName, ParamOverrides>;
  custom: CustomMode[];
  active: string;
  /** Keyboard feel for the built-in modes (custom modes carry their own) */
  keyboard: Partial<Record<KeyboardKey, number>>;
  race: RaceSettings;
  input: InputSettings;
}

function emptyStored(): Stored {
  return { builtin: { feel: {}, sim: {}, arcade: {} }, custom: [], active: 'feel', keyboard: {}, race: { ...RACE_DEFAULTS }, input: { ...INPUT_DEFAULTS } };
}

function loadStored(): Stored {
  const out = emptyStored();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Stored>;
      return {
        builtin: { ...out.builtin, ...s.builtin },
        custom: s.custom ?? [],
        active: s.active ?? 'feel',
        keyboard: s.keyboard ?? {},
        race: { ...RACE_DEFAULTS, ...s.race },
        input: { ...INPUT_DEFAULTS, ...s.input },
      };
    }
    // Carry over settings saved by the previous version of the panel.
    const old = localStorage.getItem(OLD_STORAGE_KEY);
    if (old) {
      const o = JSON.parse(old) as { feel?: ParamOverrides; sim?: ParamOverrides; keyboard?: Stored['keyboard']; race?: RaceSettings };
      out.builtin.feel = o.feel ?? {};
      out.builtin.sim = o.sim ?? {};
      out.keyboard = o.keyboard ?? {};
      out.race = { ...RACE_DEFAULTS, ...o.race };
    }
  } catch {
    // storage blocked or corrupt: start clean
  }
  return out;
}

const CSS = `
#tuning { position: fixed; top: 0; right: 0; bottom: 0; width: 330px; overflow-y: auto;
  background: rgba(18, 24, 32, 0.92); color: #e8edf2; font: 12px/1.4 ui-sans-serif, system-ui, sans-serif;
  padding: 10px 12px 24px; box-sizing: border-box; display: none; z-index: 30; }
#tuning.open { display: block; }
#tuning h2 { font-size: 14px; margin: 0 0 4px; }
#tuning .sub { color: #9fb0c0; margin-bottom: 8px; }
#tuning .buttons { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
#tuning button { flex: 1; background: #2c3a48; color: #e8edf2; border: 1px solid #44566a; border-radius: 4px;
  padding: 5px 6px; font: inherit; cursor: pointer; }
#tuning button:hover { background: #38495b; }
#tuning select { width: 100%; background: #2c3a48; color: #e8edf2; border: 1px solid #44566a; border-radius: 4px; padding: 5px; font: inherit; margin-bottom: 6px; }
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
  /** Default (un-overridden) params for a parameter set. */
  getDefaults: (set: ParamSetName) => CarParams;
  /** Called with the base set and full override map whenever the car setup changes (mode switch or slider). */
  onChange: (set: ParamSetName, overrides: ParamOverrides) => void;
  /** Called when a race setting (AI difficulty, braking line) changes. */
  onRaceChange: (race: RaceSettings) => void;
  /** Called when the steering-input settings change. */
  onInputChange: (input: InputSettings) => void;
}

export interface ModeInfo {
  id: string;
  name: string;
  builtin: boolean;
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
    if (!this.modes().some((m) => m.id === this.stored.active)) this.stored.active = 'feel';
    this.applyKeyboard();
    this.render();
  }

  // ---- Drive modes -------------------------------------------------------

  modes(): ModeInfo[] {
    return [
      ...BUILTIN_MODES.map((m) => ({ id: m.id, name: m.name, builtin: true })),
      ...this.stored.custom.map((m) => ({ id: m.id, name: m.name, builtin: false })),
    ];
  }

  get activeMode(): ModeInfo {
    return this.modes().find((m) => m.id === this.stored.active)!;
  }

  private customActive(): CustomMode | null {
    return this.stored.custom.find((m) => m.id === this.stored.active) ?? null;
  }

  /** Base parameter set and overrides of the active mode. */
  current(): { base: ParamSetName; overrides: ParamOverrides } {
    const c = this.customActive();
    if (c) return { base: c.base, overrides: { ...c.overrides } };
    const base = this.stored.active as ParamSetName;
    return { base, overrides: { ...this.stored.builtin[base] } };
  }

  setMode(id: string): void {
    if (!this.modes().some((m) => m.id === id)) return;
    this.stored.active = id;
    this.save();
    this.applyKeyboard();
    const c = this.current();
    this.opts.onChange(c.base, c.overrides);
    this.render();
  }

  /** Pick a mode without notifying (used at start-up, before the simulation exists). */
  selectSilently(id: string): void {
    if (!this.modes().some((m) => m.id === id)) return;
    this.stored.active = id;
    this.save();
    this.applyKeyboard();
    this.render();
  }

  cycleMode(): void {
    const all = this.modes();
    const i = all.findIndex((m) => m.id === this.stored.active);
    this.setMode(all[(i + 1) % all.length]!.id);
  }

  private saveAsNew(): void {
    const name = window.prompt('Name for this drive mode:', `${this.activeMode.name} (mine)`);
    if (!name) return;
    const cur = this.current();
    const id = `custom-${Date.now().toString(36)}`;
    this.stored.custom.push({ id, name: name.slice(0, 40), base: cur.base, overrides: cur.overrides, keyboard: { ...this.keyboardOverrides() } });
    this.stored.active = id;
    this.save();
    this.status.textContent = `Saved "${name}".`;
    this.render();
  }

  private deleteActive(): void {
    const c = this.customActive();
    if (!c || !window.confirm(`Delete drive mode "${c.name}"?`)) return;
    this.stored.custom = this.stored.custom.filter((m) => m !== c);
    this.setMode('feel');
  }

  private resetActive(): void {
    const c = this.customActive();
    if (c) {
      c.overrides = {};
      c.keyboard = {};
    } else {
      this.stored.builtin[this.stored.active as ParamSetName] = {};
      this.stored.keyboard = {};
    }
    this.save();
    this.applyKeyboard();
    const cur = this.current();
    this.opts.onChange(cur.base, cur.overrides);
    this.render();
  }

  private overridesRef(): ParamOverrides {
    const c = this.customActive();
    return c ? c.overrides : this.stored.builtin[this.stored.active as ParamSetName];
  }

  private keyboardOverrides(): Partial<Record<KeyboardKey, number>> {
    return this.customActive()?.keyboard ?? this.stored.keyboard;
  }

  private applyKeyboard(): void {
    Object.assign(KEYBOARD_TUNING, KEYBOARD_DEFAULTS, this.keyboardOverrides());
  }

  // ---- Race and input settings -------------------------------------------

  get race(): RaceSettings {
    return { ...this.stored.race };
  }

  get input(): InputSettings {
    return { ...this.stored.input };
  }

  setAiDifficulty(v: number): void {
    this.stored.race.aiDifficulty = Math.max(0, Math.min(1.5, v));
    this.save();
  }

  setBrakingLine(on: boolean): void {
    this.stored.race.brakingLine = on;
    this.save();
    this.opts.onRaceChange(this.race);
    this.render();
  }

  setTrackpad(on: boolean): void {
    this.stored.input.trackpad = on;
    this.save();
    this.opts.onInputChange(this.input);
    this.render();
  }

  get isOpen(): boolean {
    return this.el.classList.contains('open');
  }

  toggle(): void {
    this.el.classList.toggle('open');
  }

  // ---- Rendering -----------------------------------------------------------

  render(): void {
    const mode = this.activeMode;
    const { base } = this.current();
    const defaults = this.opts.getDefaults(base);
    const ov = this.overridesRef();
    this.el.replaceChildren();

    const h = document.createElement('h2');
    h.textContent = 'Tuning';
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = 'O to close · P cycles drive modes · double-click a name to reset it · changed values are yellow';
    this.el.append(h, sub);

    // Drive mode picker + actions.
    const select = document.createElement('select');
    for (const m of this.modes()) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.builtin ? m.name : `★ ${m.name}`;
      o.selected = m.id === mode.id;
      select.append(o);
    }
    select.addEventListener('change', () => {
      this.setMode(select.value);
      select.blur();
    });
    const buttons = document.createElement('div');
    buttons.className = 'buttons';
    buttons.append(this.button('Save as new mode', () => this.saveAsNew()), this.button(`Reset ${mode.name}`, () => this.resetActive()));
    if (!mode.builtin) buttons.append(this.button('Delete mode', () => this.deleteActive()));
    buttons.append(this.button('Copy settings', () => void this.copy()));
    const modeLabel = document.createElement('div');
    modeLabel.className = 'hint';
    modeLabel.textContent = mode.builtin
      ? 'Built-in mode: your edits are kept. Save as new mode to keep several setups.'
      : `Your mode (based on ${BUILTIN_MODES.find((b) => b.id === base)?.name}). Edits save automatically.`;
    this.el.append(select, modeLabel, buttons, this.status);

    // Race settings.
    const race = this.stored.race;
    this.el.append(
      this.group('Race', true, [
        this.row('AI difficulty', 'up to 100% = how much of its grip the AI uses; above 100% the AI cars also get extra grip and power (up to +15% / +10% at 150%)', 0, 1.5, 0.01, race.aiDifficulty, RACE_DEFAULTS.aiDifficulty, pct, false, (v) => {
          race.aiDifficulty = v;
          this.save();
          this.opts.onRaceChange(this.race);
        }),
        this.row('AI aggression', 'higher = tries passes from further back, follows closer, leaves less room, gives way less', 0, 1, 0.01, race.aiAggression, RACE_DEFAULTS.aiAggression, pct, false, (v) => {
          race.aiAggression = v;
          this.save();
          this.opts.onRaceChange(this.race);
        }),
        this.row('AI defending', '0 = never defends; higher = defends earlier and covers the inside tighter', 0, 1, 0.01, race.aiDefense, RACE_DEFAULTS.aiDefense, pct, false, (v) => {
          race.aiDefense = v;
          this.save();
          this.opts.onRaceChange(this.race);
        }),
        this.select('Car contact', 'Full = real collisions · Assisted = touches don\'t hook you · Ghost = cars pass through each other (no slipstream)', [
          ['full', 'Full contact'],
          ['assisted', 'Assisted'],
          ['ghost', 'Ghost cars'],
        ], race.contact, (v) => {
          race.contact = v as ContactMode;
          this.save();
          this.opts.onRaceChange(this.race);
        }),
        this.row('Braking line (L)', 'green = flat out, yellow = slow down soon, red = brake now', 0, 1, 1, race.brakingLine ? 1 : 0, 1, num(0), true, (v) => {
          race.brakingLine = v > 0;
          this.save();
          this.opts.onRaceChange(this.race);
        }),
      ]),
    );

    // Steering input.
    const inp = this.stored.input;
    const inputChanged = () => {
      this.save();
      this.opts.onInputChange(this.input);
    };
    this.el.append(
      this.group('Driving aids & input', true, [
        this.row('Steering assist', 'nudges you back when you are about to drift off the track (0 = off)', 0, 1, 0.05, inp.steeringAssist, 0, pct, false, (v) => {
          inp.steeringAssist = v;
          inputChanged();
        }),
        this.row('Braking assist', 'brakes for you when you arrive at a corner too fast (0 = off)', 0, 1, 0.05, inp.brakingAssist, 0, pct, false, (v) => {
          inp.brakingAssist = v;
          inputChanged();
        }),
        this.row('Trackpad steering (K)', 'click the game to capture the pointer, slide one finger left/right to steer; keys still do throttle/brake', 0, 1, 1, inp.trackpad ? 1 : 0, 0, num(0), true, (v) => {
          inp.trackpad = v > 0;
          inputChanged();
        }),
        this.row('Trackpad range', 'finger travel for full lock (smaller = more sensitive)', 80, 600, 10, inp.trackpadRange, INPUT_DEFAULTS.trackpadRange, (v) => `${v.toFixed(0)} px`, false, (v) => {
          inp.trackpadRange = v;
          inputChanged();
        }),
        this.row('Trackpad centring', 'how quickly steering drifts back to straight when you stop moving (0 = stays put)', 0, 6, 0.1, inp.trackpadCentering, INPUT_DEFAULTS.trackpadCentering, num(1), false, (v) => {
          inp.trackpadCentering = v;
          inputChanged();
        }),
      ]),
    );

    // Car parameter groups (edit the active mode).
    for (const g of GROUPS) {
      this.el.append(
        this.group(
          g.title,
          g.title === 'Assists',
          g.items.map((spec) => {
            const def = defaults[spec.key];
            return this.row(spec.label, spec.hint, spec.min, spec.max, spec.step, ov[spec.key] ?? def, def, spec.show ?? num(3), !!spec.toggle, (v) => {
              if (v === def) delete ov[spec.key];
              else ov[spec.key] = v;
              this.save();
              this.opts.onChange(base, { ...ov });
            });
          }),
        ),
      );
    }

    // Keyboard feel (per mode for custom modes).
    const kb = this.keyboardOverrides();
    this.el.append(
      this.group(
        'Keyboard feel',
        false,
        KEYBOARD_ITEMS.map((spec) => {
          const def = KEYBOARD_DEFAULTS[spec.key];
          return this.row(spec.label, spec.hint, spec.min, spec.max, spec.step, KEYBOARD_TUNING[spec.key], def, num(1), false, (v) => {
            KEYBOARD_TUNING[spec.key] = v;
            if (v === def) delete kb[spec.key];
            else kb[spec.key] = v;
            this.save();
          });
        }),
      ),
    );
  }

  private group(title: string, open: boolean, rows: HTMLElement[]): HTMLDetailsElement {
    const d = document.createElement('details');
    d.open = open;
    const s = document.createElement('summary');
    s.textContent = title;
    d.append(s, ...rows);
    return d;
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

  private select(label: string, hint: string, options: [string, string][], value: string, set: (v: string) => void): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'row';
    const top = document.createElement('div');
    top.className = 'top';
    const name = document.createElement('span');
    name.className = 'label';
    name.textContent = label;
    top.append(name);
    const sel = document.createElement('select');
    for (const [v, text] of options) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = text;
      o.selected = v === value;
      sel.append(o);
    }
    sel.addEventListener('change', () => {
      set(sel.value);
      sel.blur();
    });
    const h = document.createElement('div');
    h.className = 'hint';
    h.textContent = hint;
    row.append(top, sel, h);
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
      { mode: this.activeMode.name, ...this.current(), keyboard: this.keyboardOverrides(), race: this.stored.race, input: this.stored.input },
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
