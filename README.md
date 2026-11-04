# flite — low-poly racing on real circuits

Browser racing game: low-poly look, real circuit layouts, one physics model with two
handling sets (`feel` = forgiving, default; `sim` = closer to real values). The car looks like a
mid-90s open-wheeler and performs like an F2-class car (~460 kW, 755 kg; other values estimated).

## Run it

```bash
npm install        # first time only
npm run dev        # then open http://localhost:5173
```

Opening the page shows the start menu: pick a circuit (Italian, Belgian, British, Japanese, or the
test area), laps, number of opponents (0 = practice), AI difficulty and handling set, then Start.
Esc opens the pause menu (resume, rewind, restart, settings, main menu, and the controls list).

Drive modes: Default (the tuned feel set), Sim, Arcade (very grippy, snappy, drifty — an original
tuning aiming for a PolyTrack-like feel), plus your own: tweak in the tuning panel (O) and
"Save as new mode". P cycles modes while driving.

Trackpad steering: K (or tuning panel → Steering input). Click the game to capture the pointer,
slide one finger left/right to steer; keys still do throttle/brake/boost. Range and centring are
adjustable. Esc releases the pointer and pauses.

URL options:
- `?track=test` — the flat cone test area instead of the circuit
- `?ai=3` — number of AI opponents (0–15), `?laps=5` — race length
- `?view=map` — start in the top-down surface map (V toggles it)
- `?demo` — autopilot: the AI drives your car (on the test area: scripted laps)
- `?demo=donut` — full lock + full throttle: smoke and skid marks
- `?tuning` — open the tuning panel on load
- `?set=sim` — use the `sim` handling set instead of `feel`

Controls: ↑/W throttle · ↓/S/Space brake (hold when stopped = reverse) · ←→/AD steer ·
Shift ERS boost · Esc pause · Z rewind 5 s · R back on track · Backspace restart race · V map view · L braking line · C chase/cockpit camera · P switch feel/sim handling · O tuning panel · M mute ·
T start/stop telemetry recording (saves a CSV).
Gamepad: left stick steer, right trigger throttle, left trigger brake (touch it to take over).

Tip: full lock + full throttle from a standstill (feel set) = donut.

Race settings live in the tuning panel (O → Race): AI difficulty (applies immediately) and the
braking line (green = flat out, yellow = slow down soon, red = brake now). Running close behind
another car gives a slipstream (less drag, a little less downforce); the HUD shows its strength.
The AI defends (one move to cover the inside, never under braking or once you're alongside),
leaves a car's width when side by side, and the car on the outside of a corner gives way.

## Checks

```bash
npm test           # physics + determinism tests (Vitest)
npm run typecheck  # TypeScript strict
npm run build      # production build into dist/
tools/.venv/bin/python -m pytest tools/tests   # track builder tests
```

## Tracks

```bash
python3 -m venv tools/.venv && tools/.venv/bin/pip install numpy scipy pandas matplotlib shapely pytest  # once
tools/.venv/bin/python tools/track_builder.py monza   # raw CSV -> data/tracks/monza/track.json
tools/.venv/bin/python tools/plot_surfaces.py monza   # -> data/tracks/monza/surface_map.png
tools/.venv/bin/python tools/elevation.py spa         # georeference via OSM + public DEM -> raw/elevation.csv
tools/.venv/bin/python tools/author_surfaces.py spa   # corner_spec.json -> surfaces.json
```

Each track folder has `raw/` (source data + license), `meta.json` (name, official length, camber),
`surfaces.json` (kerb/gravel/grass bands) and the built `track.json`.

## Layout

See `src/sim/README.md` for units and the coordinate system.

```
src/sim/     vehicle physics (pure, deterministic, SI units)
src/worker/  runs the sim at a fixed 1000 Hz in a Web Worker
src/render/  Three.js scene, cameras, interpolation
src/input/   keyboard, gamepad, demo driver
src/ai/      AI racing driver (same inputs as the player)
src/game/    race session: cars, contacts, laps, positions
tools/       Python track builder + surface map plotter
data/cars/   car parameters, "feel" and "sim" sets, every value tagged with its source
docs/demos/  screenshots from each milestone
```

## Status

- [x] M1 skeleton — box car, chase camera, 1000 Hz sim worker
- [x] M2 car model + feel tuning (+ live tuning panel, press O)
- [x] M3 surface system (per-wheel grip, drag, bumps; dust, rumble; test patches not built)
- [~] M4 first circuit (Italian circuit): drivable, kerbs/gravel/camber, map view; surface layout still to check against satellite imagery
- [~] AI racers (pulled forward): racing-line AI, overtaking, contacts, grid, laps, positions,
      difficulty slider, drafting, braking-line assist
- [~] Scenery: grandstands, pits, tower, bridges, start lights, trees (positions approximate)
- [~] M7 more circuits: Belgian, British, Japanese (real elevation; surfaces generated, approximate)
- [~] M5 game loop: start menu, pause menu, timing tower, lap box, mini-map, rewind (ghost replay not yet)
- [ ] M5 game loop
- [ ] M6 validation
- [ ] M7 more circuits
