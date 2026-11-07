"""
Two-station (progressive) can crusher.

Same frame, lever and linkage as can_crusher.py, but the crosshead carries both
tools at once:
  * station 1 (front): the Ø20 crease bar, across the middle of a fresh can;
  * station 2 (back, under the linkage): the flat platen, over the can creased
    on the previous stroke.
Every stroke creases one can and flattens the one before it. Between strokes
you slide the creased can back from station 1 to station 2 (against the rear
stop). There is no latch, ratchet or tool change: the simulator showed that a
single head which holds the crease bar down while flattening traps metal and
needs about twice the force, so the bar must be clear before the platen works.

Coordinates as in can_crusher.py (Z up, X left-right, Y front-back), but here
the can lies along X and station 1 is at Y = -station_pitch.

Run:  python progressive_crusher.py            # writes ./out_progressive
      python progressive_crusher.py --set station_pitch=140
"""
import argparse
import csv
import json
import os

import cadquery as cq

import can_crusher as cc
from can_crusher import box, cyl

PP = dict(cc.PARAMS)
PP.update({
    "station_pitch": 135.0,  # station 1 (crease) to station 2 (flatten), along Y
    "tool_low_gap": 12.0,    # both tools stop 12 mm above the bed: about 3.3 kN peak (8 mm needs ~6.9 kN)
    "pin_rise": 45.0,        # crosshead pin on ears, links stay clear of the front arm
    "bar_len": 130.0, "hanger_x": 58.0,
    "platen_w": 150.0, "platen_d": 120.0,
    "tongue_w": 140.0, "tongue_t": 20.0,
    "base_w": 280.0, "base_d": 330.0,
    "station_w": 150.0, "cradle1_d": 110.0, "pad_d": 130.0, "stop_h": 6.0,
})


def base_plate(p, d):
    y0 = -p["station_pitch"] - p["cradle1_d"] / 2 - 25
    s = box(-p["base_w"] / 2, p["base_w"] / 2, y0, y0 + p["base_d"], -p["base_t"], 0)
    pts = [(sx * p["post_spacing"] / 2 + dx, dy) for sx in (-1, 1) for dx in (-13, 13) for dy in (-13, 13)]
    pts += [(cx, -p["station_pitch"] + cy) for cx in (-55, 55) for cy in (-35, 35)]
    pts += [(cx, cy) for cx in (-55, 55) for cy in (-45, 45)]
    for (x, y) in pts:
        s = s.cut(cyl(2.75, 40, (x, y, -30), (0, 0, 1)))
    for sx in (-1, 1):
        x = sx * p["post_spacing"] / 2
        s = s.cut(cyl(3.25, 40, (x, 0, -30), (0, 0, 1)))
        s = s.cut(cyl(10.0, 8, (x, 0, -p["base_t"] - 1), (0, 0, 1)))
    return s


def cradle_station1(p, d):
    """Crease station: groove along X so the fresh can cannot roll."""
    yc = -p["station_pitch"]
    w, dd = p["station_w"] / 2, p["cradle1_d"] / 2
    s = box(-w, w, yc - dd, yc + dd, 0, p["cradle_t"])
    R = p["can_d"] / 2 + 1
    zc = p["cradle_t"] - p["groove_depth"] + R
    s = s.cut(cyl(R, 400, (-200, yc, zc), (1, 0, 0)))
    for cx in (-55, 55):
        for cy in (-35, 35):
            s = s.cut(cyl(2.75, 40, (cx, yc + cy, -1), (0, 0, 1)))
            s = s.cut(cyl(5.0, 40, (cx, yc + cy, 4), (0, 0, 1)))
    return s


def pad_station2(p, d):
    """Flatten station: flat pad with a rear stop the creased can is pushed against."""
    w, dd = p["station_w"] / 2, p["pad_d"] / 2
    s = box(-w, w, -dd, dd, 0, p["cradle_t"])
    ys = p["platen_d"] / 2 + 2  # stop sits just behind the platen
    s = s.union(box(-w, w, ys, dd, p["cradle_t"] - 0.5, p["cradle_t"] + p["stop_h"]))
    for cx in (-55, 55):
        for cy in (-45, 45):
            s = s.cut(cyl(2.75, 40, (cx, cy, -1), (0, 0, 1)))
            s = s.cut(cyl(5.0, 40, (cx, cy, 4), (0, 0, 1)))
    return s


