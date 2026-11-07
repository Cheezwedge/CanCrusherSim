"""
Parametric two-stage can crusher (CadQuery).

Mechanism (from the Can Crush Lab simulation results):
  * the can lies on its side in a printed cradle;
  * a crosshead slides straight down two Ø12 steel guide posts on LM12UU
    linear bearings (a parallel, flat press beat every hinged/curved option);
  * a hand lever turns a crank that drives the crosshead through two links
    (slider-crank). Near the bottom of the stroke the links straighten, so the
    mechanical advantage rises exactly where the flattening force rises;
  * two bolt-on tool heads: a Ø20 steel crease bar hung from its ends (stage 1,
    retracts cleanly) and a flat 160 x 160 mm ribbed platen (stage 2).

Coordinates: Z up (slicer / CadQuery convention), X left-right (guide posts),
Y front-back (the can's axis). Units: mm. Base plate top is Z = 0.

Run:  python can_crusher.py                      # writes ./out
      python can_crusher.py --set link_len=170 --set handle_len=500

Every dimension is in PARAMS below; derived values are computed in derive().
"""
import argparse
import csv
import json
import math
import os

import cadquery as cq

PARAMS = {
    # --- can (12 oz / 355 mL) ---
    "can_d": 66.2, "can_len": 122.7,
    # --- frame ---
    "post_d": 12.0, "post_spacing": 200.0,
    "bush_od": 21.0, "bush_len": 30.0,            # LM12UU
    "base_w": 280.0, "base_d": 200.0, "base_t": 18.0,
    "foot_w": 40.0, "foot_h": 25.0,
    "cradle_w": 140.0, "cradle_d": 150.0, "cradle_t": 8.0, "groove_depth": 3.0,
    # --- stroke / heights ---
    "tool_low_gap": 8.0,    # tool face above the cradle at the bottom of the stroke
    "head_drop": 70.0,      # tool face to crosshead underside (clears the folded can)
    "xh_depth": 50.0, "xh_h": 30.0, "xh_wall": 8.0,
    "pin_rise": 15.0,       # crosshead pin above the crosshead underside (> xh_h adds pin ears)
    "bridge_h": 40.0, "bridge_gap": 6.0,
    # --- linkage ---
    "crank_r": 48.0,        # pivot to crank pin
    "link_len": 155.0,      # pin to pin (raised automatically if too short)
    "crank_swing": 120.0,   # degrees of crank rotation over the full stroke
    "handle_len": 450.0,    # pivot to the hand grip
    "handle_d": 20.0,       # steel tube OD
    "handle_angle_bdc": -20.0,  # handle angle to horizontal at the bottom of the stroke
    "pivot_d": 10.0, "pin_d": 8.0,
    "link_w": 20.0, "link_t": 5.0, "crank_t": 12.0, "crank_w": 40.0, "arm_w": 44.0,
    "ear_t": 10.0, "ear_w": 36.0,
    # --- tool heads ---
    "bar_d": 20.0, "bar_len": 160.0, "hanger_x": 70.0, "hanger_t": 12.0, "hanger_depth": 30.0,
    "platen_w": 160.0, "platen_d": 160.0, "platen_face_t": 10.0, "rib_t": 6.0, "mount_t": 8.0,
    "mount_bolt_d": 6.4, "mount_bolt_x": 40.0, "mount_bolt_y": 12.0,
    # --- printing / fits ---
    "clearance": 0.25,
}


