"""Render out/preview.png (open and closed press) from the parametric model."""
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import can_crusher as cc


def draw(ax, parts, title, elev=18, azim=-55):
    light = np.array([0.4, -0.6, 0.7]); light /= np.linalg.norm(light)
    for k, (shape, _, col) in parts.items():
        verts, tris = shape.val().tessellate(0.5, 0.3)
        V = np.array([(v.x, v.y, v.z) for v in verts])
        T = np.array(tris)
        P = V[T]
        n = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
        n /= np.linalg.norm(n, axis=1)[:, None] + 1e-12
        sh = 0.45 + 0.55 * np.abs(n @ light)
        c = np.clip(np.array(col)[None, :] * sh[:, None], 0, 1)
        alpha = 0.35 if k == "can" else 1.0
        ax.add_collection3d(Poly3DCollection(P, facecolors=np.c_[c, np.full(len(c), alpha)], edgecolors="none"))
    ax.set_xlim(-170, 300); ax.set_ylim(-235, 235); ax.set_zlim(-20, 450)
    ax.set_box_aspect((470, 470, 470)); ax.view_init(elev, azim); ax.axis("off")
    ax.set_title(title, fontsize=11)


p = dict(cc.PARAMS)
_, opened = cc.build(p, 180 - p["crank_swing"])
d, closed = cc.build(p, 180)
closed.pop("can")
fig = plt.figure(figsize=(13, 7))
draw(fig.add_subplot(1, 2, 1, projection="3d"), opened, "Open: crease-bar head fitted, can in cradle")
draw(fig.add_subplot(1, 2, 2, projection="3d"), closed, "Closed: bottom of stroke (tool 8 mm above cradle)")
plt.tight_layout()
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "preview.png")
plt.savefig(out, dpi=90)
print(out)
