"""
Elevation for a track: georeference the TUMFTM centreline against OpenStreetMap,
then sample a public DEM along it.

    tools/.venv/bin/python tools/elevation.py spa

Needs data/tracks/<name>/meta.json -> "geo": {"bbox": [south, west, north, east], "dataset": "eudem25m"}
Writes  raw/georef.json   (fitted transform + fit error)
        raw/elevation.csv (s_m, lat, lon, elev_m) — raw DEM samples; track_builder smooths them.

Steps
  1. Download OSM ways tagged highway=raceway in the bbox (Overpass API, with retries).
  2. Fit a 2D rigid transform (rotation + translation) taking the centreline's local
     x/y onto the OSM geometry: coarse rotation search, then ICP refinement.
  3. Query OpenTopoData for elevations every SAMPLE_STEP metres (100 points per request,
     ~1 request per second as the public API asks).
Only public map/elevation data is fetched; no project data is sent anywhere.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import track_builder as tb  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
TOPO = "https://api.opentopodata.org/v1/{dataset}?locations={locs}"
USER_AGENT = "flite-track-tools/0.1"
SAMPLE_STEP = 20.0  # m between elevation samples
EARTH_R = 6371000.0


def http(url: str, data: bytes | None = None, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def fetch_osm(bbox: list[float]) -> np.ndarray:
    s, w, n, e = bbox
    q = f'[out:json][timeout:60];way["highway"="raceway"]({s},{w},{n},{e});(._;>;);out skel qt;'
    data = urllib.parse.urlencode({"data": q}).encode()
    wait = 5.0
    for attempt in range(8):
        url = OVERPASS[attempt % len(OVERPASS)]
        try:
            res = json.loads(http(url, data, timeout=90))
            pts = np.array([[el["lat"], el["lon"]] for el in res["elements"] if el["type"] == "node"])
            if len(pts) > 50:
                print(f"OSM: {len(pts)} raceway nodes from {url}")
                return pts
            print(f"OSM: only {len(pts)} nodes from {url}, retrying")
        except Exception as ex:  # network / server busy
            print(f"OSM: {url} failed ({ex}); waiting {wait:.0f} s")
        time.sleep(wait)
        wait = min(wait * 2, 60)
    raise SystemExit("Could not get OSM raceway data (Overpass busy). Try again later.")


def to_local(latlon: np.ndarray, lat0: float, lon0: float) -> np.ndarray:
    """Equirectangular projection around (lat0, lon0): metres east (x) and north (y)."""
    x = np.radians(latlon[:, 1] - lon0) * EARTH_R * math.cos(math.radians(lat0))
    y = np.radians(latlon[:, 0] - lat0) * EARTH_R
    return np.column_stack([x, y])


def to_latlon(xy: np.ndarray, lat0: float, lon0: float) -> np.ndarray:
    lat = lat0 + np.degrees(xy[:, 1] / EARTH_R)
    lon = lon0 + np.degrees(xy[:, 0] / (EARTH_R * math.cos(math.radians(lat0))))
    return np.column_stack([lat, lon])


def densify(pts: np.ndarray, step: float = 3.0) -> np.ndarray:
    """OSM ways have sparse nodes on straights; add points along segments between near neighbours."""
    tree = cKDTree(pts)
    pairs = tree.query_pairs(r=200.0)
    extra = []
    for i, j in pairs:
        d = np.linalg.norm(pts[i] - pts[j])
        if d > step:
            k = int(d / step)
            t = np.linspace(0, 1, k + 2)[1:-1, None]
            extra.append(pts[i] + (pts[j] - pts[i]) * t)
    return np.vstack([pts] + extra) if extra else pts


def fit_rigid(src: np.ndarray, dst: np.ndarray) -> tuple[float, np.ndarray, float]:
    """Find rotation theta and translation t minimising distance from src (centreline) to dst (OSM)."""
    tree = cKDTree(dst)
    c_src, c_dst = src.mean(axis=0), dst.mean(axis=0)
    best = (math.inf, 0.0, c_dst - c_src)
    for deg in range(0, 360, 5):
        th = math.radians(deg)
        R = np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]])
        t = c_dst - R @ c_src
        for _ in range(30):  # ICP
            moved = src @ R.T + t
            _, idx = tree.query(moved)
            m = dst[idx]
            a = src - src.mean(axis=0)
            b = m - m.mean(axis=0)
            U, _, Vt = np.linalg.svd(a.T @ b)
            R = (U @ Vt).T
            if np.linalg.det(R) < 0:  # no reflections
                Vt[-1] *= -1
                R = (U @ Vt).T
            t = m.mean(axis=0) - R @ src.mean(axis=0)
        err = float(np.mean(tree.query(src @ R.T + t)[0]))
        if err < best[0]:
            best = (err, math.atan2(R[1, 0], R[0, 0]), t)
    return best[1], best[2], best[0]


def fetch_elevations(latlon: np.ndarray, dataset: str) -> np.ndarray:
    out = []
    for k in range(0, len(latlon), 100):
        chunk = latlon[k : k + 100]
        locs = "|".join(f"{a:.6f},{b:.6f}" for a, b in chunk)
        for attempt in range(5):
            try:
                res = json.loads(http(TOPO.format(dataset=dataset, locs=locs)))
                if res.get("status") != "OK":
                    raise RuntimeError(res)
                out += [r["elevation"] for r in res["results"]]
                break
            except Exception as ex:
                print(f"DEM request failed ({ex}); retrying")
                time.sleep(2 + 2 * attempt)
        else:
            raise SystemExit("DEM service unavailable")
        time.sleep(1.1)
        print(f"DEM: {len(out)}/{len(latlon)}")
    return np.array(out, dtype=float)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("track")
    args = ap.parse_args()
    tdir = ROOT / "data" / "tracks" / args.track
    meta = json.loads((tdir / "meta.json").read_text())
    geo = meta["geo"]
    s_, w_, n_, e_ = geo["bbox"]
    lat0, lon0 = (s_ + n_) / 2, (w_ + e_) / 2

    raw = tb.load_centerline(tdir / "raw" / "centerline.csv")
    osm = densify(to_local(fetch_osm(geo["bbox"]), lat0, lon0))
    src = raw[:, :2]
    theta, t, err = fit_rigid(src, osm)
    print(f"Fit: rotation {math.degrees(theta):.2f} deg, translation ({t[0]:.1f}, {t[1]:.1f}) m, mean error {err:.2f} m")
    (tdir / "raw" / "georef.json").write_text(
        json.dumps({"lat0": lat0, "lon0": lon0, "theta_rad": theta, "t_m": list(map(float, t)), "mean_fit_error_m": err}, indent=2)
    )
    if err > 15:
        raise SystemExit(f"Fit error {err:.1f} m is too large — check the bbox in meta.json")

    track = tb.resample(raw, ds=SAMPLE_STEP)
    xy = np.column_stack([track.x, -track.z])  # back to the CSV's x/y (north = +y)
    R = np.array([[math.cos(theta), -math.sin(theta)], [math.sin(theta), math.cos(theta)]])
    latlon = to_latlon(xy @ R.T + t, lat0, lon0)
    elev = fetch_elevations(latlon, geo["dataset"])
    with open(tdir / "raw" / "elevation.csv", "w") as f:
        f.write("# s_m,lat,lon,elev_m  (raw DEM samples from OpenTopoData " + geo["dataset"] + ")\n")
        for s, (la, lo), z in zip(track.s, latlon, elev):
            f.write(f"{s:.1f},{la:.6f},{lo:.6f},{z:.2f}\n")
    print(f"Wrote {len(elev)} samples; elevation range {elev.min():.1f}..{elev.max():.1f} m")


if __name__ == "__main__":
    main()