def derive(p):
    d = {}
    d["z_bed"] = p["cradle_t"]
    d["z_face_low"] = d["z_bed"] + p["tool_low_gap"]
    d["z_xh_bot_low"] = d["z_face_low"] + p["head_drop"]
    d["z_xpin_low"] = d["z_xh_bot_low"] + p["pin_rise"]
    above = max(p["xh_h"] - p["pin_rise"], 12.0)  # crosshead (or its pin ears) above the pin
    r = p["crank_r"]
    th0 = math.radians(180 - p["crank_swing"])

    def high_pin(L, zp):
        return zp + r * math.cos(th0) - math.sqrt(L * L - (r * math.sin(th0)) ** 2)

    # raise the link until the crank pin clears the bridge at the bottom of the stroke
    L = p["link_len"]
    for _ in range(200):
        zp = d["z_xpin_low"] + r + L
        bridge_top = high_pin(L, zp) + above + p["bridge_gap"] + p["bridge_h"]
        if zp - r - p["pin_d"] - 2 >= bridge_top:
            break
        L += 1
    d["link_len"] = L
    d["z_pivot"] = d["z_xpin_low"] + r + L
    d["z_xpin_high"] = high_pin(L, d["z_pivot"])
    d["stroke"] = d["z_xpin_high"] - d["z_xpin_low"]
    d["z_bridge_bot"] = d["z_xpin_high"] + above + p["bridge_gap"]
    d["z_bridge_top"] = d["z_bridge_bot"] + p["bridge_h"]
    d["post_bottom"] = 0.0  # posts stand on the base and are bolted through it
    d["post_len"] = d["z_bridge_bot"] + p["bridge_h"] - 16 - 0.5  # 12 mm floor under the clamp bolt
    d["xh_len"] = p["post_spacing"] + p["bush_od"] + 2 * p["xh_wall"]
    # Y stack-up (each side): ears | crank plate | link
    d["ear_y0"] = p["xh_depth"] / 2 - p["ear_t"]
    d["crank_y0"] = p["xh_depth"] / 2 + 1
    d["link_y0"] = d["crank_y0"] + p["crank_t"] + 1
    d["handle_offset"] = p["handle_angle_bdc"] + 90.0  # handle angle minus crank angle
    return d


# --------------------------------------------------------------------- helpers
def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane().add(cq.Solid.makeBox(x1 - x0, y1 - y0, z1 - z0, cq.Vector(x0, y0, z0)))


def cyl(r, h, pnt, direction):
    return cq.Workplane().add(cq.Solid.makeCylinder(r, h, cq.Vector(*pnt), cq.Vector(*direction)))


def slot_xz(a, b, width, y0, y1):
    """Rounded bar between points a=(x,z) and b=(x,z), spanning y0..y1."""
    (ax, az), (bx, bz) = a, b
    L = math.hypot(bx - ax, bz - az)
    ang = math.degrees(math.atan2(bz - az, bx - ax))
    w = width / 2
    s = box(0, L, y0, y1, -w, w)
    s = s.union(cyl(w, y1 - y0, (0, y0, 0), (0, 1, 0))).union(cyl(w, y1 - y0, (L, y0, 0), (0, 1, 0)))
    # rotate about Y so +X points from a to b (rotation about -Y maps X -> Z)
    s = s.rotate((0, 0, 0), (0, -1, 0), ang).translate((ax, 0, az))
    return s


def hole_y(shape, x, z, dia):
    return shape.cut(cyl(dia / 2, 400, (x, -200, z), (0, 1, 0)))


# ----------------------------------------------------------------------- parts
def base_plate(p, d):
    s = box(-p["base_w"] / 2, p["base_w"] / 2, -p["base_d"] / 2, p["base_d"] / 2, -p["base_t"], 0)
    pts = []
    for sx in (-1, 1):
        for dx in (-13, 13):
            for dy in (-13, 13):
                pts.append((sx * p["post_spacing"] / 2 + dx, dy))
    for cx in (-55, 55):
        for cy in (-60, 60):
            pts.append((cx, cy))
    for (x, y) in pts:
        s = s.cut(cyl(2.75, 40, (x, y, -30), (0, 0, 1)))
    for sx in (-1, 1):  # M6 bolt into the tapped post end, head in a counterbore underneath
        x = sx * p["post_spacing"] / 2
        s = s.cut(cyl(3.25, 40, (x, 0, -30), (0, 0, 1)))
        s = s.cut(cyl(10.0, 8, (x, 0, -p["base_t"] - 1), (0, 0, 1)))
    return s


def post_foot(p, d, sx):
    w = p["foot_w"] / 2
    x = sx * p["post_spacing"] / 2
    s = box(x - w, x + w, -w, w, 0, p["foot_h"])
    s = s.cut(cyl(p["post_d"] / 2 + p["clearance"] / 2, p["foot_h"] + 2, (x, 0, -1), (0, 0, 1)))
    for dx in (-13, 13):
        for dy in (-13, 13):
            s = s.cut(cyl(2.75, 40, (x + dx, dy, -1), (0, 0, 1)))
            s = s.cut(cyl(5.0, 40, (x + dx, dy, 6), (0, 0, 1)))  # counterbore, 6 mm floor
    return s


