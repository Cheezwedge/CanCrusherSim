"""
Low-profile rotary can crusher ("one turn, two actions") - parametric CadQuery model.

One full turn of a horizontal hand crank creases the can and then flattens it:

  * the can lies on its side between a fixed jaw and a sliding platen;
  * a vertical-axis rotor carries two stacked eccentrics. The upper one is a
    circular CAM that pushes a crease blade out through a slot in the platen;
    the lower one drives the PLATEN through a strap and connecting rod;
  * the cam leads the platen eccentric by `phi` degrees, so the blade creases
    the can first, then springs back while the platen is still arriving. The
    blade stops flush with the platen face, so the platen then presses as one
    solid flat face (the simulator showed a bar left in the crease, or an open
    slot, both cost force or thickness).

Coordinates: X = press direction (fixed jaw face at x = 0, rotor at x = S),
Y = can axis, Z = up; the mounting board's top is z = 0. Units mm.

Run:  python rotary_crusher.py                 # writes ./out_rotary
      python rotary_crusher.py --set rp=30 --set handle_len=400
"""
import argparse
import csv
import json
import math
import os

import cadquery as cq

from can_crusher import box, cyl

P0 = {
    # --- can ---
    "can_d": 66.2, "can_len": 122.7,
    # --- kinematics (simulated in tools/study-rotary.mjs) ---
    "rb": 40.0,          # cam eccentricity = half the blade stroke
    "rp": 40.0,          # platen eccentric throw = half the platen stroke
    "Lp": 122.0,         # platen connecting rod, eccentric centre to wrist pin
    "phi": 120.0,        # cam leads the platen eccentric by this angle (deg)
    "bar_gap": 8.0,      # blade tip to fixed jaw at full crease
    "platen_gap": 12.0,  # platen face to fixed jaw at the end of the press
    # --- frame ---
    "half_w": 88.0, "tube_y": 78.0, "tube_z_lo": 11.0, "tube_z_hi": 82.0,
    "tube_d": 12.0, "tie_d": 8.0,
    "jaw_t": 30.0, "frame_h": 93.0,
    "bot_t": 22.0, "top_z0": 74.0, "top_t": 16.0, "band_anchor": 50.0,
    "plate_back": 110.0,   # rear plates: extent before / behind the axle
    "axle_d": 16.0,
    # --- platen / blade ---
    "platen_depth": 46.0, "slot_w": 22.0, "floor_clear": 1.5, "slot_top": 68.8,
    "web_x0": 21.0, "web_x1": 41.0, "wrist_d": 10.0,
    "blade_t": 19.4, "nose_solid": 19.5, "strip_len": 56.0,
    "foot_w": 92.0, "foot_t": 16.0, "foot_pocket": 30.0, "foot_z0": 52.0, "foot_z1": 64.0,
    # --- rotor ---
    "ecc_wall": 14.0, "hub_r": 20.0, "rod_t": 12.0, "strap_wall": 12.0, "rod_w": 22.0,
    "pe_z0": 26.0, "pe_z1": 44.5, "cam_z0": 51.5, "cam_z1": 64.5,
    # --- handle ---
    "handle_len": 450.0, "handle_d": 20.0,
    "clearance": 0.3,
}


def derive(p):
    """Derived dimensions. The connecting rod is lengthened automatically until the
    blade's cam foot stays clear of the platen at the blade's largest protrusion."""
    p = dict(p)
    for _ in range(200):
        d = _derive(p)
        if d["protrusion_room"] >= d["max_protrusion"] + 2.0:
            break
        p["Lp"] += 1.0
    d["Lp"] = p["Lp"]
    # point the handle straight back (away from the can) at the middle of the loading window
    lw = load_window(p, d)
    d["load_angle"] = (lw[0] + lw[1]) / 2 if lw else 230.0
    d["handle_phase"] = -d["load_angle"] - 180.0
    return d


