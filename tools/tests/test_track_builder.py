"""pytest: tools/.venv/bin/python -m pytest tools/tests"""
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import track_builder as tb  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def built():
    return json.loads((ROOT / "data" / "tracks" / "monza" / "track.json").read_text())


def test_length_within_one_percent():
    t = built()
    assert abs(t["length_m"] - t["official_length_m"]) / t["official_length_m"] < 0.01


def test_samples_evenly_spaced_and_closed():
    t = built()
    pts = np.array(t["points"])
    x, z = pts[:, 0], pts[:, 1]
    seg = np.hypot(np.diff(np.append(x, x[0])), np.diff(np.append(z, z[0])))
    assert np.all(np.abs(seg - t["ds_m"]) < 0.2), "samples should be ~ds apart, including the closing segment"


def test_heading_matches_direction_of_travel():
    t = built()
    pts = np.array(t["points"])
    x, z, h = pts[:, 0], pts[:, 1], pts[:, 2]
    dx, dz = np.roll(x, -1) - x, np.roll(z, -1) - z
    fwd_dot = (-np.sin(h)) * dx + (-np.cos(h)) * dz
    assert np.all(fwd_dot > 0), "heading must point along increasing s"


def test_racing_line_inside_the_track():
    t = built()
    c = t["columns"]
    pts = np.array(t["points"])
    d, wl, wr = pts[:, c.index("race_d")], pts[:, c.index("w_left")], pts[:, c.index("w_right")]
    assert np.all(d <= wl) and np.all(d >= -wr)


def test_finds_the_main_corners():
    t = built()
    assert len(t["corners"]) >= 10
    assert min(c["min_radius_m"] for c in t["corners"]) < 30  # the chicanes


def test_banking_ramps():
    track = tb.Track(s=np.arange(0, 1000, 2.0), x=None, z=None, heading=None, kappa=None, w_left=None, w_right=None, length=1000.0)
    bank = tb.banking_profile(track, {"banking": [{"s_start": 100, "s_end": 300, "angle_deg": 4, "ramp_m": 50}]})
    assert bank[0] == 0
    assert math.isclose(bank[100], math.radians(4))  # s = 200, middle of the band
    assert 0 < bank[60] < math.radians(4)  # s = 120, on the ramp


def test_terrain_never_above_the_road_near_the_track():
    """Smoothing must not lift the ground above the road (it did in Spa's dips)."""
    import json as _json
    from scipy.spatial import cKDTree as _Tree
    for name in ["spa", "suzuka", "silverstone", "monza"]:
        t = _json.loads((ROOT / "data" / "tracks" / name / "track.json").read_text())
        c = t["columns"]
        pts = np.array(t["points"])
        x, z, e = pts[:, c.index("x")], pts[:, c.index("z")], pts[:, c.index("elev")]
        g = t["terrain"]
        gx = g["x0"] + np.arange(g["nx"]) * g["cell"]
        gz = g["z0"] + np.arange(g["nz"]) * g["cell"]
        XX, ZZ = np.meshgrid(gx, gz)
        H = np.array(g["h"]).reshape(g["nz"], g["nx"])
        tree = _Tree(np.column_stack([x, z]))
        d, idx = tree.query(np.column_stack([XX.ravel(), ZZ.ravel()]))
        close = d < 40
        assert np.all(H.ravel()[close] <= e[idx][close] + 1e-6), name