def guide_post(p, d, sx):
    return cyl(p["post_d"] / 2, d["post_len"], (sx * p["post_spacing"] / 2, 0, d["post_bottom"]), (0, 0, 1))


def cradle(p, d):
    s = box(-p["cradle_w"] / 2, p["cradle_w"] / 2, -p["cradle_d"] / 2, p["cradle_d"] / 2, 0, p["cradle_t"])
    R = p["can_d"] / 2 + 1
    zc = p["cradle_t"] - p["groove_depth"] + R
    s = s.cut(cyl(R, 400, (0, -200, zc), (0, 1, 0)))
    for cx in (-55, 55):
        for cy in (-60, 60):
            s = s.cut(cyl(2.75, 40, (cx, cy, -1), (0, 0, 1)))
            s = s.cut(cyl(5.0, 40, (cx, cy, 4), (0, 0, 1)))
    return s


def crosshead(p, d, dz=0.0):
    L = d["xh_len"] / 2
    z0 = d["z_xh_bot_low"] + dz
    s = box(-L, L, -p["xh_depth"] / 2, p["xh_depth"] / 2, z0, z0 + p["xh_h"])
    for sx in (-1, 1):  # LM12UU pockets
        s = s.cut(cyl(p["bush_od"] / 2 + p["clearance"] / 2, p["xh_h"] + 2, (sx * p["post_spacing"] / 2, 0, z0 - 1), (0, 0, 1)))
    zpin = z0 + p["pin_rise"]
    if p["pin_rise"] > p["xh_h"] - 8:
        # pin ears on top of the crosshead (lifts the links clear of a front tool arm)
        for sy in (-1, 1):
            y0, y1 = (15.0, 25.0) if sy > 0 else (-25.0, -15.0)
            ear = box(-16, 16, y0, y1, z0 + p["xh_h"] - 1, zpin).union(cyl(16, 10, (0, y0, zpin), (0, 1, 0)))
            s = s.union(ear)
    s = hole_y(s, 0, zpin, p["pin_d"] + p["clearance"])
    for bx in (-p["mount_bolt_x"], p["mount_bolt_x"]):
        for by in (-p["mount_bolt_y"], p["mount_bolt_y"]):
            s = s.cut(cyl(p["mount_bolt_d"] / 2, 100, (bx, by, z0 - 1), (0, 0, 1)))
            s = s.cut(cyl(5.5, 100, (bx, by, z0 + p["xh_h"] - 6), (0, 0, 1)))  # bolt-head counterbore
    return s


def bushing(p, d, sx, dz=0.0):
    return cyl(p["bush_od"] / 2, p["bush_len"], (sx * p["post_spacing"] / 2, 0, d["z_xh_bot_low"] + dz), (0, 0, 1))


def bridge(p, d):
    L = d["xh_len"] / 2
    zb, zt = d["z_bridge_bot"], d["z_bridge_top"]
    s = box(-L, L, -p["xh_depth"] / 2, p["xh_depth"] / 2, zb, zt)
    for sx in (-1, 1):
        x = sx * p["post_spacing"] / 2
        # post fits up into a blind bore; an M6 bolt + Ø20 washer from the top
        # clamps the bridge down (the press force pushes the bridge UP)
        s = s.cut(cyl(p["post_d"] / 2 + p["clearance"] / 2, p["bridge_h"] - 16 + 1, (x, 0, zb - 1), (0, 0, 1)))
        s = s.cut(cyl(3.25, 20, (x, 0, zt - 10), (0, 0, 1)))
        s = s.cut(cyl(11.0, 10, (x, 0, zt - 4), (0, 0, 1)))
    # pivot ears
    zp = d["z_pivot"]
    for sy in (-1, 1):
        y0, y1 = (d["ear_y0"], d["ear_y0"] + p["ear_t"]) if sy > 0 else (-d["ear_y0"] - p["ear_t"], -d["ear_y0"])
        ear = box(-p["ear_w"] / 2, p["ear_w"] / 2, y0, y1, zt - 1, zp).union(cyl(p["ear_w"] / 2, p["ear_t"], (0, y0, zp), (0, 1, 0)))
        s = s.union(ear)
    s = hole_y(s, 0, zp, p["pivot_d"] + p["clearance"])
    return s


