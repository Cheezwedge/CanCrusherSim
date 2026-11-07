# Crease then flatten without changing tools

**Question:** can one mechanism crease the can on the first press and flatten it on the second, without a manual tool swap?

## 1. One head that does both in one stroke: rejected

**Design tested.** A spring-loaded crease bar sticks out below a slotted flat platen. Its spring is preloaded above the ~170 N crease force, so the bar creases first, then gives way as the platen comes down. Reproduce with `node tools/study-one-stroke.mjs`.

**Results** (quick mesh; the two-press row is the same design run the same way, as a fair reference):

| Design | Strokes | Peak press force to reach 25 / 20 / 15 / 12 mm | Energy | Final thickness |
|---|---|---|---|---|
| Two presses: Ø20 bar, retract, flat platen | 2 | 1,240 / 1,622 / 2,398 / 3,532 N | 80 J | 8.1 mm |
| One stroke: bar 30 mm below slotted platen, spring 300→450 N | 1 | 2,419 / 3,387 / 4,443 / 6,699 N | 131 J | 11.4 mm |
| One stroke: bar 45 mm below, spring 300→450 N | 1 | 2,614 / 3,117 / 3,391 / can't reach | 108 J | 12.9 mm |
| One stroke: bar 45 mm below, spring 200→300 N | 1 | 2,754 / 3,562 / 5,386 / can't reach | 113 J | 13.9 mm |

The one-stroke head needs about **twice the force** and can't flatten below 11–14 mm.

**Why.** The cross-sections show the folded halves leaning in toward the bar while it holds the crease down. They get trapped in the slot beside the bar, the same failure as the thick crushers that snagged in the first-press study. **The crease bar has to be completely out of the way before flattening starts.**

## 2. A head that switches on every stroke: possible, but heavy

The crank always bottoms out at the same height, so a single head would have to physically rearrange itself between strokes:

- **Turret head:** the bar on one face and the platen on the other, flipped 180° at the top of each stroke by a rack and ratchet.
  - The flipping platen sweeps about an 80 mm radius, so the stroke would have to grow to about 140 mm.
- **Sliding tools with a lock:** the bar and the platen each slide about 50–75 mm relative to each other, toggled by a push-push ratchet.
  - The platen's lock must hold the full 3+ kN flattening force.

Both work on paper but add parts that can jam or wear.

## 3. Chosen: a two-station (progressive) press

Both tools are fixed to the crosshead, one behind the other:
- **Station 1 (front):** the crease bar works a fresh can.
- **Station 2 (back, under the linkage):** the flat platen flattens the can creased on the previous stroke.

**Every stroke does both.** Between strokes you slide the creased can back against a stop, and load a new one. From the second can on, each stroke finishes a can. There is no switching part at all.

**Force per stroke** (standard mesh, bar on a fresh can plus platen on a creased one; `node tools/progressive-forces.mjs`):

| Tool height above the bed | Bar | Platen | Total |
|---|---|---|---|
| 40 mm | 130 N | 823 N | 953 N |
| 25 mm | 120 N | 876 N | 997 N |
| 20 mm | 98 N | 1,361 N | 1,460 N |
| 16 mm | 98 N | 2,137 N | 2,235 N |
| 12 mm | 142 N | 3,121 N | 3,262 N |
| 8 mm | 75 N | 6,798 N | 6,873 N |

The crease bar adds only about 100–140 N. The two-station press therefore stops at **12 mm**: going to 8 mm would double the peak to about 6.9 kN, beyond what the printed parts are sized for.

**At the handle.** With the same lever and crank as the single-station press, the hand force peaks at about **120 N** at mid-stroke. Near the bottom, the toggle action of the straightening links absorbs the 3.3 kN flattening peak.

The CAD is in `cad/progressive_crusher.py`, with outputs in `cad/out_progressive/` (see [cad/README.md](../cad/README.md)).
