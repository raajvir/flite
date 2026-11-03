# flite — low-poly racing on real circuits

Browser racing game: low-poly look, real circuit layouts, one physics model with two
handling sets (`feel` = forgiving, default; `sim` = closer to real values).

## Run it

```bash
npm install        # first time only
npm run dev        # then open http://localhost:5173
```

URL options:
- `?demo` — an autopilot drives laps of the test area (no keyboard needed)
- `?demo=donut` — full lock + full throttle: smoke and skid marks
- `?tuning` — open the tuning panel on load
- `?set=sim` — use the `sim` handling set instead of `feel`

Controls: ↑/W throttle · ↓/S/Space brake (hold when stopped = reverse) · ←→/AD steer ·
R reset · C chase/cockpit camera · P switch feel/sim handling · O tuning panel · M mute ·
T start/stop telemetry recording (saves a CSV).
Gamepad: left stick steer, right trigger throttle, left trigger brake (touch it to take over).

Tip: full lock + full throttle from a standstill (feel set) = donut.

## Checks

```bash
npm test           # physics + determinism tests (Vitest)
npm run typecheck  # TypeScript strict
npm run build      # production build into dist/
```

## Layout

See `src/sim/README.md` for units and the coordinate system.

```
src/sim/     vehicle physics (pure, deterministic, SI units)
src/worker/  runs the sim at a fixed 1000 Hz in a Web Worker
src/render/  Three.js scene, cameras, interpolation
src/input/   keyboard (and demo driver; gamepad later)
data/cars/   car parameters, "feel" and "sim" sets, every value tagged with its source
docs/demos/  screenshots from each milestone
```

## Status

- [x] M1 skeleton — box car, chase camera, 1000 Hz sim worker
- [x] M2 car model + feel tuning (+ live tuning panel, press O)
- [ ] M3 surface system
- [ ] M4 first circuit (Italian circuit)
- [ ] M5 game loop
- [ ] M6 validation
- [ ] M7 more circuits