def crank_angle_dir(theta_deg):
    """Crank direction angle in the XZ plane (deg from +X towards +Z) at crank angle theta from TDC."""
    return 90.0 - theta_deg


def crank_plate(p, d, sy, theta):
    zp = d["z_pivot"]
    a = math.radians(crank_angle_dir(theta))
    h = math.radians(crank_angle_dir(theta) + d["handle_offset"])
    pin = (p["crank_r"] * math.cos(a), zp + p["crank_r"] * math.sin(a))
    arm = (105 * math.cos(h), zp + 105 * math.sin(h))
    y0, y1 = (d["crank_y0"], d["crank_y0"] + p["crank_t"]) if sy > 0 else (-d["crank_y0"] - p["crank_t"], -d["crank_y0"])
    s = slot_xz((0, zp), pin, p["crank_w"], y0, y1).union(slot_xz((0, zp), arm, p["arm_w"], y0, y1))
    s = hole_y(s, 0, zp, p["pivot_d"] + p["clearance"])
    s = hole_y(s, pin[0], pin[1], p["pin_d"] + p["clearance"])
    for rr in (50, 95):
        s = hole_y(s, rr * math.cos(h), zp + rr * math.sin(h), 6.4)
    return s


def handle_socket(p, d, theta):
    zp = d["z_pivot"]
    h = math.radians(crank_angle_dir(theta) + d["handle_offset"])
    y = d["crank_y0"] - 0.2
    s = slot_xz((42 * math.cos(h), zp + 42 * math.sin(h)), (105 * math.cos(h), zp + 105 * math.sin(h)), 30, -y, y)
    # tube bore along the handle direction (open at the outer end)
    ux, uz = math.cos(h), math.sin(h)
    s = s.cut(cyl(p["handle_d"] / 2 + p["clearance"], 80, (60 * ux, 0, zp + 60 * uz), (ux, 0, uz)))
    for rr in (50, 95):
        s = hole_y(s, rr * ux, zp + rr * uz, 6.4)
    return s


def handle(p, d, theta):
    zp = d["z_pivot"]
    h = math.radians(crank_angle_dir(theta) + d["handle_offset"])
    ux, uz = math.cos(h), math.sin(h)
    return cyl(p["handle_d"] / 2, p["handle_len"] - 62, (62 * ux, 0, zp + 62 * uz), (ux, 0, uz))


def kinematics(p, d, theta):
    r, L, zp = p["crank_r"], d["link_len"], d["z_pivot"]
    t = math.radians(theta)
    pin = (r * math.sin(t), zp + r * math.cos(t))
    zx = zp + r * math.cos(t) - math.sqrt(L * L - (r * math.sin(t)) ** 2)
    return pin, zx


def link(p, d, sy, theta):
    pin, zx = kinematics(p, d, theta)
    y0, y1 = (d["link_y0"], d["link_y0"] + p["link_t"]) if sy > 0 else (-d["link_y0"] - p["link_t"], -d["link_y0"])
    s = slot_xz(pin, (0, zx), p["link_w"], y0, y1)
    s = hole_y(s, pin[0], pin[1], p["pin_d"] + p["clearance"])
    s = hole_y(s, 0, zx, p["pin_d"] + p["clearance"])
    return s


def pins(p, d, theta):
    pin, zx = kinematics(p, d, theta)
    span = 2 * (d["link_y0"] + p["link_t"] + 3)
    pv = cyl(p["pivot_d"] / 2, span, (0, -span / 2, d["z_pivot"]), (0, 1, 0))
    cp = cyl(p["pin_d"] / 2, span, (pin[0], -span / 2, pin[1]), (0, 1, 0))
    xp = cyl(p["pin_d"] / 2, span, (0, -span / 2, zx), (0, 1, 0))
    return pv.union(cp).union(xp)