def _derive(p):
    d = {}
    d["wrist_depth"] = (p["web_x0"] + p["web_x1"]) / 2
    d["S"] = p["platen_gap"] + d["wrist_depth"] + p["Lp"] + p["rp"]
    d["Rpe"] = p["rp"] + p["ecc_wall"]
    d["Rcam"] = p["rb"] + p["ecc_wall"]
    # tip-to-cam-face length of the blade, so the tip is at bar_gap at cam top-dead-centre
    d["Lbt"] = d["S"] - p["rb"] - d["Rcam"] - p["bar_gap"]
    d["zc"] = (p["pe_z0"] + p["pe_z1"]) / 2
    d["rod_z0"] = d["zc"] - p["rod_t"] / 2
    d["rod_z1"] = d["zc"] + p["rod_t"] / 2
    d["Lp"] = p["Lp"]
    d["max_protrusion"] = max(platen_face(p, d, t) - blade_tip(p, d, t) for t in range(0, 360))
    d["protrusion_room"] = d["Lbt"] - p["foot_t"] - p["platen_depth"] + p["foot_pocket"]
    d["face_max"] = max(platen_face(p, d, t) for t in range(0, 360))
    # the rear plates start just behind the platen's rearmost position
    d["plate_front"] = d["S"] - (d["face_max"] + p["platen_depth"] + 3.0)
    d["tube_len"] = d["S"] - d["plate_front"]
    return d


# ------------------------------------------------------------------ kinematics
def platen_face(p, d, th):
    a = math.radians(th - p["phi"])
    r, L = p["rp"], d.get("Lp", p["Lp"])
    return p["platen_gap"] + r * (1 - math.cos(a)) + L - math.sqrt(L * L - (r * math.sin(a)) ** 2)


def cam_tip(p, d, th):
    return p["bar_gap"] + p["rb"] * (1 - math.cos(math.radians(th)))


def blade_tip(p, d, th):
    """The blade follows the cam but a stop keeps it from sitting behind the platen face."""
    return min(cam_tip(p, d, th), platen_face(p, d, th))


def load_window(p, d):
    ok = [t for t in range(0, 360) if blade_tip(p, d, t) >= p["can_d"] + 1.8]
    return (ok[0], ok[-1]) if ok else None


def unit(deg):
    return math.cos(math.radians(deg)), math.sin(math.radians(deg))


def ecc_dirs(p, th):
    """Directions (deg, in the XY plane) of the cam lobe and the platen eccentric at crank angle th.
    At th = 0 the cam lobe points at the blade (-x); the rotor turns counter-clockwise seen from above."""
    return 180.0 + th, 180.0 + th - p["phi"]


# ----------------------------------------------------------------------- parts
def fixed_jaw(p, d):
    w, t, h = p["half_w"], p["jaw_t"], p["frame_h"]
    s = box(-t, 0, -w, w, 0, h)
    for sy in (-1, 1):
        # screw-down ears and can end stops
        s = s.union(box(-t - 22, -t, sy * 62 - 14, sy * 62 + 14, 0, 8))
        s = s.cut(cyl(2.75, 20, (-t - 11, sy * 62, -1), (0, 0, 1)))
        y0 = sy * (p["can_len"] / 2 + 2.5)
        s = s.union(box(0, 11, min(y0, y0 + sy * 6), max(y0, y0 + sy * 6), 0, 26))
        for z in (p["tube_z_lo"], p["tube_z_hi"]):
            s = s.cut(cyl(p["tie_d"] / 2 + 0.3, t + 2, (-t - 1, sy * p["tube_y"], z), (1, 0, 0)))
            s = s.cut(cyl(9.0, 7, (-t - 1, sy * p["tube_y"], z), (1, 0, 0)))          # washer + nut recess
            s = s.cut(cyl(p["tube_d"] / 2 + 0.15, 4, (-3.5, sy * p["tube_y"], z), (1, 0, 0)))  # tube seat
    return s


