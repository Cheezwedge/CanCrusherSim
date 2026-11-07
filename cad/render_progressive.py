"""Render out_progressive/preview.png (open and closed two-station press)."""
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import progressive_crusher as pc
from render_preview import draw  # noqa: E402  (reuses the shaded renderer)

p = dict(pc.PP)
_, opened = pc.build(p, 180 - p["crank_swing"])
_, closed = pc.build(p, 180)
wrap = lambda parts: {k: (s, "", c) for k, (s, c) in parts.items()}
fig = plt.figure(figsize=(13, 7))
ax1 = fig.add_subplot(1, 2, 1, projection="3d")
draw(ax1, wrap(opened), "Open: fresh can at station 1 (front), platen over station 2", elev=20, azim=-35)
ax2 = fig.add_subplot(1, 2, 2, projection="3d")
draw(ax2, wrap(closed), "Closed: crease bar and platen both at the bottom", elev=20, azim=-35)
for ax in (ax1, ax2):
    ax.set_ylim(-300, 200)
plt.tight_layout()
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out_progressive", "preview.png")
plt.savefig(out, dpi=90)
print(out)
