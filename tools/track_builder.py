"""
Track builder: raw TUMFTM centreline CSV -> data/tracks/<name>/track.json

    tools/.venv/bin/python tools/track_builder.py monza

Steps
  1. Load the closed centreline (x, y, w_right, w_left).
  2. Fit a periodic smoothing spline and resample every DS metres.
  3. Convert to game axes: X = x (east), Z = -y (north is -Z), Y up.
  4. Compute distance s, heading, curvature, widths.
  5. Camber (banking) per sample from meta.json (authored per corner).
  6. Racing line -> lateral offset from the centreline at each sample.
  7. Detect corners from curvature (for authoring surfaces), check length.

Conventions (match src/sim/README.md): heading = yaw of the track direction
(rotation about +Y, 0 = facing -Z). Lateral offset d is positive to the LEFT
of the driving direction. Banking is positive when the LEFT edge is higher.
"""
from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.interpolate import splev, splprep

ROOT = Path(__file__).resolve().parent.parent
DS = 2.0  # m between samples
SMOOTHING_PER_POINT = 0.05  # spline smoothing (m^2 per input point): removes survey noise, keeps shape
CORNER_KAPPA = 1 / 400  # curvature above this counts as "in a corner" (radius < 400 m)
CORNER_MIN_LENGTH = 20.0  # m; shorter curvature blips are ignored


@dataclass
class Track:
    s: np.ndarray
    x: np.ndarray
    z: np.ndarray
    heading: np.ndarray
    kappa: np.ndarray  # curvature, 1/m, positive = turning left
    w_left: np.ndarray
    w_right: np.ndarray
    length: float


def load_centerline(path: Path) -> np.ndarray:
    data = np.loadtxt(path, delimiter=",", comments="#")
    if data.shape[1] != 4:
        raise ValueError(f"{path}: expected 4 columns, got {data.shape[1]}")
    return data


def resample(raw: np.ndarray, ds: float = DS) -> Track:
    x, y, wr, wl = raw.T
    # Close the loop for the periodic fit (drop a duplicated end point if present).
    if math.hypot(x[0] - x[-1], y[0] - y[-1]) < 0.5:
        x, y, wr, wl = x[:-1], y[:-1], wr[:-1], wl[:-1]
    pts = [np.append(a, a[0]) for a in (x, y, wr, wl)]
    tck, u = splprep(pts, s=SMOOTHING_PER_POINT * len(x), per=1)

    # Arc length on a dense evaluation, then resample uniformly in arc length.
    dense_u = np.linspace(0, 1, 20000, endpoint=False)
    dx, dy = splev(dense_u, tck)[:2]
    seg = np.hypot(np.diff(np.append(dx, dx[0])), np.diff(np.append(dy, dy[0])))
    cum = np.concatenate([[0], np.cumsum(seg)])
    length = float(cum[-1])
    n = int(round(length / ds))
    s = np.linspace(0, length, n, endpoint=False)
    u_s = np.interp(s, cum, np.append(dense_u, 1.0))

    px, py, pwr, pwl = splev(u_s, tck)
    d1x, d1y = splev(u_s, tck, der=1)[:2]
    d2x, d2y = splev(u_s, tck, der=2)[:2]
    kappa = (d1x * d2y - d1y * d2x) / np.power(d1x**2 + d1y**2, 1.5)  # >0 = turning left (CCW in x-y)

    # Game axes: X = x, Z = -y. Direction (dx, dz) = (d1x, -d1y).
    # heading: forward = (-sin h, -cos h)  =>  h = atan2(-dX, -dZ)
    heading = np.unwrap(np.arctan2(-d1x, d1y))
    return Track(s=s, x=px, z=-py, heading=heading, kappa=kappa, w_left=pwl, w_right=pwr, length=length)


def lateral_offsets(track: Track, line_xy: np.ndarray) -> np.ndarray:
    """Signed lateral offset (left +) of a closed polyline (e.g. racing line) at each track sample."""
    lx, lz = line_xy[:, 0], -line_xy[:, 1]
    # Densify the line so nearest-point projection is accurate.
    t = np.linspace(0, 1, len(lx) + 1)
    dense = np.linspace(0, 1, len(lx) * 10, endpoint=False)
    lxd = np.interp(dense, t, np.append(lx, lx[0]))
    lzd = np.interp(dense, t, np.append(lz, lz[0]))
    out = np.empty_like(track.s)
    for i in range(len(track.s)):
        # Left normal of the track direction: forward (-sin h, -cos h) -> left (-cos h, sin h)
        fx, fz = -math.sin(track.heading[i]), -math.cos(track.heading[i])
        nx, nz = -math.cos(track.heading[i]), math.sin(track.heading[i])
        rx, rz = lxd - track.x[i], lzd - track.z[i]
        along = rx * fx + rz * fz
        # Points nearly on the normal line through this sample, nearest one wins.
        cand = np.abs(along) < 3.0
        if not np.any(cand):
            cand = np.ones_like(along, dtype=bool)
        dist = np.where(cand, np.hypot(rx, rz), np.inf)
        j = int(np.argmin(dist))
        out[i] = rx[j] * nx + rz[j] * nz
    return out