def platen(p, d, xf):
    w, D = p["half_w"], p["platen_depth"]
    z0 = p["floor_clear"]
    s = box(xf, xf + D, -w, w, z0, p["frame_h"])
    hs = p["slot_w"] / 2
    s = s.cut(box(xf - 1, xf + D + 1, -hs, hs, z0 - 1, p["slot_top"]))
    # web across the slot (two layers) that carries the wrist pin and stops the blade flush
    for (a, b) in ((d["rod_z0"] - 8.0, d["rod_z0"] - 0.6), (d["rod_z1"] + 0.6, d["rod_z1"] + 8.0)):
        s = s.union(box(xf + p["web_x0"], xf + p["web_x1"], -hs - 0.5, hs + 0.5, a, b))
    # room for the connecting rod to swing
    s = s.cut(box(xf + p["web_x0"] - 1.5, xf + D + 1, -31, 31, d["rod_z0"] - 0.6, d["rod_z1"] + 0.6))
    # pocket in the rear face so the blade's cam foot can come further forward
    fw = p["tube_y"] - p["tube_d"] / 2 - 6.0   # full width between the guide-tube bosses: also clears the cam
    s = s.cut(box(xf + D - p["foot_pocket"], xf + D + 1, -fw, fw, p["foot_z0"] - 1.5, p["foot_z1"] + 9.5))
    xw = xf + d["wrist_depth"]
    s = s.cut(cyl(p["wrist_d"] / 2 + 0.15, d["rod_z1"] + 8.0 - (d["rod_z0"] - 5.0), (xw, 0, d["rod_z0"] - 5.0), (0, 0, 1)))
    s = s.cut(cyl(p["wrist_d"] / 2 + 0.4, 40, (xw, 0, p["slot_top"] - 1), (0, 0, 1)))  # pin loading hole from the top
    for sy in (-1, 1):
        for z in (p["tube_z_lo"], p["tube_z_hi"]):
            s = s.cut(cyl(p["tube_d"] / 2 + p["clearance"], D + 2, (xf - 1, sy * p["tube_y"], z), (1, 0, 0)))
    return s


def wrist_pin(p, d, xf):
    return cyl(p["wrist_d"] / 2, d["rod_z1"] + 8.0 - (d["rod_z0"] - 5.0) - 0.5, (xf + d["wrist_depth"], 0, d["rod_z0"] - 5.0), (0, 0, 1))


def blade(p, d, xt):
    ht = p["blade_t"] / 2
    zb, ztop = p["floor_clear"] + 0.6, p["slot_top"] - 0.5
    r = ht
    L = d["Lbt"]
    win_lo, win_hi = d["rod_z0"] - 8.6, d["rod_z1"] + 8.4   # window that slides over the platen web
    nose = box(xt + r, xt + p["nose_solid"], -ht, ht, zb, ztop).union(cyl(r, ztop - zb, (xt + r, 0, zb), (0, 0, 1)))
    top = box(xt + r, xt + L, -ht, ht, win_hi, ztop)
    bot = box(xt + r, xt + p["strip_len"], -ht, ht, zb, win_lo)
    s = nose.union(top).union(bot)
    fw = p["foot_w"] / 2
    s = s.union(box(xt + L - p["foot_t"], xt + L, -fw, fw, p["foot_z0"], p["foot_z1"]))
    for sy in (-1, 1):
        # peg on top of the foot for the return band
        s = s.union(cyl(3.0, 7.5, (xt + L - p["foot_t"] / 2, sy * 40, p["foot_z1"] - 0.5), (0, 0, 1)))
    return s


def rotor_lower(p, d, th):
    S = d["S"]
    _, pdir = ecc_dirs(p, th)
    ux, uy = unit(pdir)
    cx, cy = S + p["rp"] * ux, p["rp"] * uy
    s = cyl(p["hub_r"], p["pe_z0"] - (p["bot_t"] + 0.5), (S, 0, p["bot_t"] + 0.5), (0, 0, 1))
    s = s.union(cyl(d["Rpe"], p["pe_z1"] - p["pe_z0"], (cx, cy, p["pe_z0"]), (0, 0, 1)))
    s = s.union(cyl(d["Rpe"] + 3, d["rod_z0"] - 0.4 - p["pe_z0"], (cx, cy, p["pe_z0"]), (0, 0, 1)))  # lip under the strap
    s = s.union(cyl(p["hub_r"], p["cam_z0"] - p["pe_z1"], (S, 0, p["pe_z1"]), (0, 0, 1)))
    return _rotor_holes(p, d, th, s, nuts=True)


def rotor_upper(p, d, th):
    S = d["S"]
    bdir, _ = ecc_dirs(p, th)
    ux, uy = unit(bdir)
    s = cyl(d["Rcam"], p["cam_z1"] - p["cam_z0"], (S + p["rb"] * ux, p["rb"] * uy, p["cam_z0"]), (0, 0, 1))
    ztop = p["top_z0"] + p["top_t"] + 2.0
    s = s.union(cyl(p["hub_r"], ztop - p["cam_z1"], (S, 0, p["cam_z1"]), (0, 0, 1)))
    return _rotor_holes(p, d, th, s)