def crosshead(p, d, dz=0.0):
    """Crosshead with a front arm (tongue) that carries the crease-bar head."""
    s = cc.crosshead(p, d, dz)
    z0 = d["z_xh_bot_low"] + dz
    yf = -p["station_pitch"] - p["hanger_x"] - p["hanger_t"] / 2 - 8
    tw = p["tongue_w"] / 2
    s = s.union(box(-tw, tw, yf, -p["xh_depth"] / 2 + 1, z0, z0 + p["tongue_t"]))
    yc = -p["station_pitch"]
    for bx in (-p["mount_bolt_y"], p["mount_bolt_y"]):
        for by in (-p["mount_bolt_x"], p["mount_bolt_x"]):
            s = s.cut(cyl(p["mount_bolt_d"] / 2, 100, (bx, yc + by, z0 - 1), (0, 0, 1)))
            s = s.cut(cyl(5.5, 100, (bx, yc + by, z0 + p["tongue_t"] - 6), (0, 0, 1)))
    return s


def bar_head(p, d, dz=0.0):
    return cc.bar_head(p, d, dz).rotate((0, 0, 0), (0, 0, 1), 90).translate((0, -p["station_pitch"], 0))


def crease_bar(p, d, dz=0.0):
    return cc.crease_bar(p, d, dz).rotate((0, 0, 0), (0, 0, 1), 90).translate((0, -p["station_pitch"], 0))


def can_station1(p, d):
    R = p["can_d"] / 2
    zc = p["cradle_t"] - p["groove_depth"] + R
    return cyl(R, p["can_len"], (-p["can_len"] / 2, -p["station_pitch"], zc), (1, 0, 0))


def build(p, theta):
    d = cc.derive(p)
    _, zx = cc.kinematics(p, d, theta)
    dz = zx - d["z_xpin_low"]
    orange, blue, green, steel = (0.85, 0.35, 0.10), (0.20, 0.45, 0.80), (0.20, 0.65, 0.35), (0.75, 0.75, 0.78)
    parts = {
        "base_plate": (base_plate(p, d), (0.72, 0.58, 0.40)),
        "post_foot_L": (cc.post_foot(p, d, -1), orange),
        "post_foot_R": (cc.post_foot(p, d, 1), orange),
        "guide_post_L": (cc.guide_post(p, d, -1), steel),
        "guide_post_R": (cc.guide_post(p, d, 1), steel),
        "cradle_station1": (cradle_station1(p, d), orange),
        "pad_station2": (pad_station2(p, d), orange),
        "crosshead": (crosshead(p, d, dz), blue),
        "bushing_L": (cc.bushing(p, d, -1, dz), (0.6, 0.6, 0.6)),
        "bushing_R": (cc.bushing(p, d, 1, dz), (0.6, 0.6, 0.6)),
        "bridge": (cc.bridge(p, d), blue),
        "crank_plate_F": (cc.crank_plate(p, d, -1, theta), orange),
        "crank_plate_B": (cc.crank_plate(p, d, 1, theta), orange),
        "handle_socket": (cc.handle_socket(p, d, theta), orange),
        "handle": (cc.handle(p, d, theta), (0.15, 0.15, 0.15)),
        "link_F": (cc.link(p, d, -1, theta), (0.55, 0.55, 0.58)),
        "link_B": (cc.link(p, d, 1, theta), (0.55, 0.55, 0.58)),
        "pins": (cc.pins(p, d, theta), (0.3, 0.3, 0.3)),
        "bar_head": (bar_head(p, d, dz), green),
        "crease_bar": (crease_bar(p, d, dz), steel),
        "platen_head": (cc.platen_head(p, d, dz), green),
        "can_station1": (can_station1(p, d), (0.85, 0.85, 0.88)),
    }
    return d, parts


