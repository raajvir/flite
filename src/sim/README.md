# src/sim — vehicle simulation (pure TypeScript)

Rules for everything in this folder:

- **Pure.** No DOM, no Three.js, no `Date.now()`, no `Math.random()`. The core is
  `step(state, inputs, params, dt) -> newState`. (`params` is the car's loaded
  parameter set; it never changes during a run.)
- **Deterministic.** Same start state + same input sequence = bit-identical result.
  Covered by `tests/sim/determinism.test.ts`.
- **SI units everywhere:** m, kg, s, N, rad. Speeds in m/s (convert to km/h only for display).
- **No magic numbers.** Car parameters come from `data/cars/*.json`. Physical constants
  live in `constants.ts`. Numerical-safety thresholds are named constants at the top of a file.
- **Fixed timestep:** 1000 Hz (`SIM_DT = 0.001 s`), run by `src/worker/`.

## Coordinate system

Right-handed, **+Y up** (same as Three.js, so no conversion is needed when rendering).

```
        -Z  (car forward when yaw = 0)
         ^
         |
 -X <----+----> +X   (car right when yaw = 0)
         |
        +Z
   (+Y points out of the screen, towards you, looking down from above)
```

- **World:** ground is the X–Z plane, height is Y.
- **Car body frame:** forward = −Z, right = +X, up = +Y.
  - `u` = forward speed (positive = forwards), `v` = lateral speed (positive = rightwards).
- **Yaw** = rotation about +Y. Positive yaw = counter-clockwise seen from above = **turning left**.
  The forward vector at yaw ψ is `(-sin ψ, 0, -cos ψ)`.
- **Steering:** `inputs.steer` +1 = full left, −1 = full right. Same sign as yaw, so a positive
  steer gives a positive yaw rate when driving forwards.

## Inputs (the driver interface)

`DriverInputs = { steer: −1..1, throttle: 0..1, brake: 0..1 }`.
Keyboard, gamepad, replays and the future AI driver all produce exactly this struct.
Nothing else can move the car.

## Current model (M1)

Kinematic bicycle (no tires). This placeholder lets us build the pipeline. M2 replaces it with a
four-wheel chassis, weight transfer and Pacejka tires, and keeps the same function signature.