def bolt_points(p, d, th):
    bdir, pdir = ecc_dirs(p, th)
    mid = pdir + p["phi"] / 2
    return [(d["S"] + 14 * unit(a)[0], 14 * unit(a)[1]) for a in (mid, mid + 65, mid - 65)]


def _rotor_holes(p, d, th, s, nuts=False):
    s = s.cut(cyl(p["axle_d"] / 2 + 0.25, 200, (d["S"], 0, -10), (0, 0, 1)))
    for (x, y) in bolt_points(p, d, th):
        s = s.cut(cyl(3.3, 200, (x, y, -10), (0, 0, 1)))
        if nuts:  # M6 nut pockets in the underside
            s = s.cut(cq.Workplane("XY").polygon(6, 11.8).extrude(6).translate((x, y, p["bot_t"] + 0.4)))
    return s


def handle_hub(p, d, th):
    S = d["S"]
    z0 = p["top_z0"] + p["top_t"] + 2.2
    hd = ecc_dirs(p, th)[0] + d["handle_phase"]
    ux, uy = unit(hd)
    s = cyl(34, 12, (S, 0, z0), (0, 0, 1))
    arm = box(0, 95, -17, 17, z0, z0 + 30).rotate((0, 0, 0), (0, 0, 1), hd).translate((S, 0, 0))
    s = s.union(arm)
    zc = z0 + 16
    s = s.cut(cyl(p["handle_d"] / 2 + 0.2, 80, (S + 24 * ux, 24 * uy, zc), (ux, uy, 0)))
    for rr in (45, 80):  # cross bolts through the tube
        s = s.cut(cyl(3.3, 60, (S + rr * ux, rr * uy, z0 - 1), (0, 0, 1)))
    s = s.cut(cyl(p["axle_d"] / 2 + 0.25, 60, (S, 0, z0 - 1), (0, 0, 1)))
    s = s.cut(cyl(15.0, 40, (S, 0, z0 + 12), (0, 0, 1)))  # room for the axle nut
    for (x, y) in bolt_points(p, d, th):
        s = s.cut(cyl(3.3, 60, (x, y, z0 - 1), (0, 0, 1)))
    return s


def handle(p, d, th):
    S = d["S"]
    z0 = p["top_z0"] + p["top_t"] + 2.2
    hd = ecc_dirs(p, th)[0] + d["handle_phase"]
    ux, uy = unit(hd)
    s = cyl(p["handle_d"] / 2, p["handle_len"] - 24, (S + 24 * ux, 24 * uy, z0 + 16), (ux, uy, 0))
    gx, gy = S + (p["handle_len"] - 12) * ux, (p["handle_len"] - 12) * uy
    return s, (gx, gy, z0 + 16 + p["handle_d"] / 2)


def knob(p, d, th):
    _, (gx, gy, gz) = handle(p, d, th)
    s = cyl(15, 70, (gx, gy, gz + 1), (0, 0, 1)).union(cyl(18, 8, (gx, gy, gz + 63), (0, 0, 1)))
    return s.cut(cyl(4.2, 90, (gx, gy, gz - 5), (0, 0, 1)))


def conrod(p, d, th):
    S = d["S"]
    _, pdir = ecc_dirs(p, th)
    ux, uy = unit(pdir)
    cx, cy = S + p["rp"] * ux, p["rp"] * uy
    xw = platen_face(p, d, th) + d["wrist_depth"]
    z0, t = d["rod_z0"], p["rod_t"]
    ro = d["Rpe"] + p["strap_wall"]
    ang = math.degrees(math.atan2(-cy, xw - cx))
    L = math.hypot(xw - cx, cy)
    body = box(0, L, -p["rod_w"] / 2, p["rod_w"] / 2, z0, z0 + t)
    # flare where the rod meets the strap
    flare = cq.Workplane("XY").polyline([(ro - 6, -34), (ro + 38, -p["rod_w"] / 2), (ro + 38, p["rod_w"] / 2), (ro - 6, 34)]).close().extrude(t).translate((0, 0, z0))
    s = cyl(ro, t, (0, 0, z0), (0, 0, 1)).union(body).union(flare).union(cyl(p["rod_w"] / 2, t, (L, 0, z0), (0, 0, 1)))
    s = s.cut(cyl(d["Rpe"] + 0.35, t + 2, (0, 0, z0 - 1), (0, 0, 1)))
    s = s.cut(cyl(p["wrist_d"] / 2 + 0.2, t + 2, (L, 0, z0 - 1), (0, 0, 1)))
    return s.rotate((0, 0, 0), (0, 0, 1), ang).translate((cx, cy, 0))