def print_parts(p, d):
    out = {}
    base = cc.print_parts(p, d)
    for k in ("post_foot", "bridge", "crank_plate", "handle_socket", "platen_head"):
        out[k] = base[k]
    out["crosshead"] = crosshead(p, d)
    out["bar_head"] = cc.bar_head(p, d).rotate((0, 0, 0), (1, 0, 0), 180)
    out["cradle_station1"] = cradle_station1(p, d)
    out["pad_station2"] = pad_station2(p, d)
    for k, s in out.items():
        bb = s.val().BoundingBox()
        out[k] = s.translate((-(bb.xmin + bb.xmax) / 2, -(bb.ymin + bb.ymax) / 2, -bb.zmin))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", action="append", default=[])
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "out_progressive"))
    args = ap.parse_args()
    p = dict(PP)
    for kv in args.set:
        k, v = kv.split("=")
        if k not in p:
            raise SystemExit(f"unknown parameter {k}")
        p[k] = float(v)
    out = args.out
    for sub in ("step", "stl", "dxf"):
        os.makedirs(os.path.join(out, sub), exist_ok=True)
    d, closed = build(p, 180.0)
    _, opened = build(p, 180.0 - p["crank_swing"])
    for name, parts in (("assembly_closed", closed), ("assembly_open", opened)):
        asm = cq.Assembly(name=f"progressive_crusher_{name}")
        for k, (shape, col) in parts.items():
            asm.add(shape, name=k, color=cq.Color(*col))
        asm.export(os.path.join(out, f"progressive_crusher_{name}.step"))
    for k, (shape, _) in closed.items():
        cq.exporters.export(shape, os.path.join(out, "step", f"{k}.step"))
    for k, s in print_parts(p, d).items():
        cq.exporters.export(s, os.path.join(out, "stl", f"{k}.stl"), tolerance=0.03, angularTolerance=0.15)
    bp = base_plate(p, d)
    cq.exporters.export(bp.section(-p["base_t"] / 2), os.path.join(out, "dxf", "base_plate.dxf"))
    lk = cc.link(p, d, 1, 180.0).rotate((0, 0, 0), (1, 0, 0), -90)
    bb = lk.val().BoundingBox()
    cq.exporters.export(lk.section((bb.zmin + bb.zmax) / 2), os.path.join(out, "dxf", "link.dxf"))
    with open(os.path.join(out, "solidworks_global_variables.txt"), "w") as f:
        for k, v in p.items():
            f.write(f'"{k}"= {v:g}\n')
        for k in ("link_len", "stroke", "z_pivot", "post_len", "xh_len"):
            f.write(f'"derived_{k}"= {d[k]:.2f}\n')
    with open(os.path.join(out, "parameters.json"), "w") as f:
        json.dump({"params": p, "derived": {k: round(v, 3) for k, v in d.items()}}, f, indent=1)

    # hand force over the stroke from the simulated combined force (bar + platen)
    src = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs", "progressive-forces.json")
    table = []
    if os.path.exists(src):
        comb = json.load(open(src))["combined"]
        samples = [(r["z"], r["total"]) for r in comb if r["total"] > 0]
        table = cc.hand_force_table(p, d, samples)
        with open(os.path.join(out, "hand_forces.json"), "w") as f:
            json.dump(table, f)
        worst = max(table, key=lambda r: r["hand_force_N"])
        print("max hand force", worst)
    with open(os.path.join(out, "bom_changes.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["item", "qty", "notes"])
        w.writerow(["Everything in out/bom.csv except the single cradle", "", "same frame, lever and hardware"])
        w.writerow(["Base plate", 1, f"{p['base_w']:.0f} × {p['base_d']:.0f} × {p['base_t']:.0f} mm (dxf/base_plate.dxf)"])
        w.writerow(["Ø20 steel rod (crease bar)", 1, f"{p['bar_len']:.0f} mm long"])
        w.writerow(["Printed: cradle_station1, pad_station2 (instead of cradle)", "1 each", "stl/"])
        w.writerow(["Printed: crosshead with front arm (replaces crosshead)", 1, "stl/crosshead.stl"])
        w.writerow(["Printed: bar_head and platen_head are both fitted permanently", "1 each", ""])
    print(json.dumps({k: round(v, 1) for k, v in d.items() if k in ("stroke", "z_pivot", "post_len", "link_len", "z_bridge_bot")}))


if __name__ == "__main__":
    main()
