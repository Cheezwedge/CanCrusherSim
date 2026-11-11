"""Render out_rotary/preview.png: the rotary crusher at load, crease and pressed positions."""
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rotary_crusher as rc


def draw(ax, parts, title, hide=(), elev=38, azim=-58):
    light = np.array([0.35, -0.5, 0.8]); light /= np.linalg.norm(light)
    polys, cols = [], []
    for k, (shape, col) in parts.items():
        if k in hide or k == "board":
            continue
        verts, tris = shape.val().tessellate(0.6, 0.35)
        V = np.array([(v.x, v.y, v.z) for v in verts]); P = V[np.array(tris)]
        n = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]); n /= np.linalg.norm(n, axis=1)[:, None] + 1e-12
        c = np.clip(np.array(col)[None, :] * (0.45 + 0.55 * np.abs(n @ light))[:, None], 0, 1)
        polys.append(P); cols.append(np.c_[c, np.full(len(c), 0.45 if k == "can" else 1.0)])
    # one collection, so faces are depth-sorted across all parts
    ax.add_collection3d(Poly3DCollection(np.concatenate(polys), facecolors=np.concatenate(cols), edgecolors="none"))
    ax.set_xlim(-40, 360); ax.set_ylim(-200, 200); ax.set_zlim(-140, 260)
    ax.set_box_aspect((1, 1, 1), zoom=1.45); ax.view_init(elev, azim); ax.axis("off"); ax.set_title(title, fontsize=10)


def main():
    p = dict(rc.P0); d = rc.derive(p)
    load = d["load_angle"]
    fig = plt.figure(figsize=(18, 6.4))
    views = [(load, True, (), "Load: both tools back, can dropped in"), (0, False, (), "Crease: cam has pushed the blade out"),
             (p["phi"], False, ("top_plate", "handle", "handle_hub", "knob"), "Pressed (top plate and handle hidden)")]
    for i, (th, can, hide, title) in enumerate(views):
        _, parts = rc.build(p, th, with_can=can)
        draw(fig.add_subplot(1, 3, i + 1, projection="3d"), parts, title, hide)
    plt.tight_layout()
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out_rotary", "preview.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    plt.savefig(out, dpi=80)
    print(out)


if __name__ == "__main__":
    main()