def _rear_plate(p, d, z0, t, bottom):
    S, w = d["S"], p["half_w"]
    x0, x1 = S - d["plate_front"], S + p["plate_back"]
    s = box(x0, x1, -w, w, z0, z0 + t)
    zt = p["tube_z_lo"] if bottom else p["tube_z_hi"]
    for sy in (-1, 1):
        y = sy * p["tube_y"]
        s = s.cut(cyl(p["tie_d"] / 2 + 0.3, 30, (x0 - 1, y, zt), (1, 0, 0)))
        s = s.cut(cyl(p["tube_d"] / 2 + 0.15, 4, (x0 - 0.5, y, zt), (1, 0, 0)))
        # pocket for the tie-rod washer and nut, open to the outside face
        s = s.cut(box(x0 + 22, x0 + 36, y - 9.5, y + 9.5, z0 - 1 if bottom else zt - 9.5, zt + 9.5 if bottom else z0 + t + 1))
        s = s.cut(cyl(4.3, 60, (x1 - 16, y, z0 - 20), (0, 0, 1)))   # back-post bolt
        if bottom:
            s = s.cut(cq.Workplane("XY").polygon(6, 15.2).extrude(8).translate((x1 - 16, y, -1)))
            for xs in (x0 + 60, x1 - 45):
                s = s.cut(cyl(2.75, 40, (xs, sy * 70, -1), (0, 0, 1)))   # board screws
                s = s.cut(cyl(5.5, 20, (xs, sy * 70, 6), (0, 0, 1)))
    return s


def bottom_plate(p, d):
    s = _rear_plate(p, d, 0, p["bot_t"], True)
    s = s.cut(cyl(p["axle_d"] / 2 + 0.2, 40, (d["S"], 0, -1), (0, 0, 1)))
    s = s.cut(cq.Workplane("XY").polygon(6, 28.2).extrude(11).translate((d["S"], 0, -1)))  # M16 head
    return s


def top_plate(p, d):
    s = _rear_plate(p, d, p["top_z0"], p["top_t"], False)
    s = s.cut(cyl(p["hub_r"] + 0.3, 40, (d["S"], 0, p["top_z0"] - 1), (0, 0, 1)))
    for sy in (-1, 1):  # anchors for the blade return bands (the bands run just above the cam)
        s = s.union(cyl(3.5, 7.5, (d["S"] + p["band_anchor"], sy * 40, p["top_z0"] - 7), (0, 0, 1)))
    return s


def back_post(p, d, sy):
    x = d["S"] + p["plate_back"] - 16
    z0, z1 = p["bot_t"], p["top_z0"]
    s = cyl(12, z1 - z0, (x, sy * p["tube_y"], z0), (0, 0, 1))
    return s.cut(cyl(4.3, 100, (x, sy * p["tube_y"], z0 - 1), (0, 0, 1)))


def tubes(p, d):
    out = None
    for sy in (-1, 1):
        for z in (p["tube_z_lo"], p["tube_z_hi"]):
            t = cyl(p["tube_d"] / 2, d["tube_len"] + 6, (-3, sy * p["tube_y"], z), (1, 0, 0))
            t = t.cut(cyl(p["tie_d"] / 2 + 0.4, d["tube_len"] + 10, (-5, sy * p["tube_y"], z), (1, 0, 0)))
            out = t if out is None else out.union(t)
    return out


def tie_rods(p, d):
    out = None
    L = p["jaw_t"] + d["tube_len"] + 34
    for sy in (-1, 1):
        for z in (p["tube_z_lo"], p["tube_z_hi"]):
            t = cyl(p["tie_d"] / 2, L, (-p["jaw_t"] + 1, sy * p["tube_y"], z), (1, 0, 0))
            out = t if out is None else out.union(t)
    return out


def axle(p, d):
    return cyl(p["axle_d"] / 2, p["top_z0"] + p["top_t"] + 26 - 10, (d["S"], 0, 10), (0, 0, 1))


