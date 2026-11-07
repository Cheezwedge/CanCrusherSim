# Second-press platen shapes

Is a curved or angled platen better than a flat one for the second press?

**Setup.** A 12 oz can lies on its side. Press 1 is a Ø20 round bar across its middle; it creases the can into a V and retracts cleanly. Then a 160 × 160 mm platen of each shape comes down, its lowest point stopping 6 mm above the bed.

**What is measured.** The platen force needed before the can's thickest point, under load, is down to 25 / 20 / 15 / 12 mm. For the hinged platen this is its resisting moment expressed as a force at the can's centre, so it compares like-for-like with a press pushing there. Reproduce with `node tools/study-platen-shapes.mjs [coarse|standard]`.

## Standard mesh

| Platen face | Force to 25 / 20 / 15 / 12 mm thick | Thinnest under load | Platen energy | Thickness after release |
|---|---|---|---|---|
| **Flat** | **965 / 1,301 / 2,367 / 3,134 N** | **7.0 mm** | 72 J | 7.3 mm |
| Curved, bulging down (R 400 mm) | 1,182 / 1,336 / 2,726 / 3,927 N | 9.0 mm | 75 J | 9.2 mm |
| Curved, dished up (R 400 mm) | 932 / 1,379 / 2,656 / can't reach | 13.9 mm | 40 J | 14.2 mm |
| Valley / V pointing up (5°) | 936 / 1,532 / 3,098 / can't reach | 12.6 mm | 49 J | 12.8 mm |
| Hinged clamshell (pivot just past one end) | 2,890 / 4,736 / 6,730 / 7,926 N | 10.9 mm | 79 J | 11.2 mm |

## Quick mesh (all shapes; forces read about 25% high)

| Platen face | Force to 25 / 20 / 15 / 12 mm thick | Thinnest under load |
|---|---|---|
| Flat | 1,240 / 1,622 / 2,398 / 3,532 N | 7.7 mm |
| Curved, bulging down (R 400 mm) | 1,363 / 1,888 / 2,774 / 4,254 N | 9.8 mm |
| Curved, bulging down (R 250 mm) | 1,528 / 2,419 / 2,996 / 5,923 N | 10.6 mm |
| Curved, dished up (R 400 mm) | 1,103 / 1,737 / 2,757 / can't reach | 14.0 mm |
| Roof / V pointing down (5°) | 1,383 / 2,602 / 3,359 / 5,451 N | 10.2 mm |
| Valley / V pointing up (5°) | 1,141 / 1,952 / 3,113 / can't reach | 12.0 mm |
| Flat, tilted 8° (one end first) | 2,067 / can't reach (stops at 22 mm) | 22.1 mm |
| Hinged clamshell | 3,797 / 4,691 / 6,694 / 8,021 N | 10.9 mm |

## Why flat wins

- **After the crease, the force is all in the two end rings.** The bar folds the can into a shallow V. Its two raised ends are the double seam and the base stand ring, which are the stiffest parts of the can. Both have to be flattened whatever the platen shape. A flat platen meets them squarely and pushes straight down on them.
- **Curves and V shapes spend stroke without flattening.**
  - A *bulging* (convex) or *roof* platen reaches the creased middle first, which is already flat. It then has to drive further down to reach the ends, and still leaves them thicker (9–10 mm best case).
  - A *dished* (concave) or *valley* platen does hit the raised ends first, and needs slightly less force for the first squeeze to 25 mm (about 3% less, within run-to-run noise). But its high middle never comes down, so the can can't get thinner than 12–14 mm.
- **Tilting or hinging puts the far ring on a long lever arm.** A tilted flat platen leaves the high end unflattened unless you drive much further. The hinged clamshell is what most hand lever crushers use. It crushes the near end first, then the far ring sits at twice the lever arm. It needs about 3× the equivalent force and still leaves 11 mm.
- **Takeaway:** keep the second-press platen flat and parallel to the bed, and put the mechanical advantage in the linkage driving it, not in the platen's shape. A slight dish (R ≥ 400 mm) only makes sense if a thicker 14 mm puck is acceptable. Its benefit is fewer joules, not less force.