def bar_head(p, d, dz=0.0):
    zf = d["z_face_low"] + dz
    ztop = zf + p["head_drop"]
    hx, ht, hd = p["hanger_x"], p["hanger_t"], p["hanger_depth"] / 2
    s = box(-hx - ht / 2, hx + ht / 2, -hd, hd, ztop - 10, ztop)
    zc = zf + p["bar_d"] / 2
    for sx in (-1, 1):
        x = sx * hx
        hanger = box(x - ht / 2, x + ht / 2, -hd, hd, zc, ztop).union(cyl(hd, ht, (x - ht / 2, 0, zc), (1, 0, 0)))
        s = s.union(hanger)
        s = s.cut(cyl(2.5, 40, (x, 0, zc + p["bar_d"] / 2 - 2), (0, 0, 1)))  # M5 set screw onto the bar
    s = s.cut(cyl(p["bar_d"] / 2 + p["clearance"], 400, (-200, 0, zc), (1, 0, 0)))
    for bx in (-p["mount_bolt_x"], p["mount_bolt_x"]):
        for by in (-p["mount_bolt_y"], p["mount_bolt_y"]):
            s = s.cut(cyl(2.6, 30, (bx, by, ztop - 12), (0, 0, 1)))  # M6 tap / heat-set insert
    return s


def crease_bar(p, d, dz=0.0):
    zf = d["z_face_low"] + dz
    return cyl(p["bar_d"] / 2, p["bar_len"], (-p["bar_len"] / 2, 0, zf + p["bar_d"] / 2), (1, 0, 0))


def platen_head(p, d, dz=0.0):
    zf = d["z_face_low"] + dz
    ztop = zf + p["head_drop"]
    W, D = p["platen_w"] / 2, p["platen_d"] / 2
    s = box(-W, W, -D, D, zf, zf + p["platen_face_t"])
    zr0, zr1 = zf + p["platen_face_t"] - 0.5, ztop - p["mount_t"] + 0.5
    mx, my = 55.0, p["xh_depth"] / 2 - 1
    s = s.union(box(-mx, mx, -my, my, ztop - p["mount_t"], ztop))
    t = p["rib_t"] / 2
    # tapered ribs: full width at the face, mount width at the top
    for y in (-(D - 20), -my + t, 0.0, my - t, D - 20):
        rib = cq.Workplane("XZ").polyline([(-W, zr0), (W, zr0), (mx, zr1), (-mx, zr1)]).close().extrude(t, both=True)
        s = s.union(rib.translate((0, y, 0)))
    for x in (-(W - 20), -mx + t, 0.0, mx - t, W - 20):
        rib = cq.Workplane("YZ").polyline([(-D, zr0), (D, zr0), (my, zr1), (-my, zr1)]).close().extrude(t, both=True)
        s = s.union(rib.translate((x, 0, 0)))
    for bx in (-p["mount_bolt_x"], p["mount_bolt_x"]):
        for by in (-p["mount_bolt_y"], p["mount_bolt_y"]):
            s = s.cut(cyl(2.6, 30, (bx, by, ztop - 14), (0, 0, 1)))
    return s


def can_ref(p, d):
    R = p["can_d"] / 2
    zc = p["cradle_t"] - p["groove_depth"] + R
    return cyl(R, p["can_len"], (0, -p["can_len"] / 2, zc), (0, 1, 0))


# ------------------------------------------------------------------- outputs
PRINTED = ["post_foot", "cradle", "crosshead", "bridge", "crank_plate", "handle_socket", "bar_head", "platen_head"]