def board(p, d):
    x0, x1 = -p["jaw_t"] - 30, d["S"] + p["plate_back"] + 12
    return box(x0, x1, -p["half_w"] - 12, p["half_w"] + 12, -18, 0)


def can_ref(p, d):
    R = p["can_d"] / 2
    return cyl(R, p["can_len"], (R + 0.4, -p["can_len"] / 2, R), (0, 1, 0))


COL = {"print_a": (0.86, 0.36, 0.10), "print_b": (0.20, 0.45, 0.80), "print_c": (0.20, 0.65, 0.35),
       "steel": (0.75, 0.75, 0.78), "dark": (0.2, 0.2, 0.22), "wood": (0.72, 0.58, 0.40), "can": (0.86, 0.86, 0.9)}


def build(p, th, with_can=False):
    d = derive(p)
    xf, xt = platen_face(p, d, th), blade_tip(p, d, th)
    h, _ = handle(p, d, th)
    parts = {
        "board": (board(p, d), COL["wood"]),
        "fixed_jaw": (fixed_jaw(p, d), COL["print_a"]),
        "platen": (platen(p, d, xf), COL["print_b"]),
        "wrist_pin": (wrist_pin(p, d, xf), COL["dark"]),
        "blade": (blade(p, d, xt), COL["print_c"]),
        "conrod": (conrod(p, d, th), COL["print_c"]),
        "rotor_lower": (rotor_lower(p, d, th), COL["print_a"]),
        "rotor_upper": (rotor_upper(p, d, th), COL["print_a"]),
        "bottom_plate": (bottom_plate(p, d), COL["print_b"]),
        "top_plate": (top_plate(p, d), COL["print_b"]),
        "back_post_L": (back_post(p, d, -1), COL["print_b"]),
        "back_post_R": (back_post(p, d, 1), COL["print_b"]),
        "guide_tubes": (tubes(p, d), COL["steel"]),
        "tie_rods": (tie_rods(p, d), COL["dark"]),
        "axle": (axle(p, d), COL["dark"]),
        "handle_hub": (handle_hub(p, d, th), COL["print_a"]),
        "handle": (h, COL["dark"]),
        "knob": (knob(p, d, th), COL["print_c"]),
    }
    if with_can:
        parts["can"] = (can_ref(p, d), COL["can"])
    return d, parts


PRINTED = ["fixed_jaw", "platen", "blade", "conrod", "rotor_lower", "rotor_upper", "bottom_plate", "top_plate", "back_post", "handle_hub", "knob"]


