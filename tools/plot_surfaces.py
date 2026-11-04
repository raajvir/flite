"""
Draw a track's surface layout to PNG (overview + one zoomed panel per corner).

    tools/.venv/bin/python tools/plot_surfaces.py monza

Uses the same files the game reads: data/tracks/<name>/track.json + surfaces.json
and data/surfaces.json for colours. North is up.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.patches import Polygon  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def load(name: str):
    tdir = ROOT / "data" / "tracks" / name
    track = json.loads((tdir / "track.json").read_text())
    layout = json.loads((tdir / "surfaces.json").read_text())
    colors = {k: v["color"] for k, v in json.loads((ROOT / "data" / "surfaces.json").read_text())["surfaces"].items()}
    return track, layout, colors


class Geo:
    def __init__(self, track: dict):
        cols = track["columns"]
        pts = np.array(track["points"])
        self.x = pts[:, cols.index("x")]
        self.z = pts[:, cols.index("z")]
        self.h = pts[:, cols.index("heading")]
        self.wl = pts[:, cols.index("w_left")]
        self.wr = pts[:, cols.index("w_right")]
        self.rd = pts[:, cols.index("race_d")]
        self.L = track["length_m"]
        self.n = len(pts)
        self.ds = self.L / self.n

    def idx(self, s0: float, s1: float) -> list[int]:
        span = (s1 - s0) % self.L
        k = int(span / self.ds) + 2
        i0 = int(round((s0 % self.L) / self.ds))
        return [(i0 + j) % self.n for j in range(k)]

    def xy(self, i: int, d: float) -> tuple[float, float]:
        # world (x, z) -> plot (x, north = -z); left normal (-cos h, sin h)
        X = self.x[i] - math.cos(self.h[i]) * d
        Z = self.z[i] + math.sin(self.h[i]) * d
        return X, -Z

    def strip(self, ids: list[int], d_in, d_out) -> np.ndarray:
        a = [self.xy(i, d_in(i)) for i in ids]
        b = [self.xy(i, d_out(i)) for i in reversed(ids)]
        return np.array(a + b)


def draw(ax, geo: Geo, layout: dict, colors: dict, lw: float = 0.0) -> None:
    allidx = list(range(geo.n)) + [0]
    verge = 14
    for sign, w in ((1, geo.wl), (-1, geo.wr)):
        ax.add_patch(Polygon(geo.strip(allidx, lambda i: sign * w[i], lambda i: sign * (w[i] + verge)), color=colors[layout["verge"]], lw=0))
    ax.add_patch(Polygon(geo.strip(allidx, lambda i: geo.wl[i], lambda i: -geo.wr[i]), color=colors["asphalt"], lw=0))
    ew = layout["edgeLine"]["width"]
    for sign, w in ((1, geo.wl), (-1, geo.wr)):
        ax.add_patch(Polygon(geo.strip(allidx, lambda i: sign * (w[i] - ew), lambda i: sign * w[i]), color=colors[layout["edgeLine"]["surface"]], lw=0))
    for b in layout["bands"]:
        ids = geo.idx(b["s_start"], b["s_end"])
        sign = 1 if b["side"] == "left" else -1
        w = geo.wl if sign > 0 else geo.wr
        poly = geo.strip(ids, lambda i: sign * (w[i] + b["offset"]), lambda i: sign * (w[i] + b["offset"] + b["width"]))
        ax.add_patch(Polygon(poly, color=colors[b["surface"]], lw=lw))
    rl = np.array([geo.xy(i, geo.rd[i]) for i in allidx])
    ax.plot(rl[:, 0], rl[:, 1], color="#ff00aa", lw=0.6, alpha=0.7)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("track")
    args = ap.parse_args()
    track, layout, colors = load(args.track)
    geo = Geo(track)
    corners = track.get("corners", [])

    ncol = 4
    nrow = 1 + math.ceil(len(corners) / ncol)
    fig = plt.figure(figsize=(16, 4 * nrow), facecolor="#2b2f36")
    ax = fig.add_subplot(nrow, 1, 1)
    draw(ax, geo, layout, colors)
    for k, c in enumerate(corners, 1):
        i = int(round(c["s_apex"] / geo.ds)) % geo.n
        X, N = geo.xy(i, 0)
        ax.annotate(str(k), (X, N), color="white", fontsize=9, ha="center", va="center",
                    bbox=dict(boxstyle="circle,pad=0.2", fc="#222", ec="white", lw=0.5))
    X0, N0 = geo.xy(0, 0)
    ax.plot([X0], [N0], marker="s", color="white", ms=5)
    ax.annotate("start", (X0, N0), color="white", fontsize=8, xytext=(6, 6), textcoords="offset points")
    ax.set_aspect("equal")
    ax.autoscale()
    ax.axis("off")
    ax.set_title(f"{track['name']} — surface layout ({track['length_m']:.0f} m, {track['length_error_pct']:+.2f}% vs official). Pink = racing line.",
                 color="white")

    for k, c in enumerate(corners, 1):
        a = fig.add_subplot(nrow, ncol, ncol + k)
        draw(a, geo, layout, colors, lw=0)
        i = int(round(c["s_apex"] / geo.ds)) % geo.n
        X, N = geo.xy(i, 0)
        r = 110
        a.set_xlim(X - r, X + r)
        a.set_ylim(N - r, N + r)
        a.set_aspect("equal")
        a.set_xticks([])
        a.set_yticks([])
        a.set_facecolor("#2b2f36")
        a.set_title(f"{k}: s={c['s_apex']:.0f} m, {c['direction']}, R{c['min_radius_m']:.0f}", color="white", fontsize=9)

    out = ROOT / "data" / "tracks" / args.track / "surface_map.png"
    fig.tight_layout()
    fig.savefig(out, dpi=90, facecolor=fig.get_facecolor())
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