def banking_profile(track: Track, meta: dict) -> np.ndarray:
    """Banking angle (rad) per sample from authored corner entries, with linear ramps in and out."""
    bank = np.zeros_like(track.s)
    for c in meta.get("banking", []):
        s0, s1, deg, ramp = c["s_start"], c["s_end"], c["angle_deg"], c.get("ramp_m", 30.0)
        ang = math.radians(deg)
        # Distance into the band, wrapping around the lap.
        rel = (track.s - s0) % track.length
        span = (s1 - s0) % track.length
        w = np.clip(np.minimum(rel / ramp, (span - rel) / ramp), 0, 1)
        w[rel > span] = 0
        bank += ang * w
    return bank


def detect_corners(track: Track) -> list[dict]:
    """Group consecutive high-curvature samples into corners."""
    k = np.convolve(np.concatenate([track.kappa[-5:], track.kappa, track.kappa[:5]]), np.ones(11) / 11, mode="valid")
    inside = np.abs(k) > CORNER_KAPPA
    corners = []
    n = len(inside)
    i = 0
    # Start scanning from a straight section so a corner isn't split at s = 0.
    start = int(np.argmin(np.abs(k)))
    idx = [(start + j) % n for j in range(n)]
    while i < n:
        if inside[idx[i]]:
            j = i
            while j < n and inside[idx[j]]:
                j += 1
            seg = [idx[m] for m in range(i, j)]
            s0, s1 = track.s[seg[0]], track.s[seg[-1]]
            span = (s1 - s0) % track.length
            if span >= CORNER_MIN_LENGTH:
                apex = seg[int(np.argmax(np.abs(k[seg])))]
                corners.append(
                    {
                        "s_start": round(float(s0), 1),
                        "s_end": round(float(s1), 1),
                        "s_apex": round(float(track.s[apex]), 1),
                        "direction": "left" if k[apex] > 0 else "right",
                        "min_radius_m": round(float(1 / abs(k[apex])), 1),
                    }
                )
            i = j
        else:
            i += 1
    corners.sort(key=lambda c: c["s_apex"])
    return corners


def build(name: str) -> dict:
    tdir = ROOT / "data" / "tracks" / name
    meta = json.loads((tdir / "meta.json").read_text())
    track = resample(load_centerline(tdir / "raw" / "centerline.csv"))
    raceline = np.loadtxt(tdir / "raw" / "raceline.csv", delimiter=",", comments="#")
    race_d = lateral_offsets(track, raceline)
    bank = banking_profile(track, meta)
    corners = detect_corners(track)

    official = meta["official_length_m"]
    err = (track.length - official) / official
    out = {
        "name": meta["display_name"],
        "source": "TUMFTM racetrack-database (LGPL-3.0), resampled by tools/track_builder.py",
        "length_m": round(track.length, 2),
        "official_length_m": official,
        "length_error_pct": round(100 * err, 3),
        "ds_m": DS,
        "closed": True,
        "columns": ["x", "z", "heading", "kappa", "w_left", "w_right", "bank", "elev", "race_d"],
        "points": [
            [
                round(float(track.x[i]), 3),
                round(float(track.z[i]), 3),
                round(float(track.heading[i]), 5),
                round(float(track.kappa[i]), 6),
                round(float(track.w_left[i]), 3),
                round(float(track.w_right[i]), 3),
                round(float(bank[i]), 5),
                0.0,  # elevation: no DEM yet
                round(float(np.clip(race_d[i], -track.w_right[i] + 0.5, track.w_left[i] - 0.5)), 3),
            ]
            for i in range(len(track.s))
        ],
        "corners": corners,
    }
    (tdir / "track.json").write_text(json.dumps(out, separators=(",", ":")))
    (tdir / "corners.json").write_text(json.dumps(corners, indent=2))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("track")
    args = ap.parse_args()
    out = build(args.track)
    print(f"{out['name']}: length {out['length_m']:.1f} m vs official {out['official_length_m']} m "
          f"({out['length_error_pct']:+.2f}%), {len(out['points'])} samples")
    print(f"{'#':>2} {'s_start':>8} {'s_apex':>8} {'s_end':>8} {'dir':>6} {'R min':>7}")
    for i, c in enumerate(out["corners"], 1):
        print(f"{i:>2} {c['s_start']:>8} {c['s_apex']:>8} {c['s_end']:>8} {c['direction']:>6} {c['min_radius_m']:>7}")


if __name__ == "__main__":
    main()