def print_parts(p, d):
    """Printed parts turned into their print orientation, sitting on z = 0."""
    th = 0.0
    _, parts = build(p, th)
    o = {}
    o["fixed_jaw"] = parts["fixed_jaw"][0].rotate((0, 0, 0), (0, 1, 0), 90)        # back face down
    o["platen"] = parts["platen"][0].rotate((0, 0, 0), (0, 1, 0), -90)             # pressing face down
    o["blade"] = parts["blade"][0].rotate((0, 0, 0), (0, 1, 0), 90)                # cam foot down, nose up
    o["conrod"] = parts["conrod"][0]
    o["rotor_lower"] = parts["rotor_lower"][0].rotate((0, 0, 0), (1, 0, 0), 180)   # eccentric on the bed
    o["rotor_upper"] = parts["rotor_upper"][0]
    o["bottom_plate"] = parts["bottom_plate"][0].rotate((0, 0, 0), (1, 0, 0), 180)
    o["top_plate"] = parts["top_plate"][0]
    o["back_post"] = parts["back_post_L"][0]
    o["handle_hub"] = parts["handle_hub"][0]
    o["knob"] = parts["knob"][0]
    for k, s in o.items():
        bb = s.val().BoundingBox()
        o[k] = s.translate((-(bb.xmin + bb.xmax) / 2, -(bb.ymin + bb.ymax) / 2, -bb.zmin))
    return o


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", action="append", default=[])
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "out_rotary"))
    args = ap.parse_args()
    p = dict(P0)
    for kv in args.set:
        k, v = kv.split("=")
        if k not in p:
            raise SystemExit(f"unknown parameter {k}")
        p[k] = float(v)
    out = args.out
    for sub in ("step", "stl"):
        os.makedirs(os.path.join(out, sub), exist_ok=True)
    d = derive(p)
    lw = load_window(p, d)
    load_th = d["load_angle"]
    views = {"load": (load_th, True), "crease": (0.0, False), "pressed": (p["phi"], False)}
    for name, (th, can) in views.items():
        _, parts = build(p, th, with_can=can)
        asm = cq.Assembly(name=f"rotary_crusher_{name}")
        for k, (shape, col) in parts.items():
            asm.add(shape, name=k, color=cq.Color(*col))
        asm.export(os.path.join(out, f"rotary_crusher_{name}.step"))
    _, parts = build(p, load_th)
    for k, (shape, _) in parts.items():
        cq.exporters.export(shape, os.path.join(out, "step", f"{k}.step"))
    sizes = {}
    for k, s in print_parts(p, d).items():
        cq.exporters.export(s, os.path.join(out, "stl", f"{k}.stl"), tolerance=0.03, angularTolerance=0.15)
        bb = s.val().BoundingBox()
        sizes[k] = [round(bb.xlen), round(bb.ylen), round(bb.zlen), round(s.val().Volume() / 1000)]
    with open(os.path.join(out, "solidworks_global_variables.txt"), "w") as f:
        for k, v in p.items():
            f.write(f'"{k}"= {v:g}\n')
        for k in ("S", "Rpe", "Rcam", "Lbt", "tube_len"):
            f.write(f'"derived_{k}"= {d[k]:.2f}\n')
    info = {"params": p, "derived": {k: round(v, 2) for k, v in d.items()}, "load_window_deg": lw, "load_angle_deg": load_th, "print_sizes_mm_cm3": sizes,
            "envelope_mm": {"length": round(d["S"] + p["plate_back"] + p["jaw_t"] + 22), "width": round(2 * p["half_w"]), "height_without_handle": round(p["top_z0"] + p["top_t"] + 32)}}
    with open(os.path.join(out, "parameters.json"), "w") as f:
        json.dump(info, f, indent=1)
    hw = [
        ("M8 threaded rod (tie rods)", 4, f"{p['jaw_t'] + d['tube_len'] + 34:.0f} mm long, with 8 nuts + 8 washers"),
        (f"Aluminium or steel tube Ø{p['tube_d']:.0f} × 1.5 (guide tubes / spacers)", 4, f"{d['tube_len'] + 6:.0f} mm long, slides over the M8 rods"),
        ("M16 × 130 hex bolt + nyloc nut + 2 washers (rotor axle)", 1, "head sits in the bottom plate; leave the nut just loose"),
        ("M6 × 110 bolt + nut (rotor through-bolts)", 3, "handle hub, upper rotor and lower rotor"),
        ("M8 × 110 bolt + nut (back posts)", 2, "top plate, post, bottom plate"),
        (f"Ø{p['wrist_d']:.0f} × 26 mm steel dowel or cut bolt shank (wrist pin)", 1, "dropped in through the hole in the platen top"),
        (f"Steel tube Ø{p['handle_d']:.0f} (handle)", 1, f"{p['handle_len'] - 24:.0f} mm long, 2 × M6 × 45 cross bolts + nuts"),
        ("M8 × 100 bolt + nyloc nut (grip knob spindle)", 1, "through the handle tube end"),
        ("Rubber bands or 2 light extension springs (~10 N)", 2, "blade return, peg to peg"),
        ("Plywood board 18 mm", 1, f"about {d['S'] + p['plate_back'] + p['jaw_t'] + 42:.0f} × {2 * p['half_w'] + 24:.0f} mm; wood screws 5 × 30, 10 off"),
        ("Grease (lithium or PTFE)", 1, "eccentric strap, cam face, guide tubes, axle"),
    ]
    with open(os.path.join(out, "bom.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["item", "qty", "notes"])
        for row in hw:
            w.writerow(row)
        for k in PRINTED:
            sz = sizes[k]
            w.writerow([f"Printed: {k} (stl/{k}.stl)", 2 if k == "back_post" else 1, f"{sz[0]} × {sz[1]} × {sz[2]} mm, {sz[3]} cm3 solid"])
    print(json.dumps(info["derived"]), "load window", lw, info["envelope_mm"])
    print(sizes)


if __name__ == "__main__":
    main()