def build(p, theta):
    d = derive(p)
    _, zx = kinematics(p, d, theta)
    dz = zx - d["z_xpin_low"]
    parts = {
        "base_plate": (base_plate(p, d), "plywood/aluminium (cut)", (0.72, 0.58, 0.40)),
        "post_foot_L": (post_foot(p, d, -1), "printed", (0.85, 0.35, 0.10)),
        "post_foot_R": (post_foot(p, d, 1), "printed", (0.85, 0.35, 0.10)),
        "guide_post_L": (guide_post(p, d, -1), "steel rod Ø12", (0.75, 0.75, 0.78)),
        "guide_post_R": (guide_post(p, d, 1), "steel rod Ø12", (0.75, 0.75, 0.78)),
        "cradle": (cradle(p, d), "printed", (0.85, 0.35, 0.10)),
        "crosshead": (crosshead(p, d, dz), "printed", (0.20, 0.45, 0.80)),
        "bushing_L": (bushing(p, d, -1, dz), "LM12UU", (0.6, 0.6, 0.6)),
        "bushing_R": (bushing(p, d, 1, dz), "LM12UU", (0.6, 0.6, 0.6)),
        "bridge": (bridge(p, d), "printed", (0.20, 0.45, 0.80)),
        "crank_plate_F": (crank_plate(p, d, -1, theta), "printed", (0.85, 0.35, 0.10)),
        "crank_plate_B": (crank_plate(p, d, 1, theta), "printed", (0.85, 0.35, 0.10)),
        "handle_socket": (handle_socket(p, d, theta), "printed", (0.85, 0.35, 0.10)),
        "handle": (handle(p, d, theta), "steel tube Ø20", (0.15, 0.15, 0.15)),
        "link_F": (link(p, d, -1, theta), "steel flat bar", (0.55, 0.55, 0.58)),
        "link_B": (link(p, d, 1, theta), "steel flat bar", (0.55, 0.55, 0.58)),
        "pins": (pins(p, d, theta), "M10 / M8 bolts", (0.3, 0.3, 0.3)),
        "bar_head": (bar_head(p, d, dz), "printed", (0.20, 0.65, 0.35)),
        "crease_bar": (crease_bar(p, d, dz), "steel rod Ø20", (0.75, 0.75, 0.78)),
        "can": (can_ref(p, d), "reference", (0.85, 0.85, 0.88)),
    }
    return d, parts


def print_parts(p, d):
    """Printed parts in their print orientation (flat face on the bed, Z up)."""
    th = 180.0
    out = {}
    out["post_foot"] = post_foot(p, d, 1).translate((-p["post_spacing"] / 2, 0, 0))
    out["cradle"] = cradle(p, d)
    out["crosshead"] = crosshead(p, d).translate((0, 0, -d["z_xh_bot_low"]))
    out["bridge"] = bridge(p, d).translate((0, 0, -d["z_bridge_bot"]))
    cp = crank_plate(p, d, 1, th)
    out["crank_plate"] = cp.rotate((0, 0, 0), (1, 0, 0), -90).translate((0, 0, 0))
    hs = handle_socket(p, d, th)
    out["handle_socket"] = hs.rotate((0, 0, 0), (1, 0, 0), -90)
    out["bar_head"] = bar_head(p, d).rotate((0, 0, 0), (1, 0, 0), 180)
    out["platen_head"] = platen_head(p, d)
    # drop each onto z = 0, centred
    for k, s in out.items():
        bb = s.val().BoundingBox()
        out[k] = s.translate((-(bb.xmin + bb.xmax) / 2, -(bb.ymin + bb.ymax) / 2, -bb.zmin))
    return out


