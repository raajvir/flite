"""
Surface authoring helper: a short per-corner spec -> the full surfaces.json band list.

    tools/.venv/bin/python tools/author_surfaces.py spa

Reads  data/tracks/<name>/corner_spec.json  and the detected corners in track.json.
Writes data/tracks/<name>/surfaces.json (the file the game reads; still hand-editable).

Per corner (matched by its number in the corner table printed by track_builder.py):
  {"id": 1, "name": "...", "outside": "gravel" | "runoff" | "grass" | "astroturf",
   "outside_width": 25, "sausage": false, "escape": false, "skip": false}
For each corner the generator lays, in this order (later bands win where they overlap):
  outside zone  - from just before the corner to after its exit, on the outside
  escape road   - optional tarmac straight ahead of the braking zone
  inside kerb   - around the apex (flat ramp kerb)
  sausage kerb  - optional, just behind the inside kerb
  exit kerb     - on the outside from the apex to the exit, with astroturf behind it
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

KERB_WIDTH_INSIDE = 1.3
KERB_WIDTH_EXIT = 1.4
SAUSAGE_OFFSET = 1.4
SAUSAGE_WIDTH = 0.5
TURF_WIDTH = 4.0
INSIDE_TURF_WIDTH = 3.0  # dark-green run-off behind the inside kerb
OUTSIDE_GAP_WITH_TURF = 4.0
OUTSIDE_LEAD = 20.0  # m before the corner the outside zone starts
OUTSIDE_TRAIL = 35.0  # m after the corner it ends
ESCAPE_LENGTH = 90.0  # m of escape road before the corner
ESCAPE_WIDTH = 25.0


def bands_for(c: dict, spec: dict, length: float) -> list[dict]:
    if spec.get("skip"):
        return []
    inside = c["direction"]  # "left"/"right" = the inside of the corner
    outside = "left" if inside == "right" else "right"
    s0, s1, apex = c["s_start"], c["s_end"], c["s_apex"]
    span = (s1 - s0) % length
    half = min(60.0, max(12.0, 0.35 * span))
    w = lambda a, b: (round(a % length, 1), round(b % length, 1))  # noqa: E731
    name = spec.get("name", f"corner {spec['id']}")
    out: list[dict] = []
    zone = spec.get("outside", "gravel")
    turf = spec.get("astroturf", True)
    if zone != "grass":
        a, b = w(s0 - OUTSIDE_LEAD, s1 + OUTSIDE_TRAIL)
        out.append({"note": f"{name}: outside {zone}", "s_start": a, "s_end": b, "side": outside,
                    "offset": OUTSIDE_GAP_WITH_TURF if turf else 1.5, "width": spec.get("outside_width", 25), "surface": zone})
    if spec.get("escape"):
        a, b = w(s0 - ESCAPE_LENGTH, s0 + 10)
        out.append({"note": f"{name}: escape road", "s_start": a, "s_end": b, "side": outside, "offset": 0,
                    "width": ESCAPE_WIDTH, "surface": "runoff"})
    a, b = w(apex - half, apex + half)
    out.append({"note": f"{name}: inside kerb", "s_start": a, "s_end": b, "side": inside, "offset": 0,
                "width": KERB_WIDTH_INSIDE, "surface": "kerb_flat"})
    if spec.get("sausage"):
        a, b = w(apex - 0.6 * half, apex + 0.6 * half)
        out.append({"note": f"{name}: sausage", "s_start": a, "s_end": b, "side": inside, "offset": SAUSAGE_OFFSET,
                    "width": SAUSAGE_WIDTH, "surface": "kerb_sausage"})
    if turf:
        a, b = w(apex - 0.8 * half, apex + 0.8 * half)
        out.append({"note": f"{name}: inside astroturf", "s_start": a, "s_end": b, "side": inside,
                    "offset": KERB_WIDTH_INSIDE + (SAUSAGE_WIDTH + 0.1 if spec.get("sausage") else 0), "width": INSIDE_TURF_WIDTH, "surface": "astroturf"})
    a, b = w(apex, s1 + 15)
    out.append({"note": f"{name}: exit kerb", "s_start": a, "s_end": b, "side": outside, "offset": 0,
                "width": KERB_WIDTH_EXIT, "surface": "kerb_flat"})
    if turf:
        a, b = w(apex + 5, s1 + 20)
        out.append({"note": f"{name}: exit astroturf", "s_start": a, "s_end": b, "side": outside, "offset": KERB_WIDTH_EXIT,
                    "width": TURF_WIDTH, "surface": "astroturf"})
    return out


def auto_spec(i: int, c: dict, corners: list[dict], length: float) -> dict:
    """Default surfaces for a corner without a hand-written spec (by radius and context)."""
    r = c["min_radius_m"]
    if r > 250:
        return {"id": i, "name": f"Turn {i} (fast kink)", "skip": True}
    spec = {"id": i, "name": f"Turn {i}"}
    # A tight corner right next to one turning the other way = a chicane -> sausage kerbs.
    for o in corners:
        if o is c or o["direction"] == c["direction"]:
            continue
        gap = min((o["s_start"] - c["s_end"]) % length, (c["s_start"] - o["s_end"]) % length)
        if gap < 80 and max(r, o["min_radius_m"]) < 45:
            spec["sausage"] = True
    prev_end = max(((c["s_start"] - o["s_end"]) % length for o in corners if o is not c), default=0)
    straight_before = min((c["s_start"] - o["s_end"]) % length for o in corners if o is not c) if len(corners) > 1 else 0
    if r < 30:
        spec.update(outside="runoff", outside_width=30, escape=straight_before > 300)
    elif r < 90:
        spec.update(outside="gravel", outside_width=28)
    else:
        spec.update(outside="gravel", outside_width=32)
    del prev_end
    return spec


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("track")
    args = ap.parse_args()
    tdir = ROOT / "data" / "tracks" / args.track
    track = json.loads((tdir / "track.json").read_text())
    spec_file = tdir / "corner_spec.json"
    corners = track["corners"]
    if spec_file.exists():
        spec = json.loads(spec_file.read_text())
    else:
        # No hand-written spec: generate one (and save it so it can be edited).
        L = track["length_m"]
        spec = {"note": "AUTO-GENERATED by tools/author_surfaces.py from corner radii (edit freely, then rerun).",
                "pitlane": {"s_start": round(L - 200, 1), "s_end": 400, "side": "right"},
                "corners": [auto_spec(i, c, corners, L) for i, c in enumerate(corners, 1)]}
        spec_file.write_text(json.dumps(spec, indent=1) + "\n")
    bands: list[dict] = []
    if "pitlane" in spec:
        p = spec["pitlane"]
        bands.append({"note": "pit lane", "s_start": p["s_start"], "s_end": p["s_end"], "side": p["side"], "offset": 6, "width": 10, "surface": "pitlane"})
    by_id = {c["id"]: c for c in spec["corners"]}
    for i, c in enumerate(corners, 1):
        bands += bands_for(c, by_id.get(i, {"id": i}), track["length_m"])
    out = {
        "description": f"Surface layout for the {track['name']} as bands along the track (generated by tools/author_surfaces.py from corner_spec.json; edit either).",
        "source": "APPROXIMATE: generated from the detected corners plus a per-corner spec written from general knowledge. Not yet checked against satellite imagery or OSM.",
        "edgeLine": {"width": 0.2, "surface": "paint"},
        "verge": "grass",
        "wallGap": 4,
        "wallMin": 14,
        "bands": bands,
    }
    (tdir / "surfaces.json").write_text(json.dumps(out, indent=1) + "\n")
    print(f"{track['name']}: {len(bands)} bands from {len(corners)} corners")


if __name__ == "__main__":
    main()