def hand_force_table(p, d, forces):
    """Hand force needed at the grip for a given press force at each can thickness."""
    rows = []
    r, L, zp = p["crank_r"], d["link_len"], d["z_pivot"]
    for thick, F in forces:
        delta = thick - p["tool_low_gap"]
        if delta < 0:
            continue
        target = d["z_xpin_low"] + delta
        lo, hi = 180 - p["crank_swing"], 180.0
        for _ in range(60):
            mid = (lo + hi) / 2
            if kinematics(p, d, mid)[1] > target:
                lo = mid
            else:
                hi = mid
        th = (lo + hi) / 2
        pin, zx = kinematics(p, d, th)
        ux, uz = (0 - pin[0]), (zx - pin[1])
        n = math.hypot(ux, uz)
        ux, uz = ux / n, uz / n
        Fl = F / abs(uz)
        torque = abs(pin[0] * (Fl * uz) - (pin[1] - zp) * (Fl * ux))
        hand = torque / p["handle_len"]
        rows.append({"thickness_mm": thick, "press_force_N": F, "crank_deg": round(th, 1), "link_force_N": round(Fl), "hand_force_N": round(hand), "ratio": round(F / max(hand, 1e-9), 1)})
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", action="append", default=[], help="override a parameter, e.g. --set crank_r=50")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"))
    ap.add_argument("--no-stl", action="store_true")
    args = ap.parse_args()
    p = dict(PARAMS)
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
        asm = cq.Assembly(name=f"can_crusher_{name}")
        for k, (shape, _, col) in parts.items():
            asm.add(shape, name=k, color=cq.Color(*col))
        asm.save(os.path.join(out, f"can_crusher_{name}.step"))

    # individual parts (bottom-of-stroke positions, assembly coordinates)
    for k, (shape, _, _) in closed.items():
        cq.exporters.export(shape, os.path.join(out, "step", f"{k}.step"))
    cq.exporters.export(platen_head(p, d), os.path.join(out, "step", "platen_head.step"))

    if not args.no_stl:
        for k, s in print_parts(p, d).items():
            cq.exporters.export(s, os.path.join(out, "stl", f"{k}.stl"), tolerance=0.03, angularTolerance=0.15)

    # 2-D cutting profiles
    bp = base_plate(p, d)
    cq.exporters.export(bp.section(-p["base_t"] / 2), os.path.join(out, "dxf", "base_plate.dxf"))
    lk = link(p, d, 1, 180.0).rotate((0, 0, 0), (1, 0, 0), -90)
    bb = lk.val().BoundingBox()
    cq.exporters.export(lk.section((bb.zmin + bb.zmax) / 2), os.path.join(out, "dxf", "link.dxf"))

    # SolidWorks global variables (Tools > Equations > Import)
    with open(os.path.join(out, "solidworks_global_variables.txt"), "w") as f:
        for k, v in p.items():
            f.write(f'"{k}"= {v:g}\n')
        for k in ("link_len", "stroke", "z_pivot", "post_len", "xh_len"):
            f.write(f'"derived_{k}"= {d[k]:.2f}\n')
    with open(os.path.join(out, "parameters.json"), "w") as f:
        json.dump({"params": p, "derived": {k: round(v, 3) for k, v in d.items()}}, f, indent=1)

    # flat-platen forces from the simulation (standard mesh) and the crease bar
    forces = [(25, 965), (20, 1301), (15, 2367), (12, 3134)]
    table = hand_force_table(p, d, forces)
    bar_peak = 172
    with open(os.path.join(out, "hand_forces.json"), "w") as f:
        json.dump({"platen": table, "crease_bar_peak_N": bar_peak}, f, indent=1)

    hw = [
        ("Ø12 mm steel rod (guide posts)", 2, f"{d['post_len']:.0f} mm long"),
        ("LM12UU linear bearing", 2, "press into crosshead"),
        ("Ø20 mm steel rod (crease bar)", 1, f"{p['bar_len']:.0f} mm long"),
        ("Ø20 mm steel tube (handle)", 1, f"{p['handle_len'] - 62:.0f} mm long"),
        (f"Steel flat bar {p['link_w']:.0f} × {p['link_t']:.0f} mm (links)", 2, f"{d['link_len'] + p['link_w']:.0f} mm long, holes {d['link_len']:.0f} mm apart (dxf/link.dxf)"),
        ("M10 × 90 bolt + nylock nut (pivot)", 1, ""),
        ("M8 × 100 bolt + nylock nut (crank pin, crosshead pin)", 2, ""),
        ("M6 × 40 bolt (tool head mount)", 4, "+ M6 heat-set inserts in the heads"),
        ("M6 × 70 bolt + nylock nut (handle socket, through plates and tube)", 2, "drill the tube Ø6.5"),
        ("M5 × 20 screw (feet, cradle)", 12, "wood screws if the base is plywood"),
        ("M6 × 20 bolt + Ø20 washer", 4, "into the tapped ends of both posts (tap M6 × 15 deep)"),
        ("M5 × 8 set screw", 2, "crease bar in its head"),
        (f"Base plate {p['base_w']:.0f} × {p['base_d']:.0f} × {p['base_t']:.0f} mm", 1, "plywood or aluminium (dxf/base_plate.dxf)"),
        ("Optional: 160 × 160 × 3 mm aluminium face for the platen", 1, "bond to the printed platen"),
    ]
    with open(os.path.join(out, "bom.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["item", "qty", "notes"])
        for row in hw:
            w.writerow(row)
        for k in PRINTED:
            qty = 2 if k in ("post_foot", "crank_plate") else 1
            w.writerow([f"Printed: {k} (stl/{k}.stl)", qty, "PETG or PA-CF, see README"])

    print(json.dumps({k: round(v, 1) for k, v in d.items()}, indent=1))
    for row in table:
        print(row)


if __name__ == "__main__":
    main()
