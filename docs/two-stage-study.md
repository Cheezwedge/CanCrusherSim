# Two-press crusher study

**Question:** which first press needs the least force, still retracts without getting stuck, and leaves the can so a second press can flatten it as much as possible? The second press is a large flat platen.

**Sequence simulated for every candidate** (12 oz can lying on its side unless noted):

1. **Press 1:** the candidate crusher pushes down to its stop height (8 mm above the bed unless noted).
2. **Retract:** the crusher backs off at 0.15 m/s while the part of the can touching the bed is held down, like a stripper plate would hold it. If metal has folded over or wrapped around the crusher, the crusher has to drag it. That shows up as a **pull-out force**. "Snags" means it was still in contact after 20 mm of retraction.
3. **Press 2:** a 160 × 160 mm flat platen comes down toward 6 mm. The force cap is 9 kN, beyond any hand-operated mechanism. The table gives the force the platen needs to bring the can down to 20, 15 and 10 mm.

Reproduce with `node tools/study-two-stage.mjs [coarse|standard]`. Raw results are in the JSON files in this folder.

## Results: standard mesh (the more accurate one)

| First press | Press 1 peak | Pull-out on retract | Platen force to 20 / 15 / 10 mm | Final thickness | Total energy |
|---|---|---|---|---|---|
| Full flat plate only (one press, reference) | 8,495 N to reach 9 mm | — | 2,441 / 3,595 / 5,715 N | 9.1 mm | 119 J |
| **Ø10 round bar across the middle** | **150 N** | **0 N (clean)** | 1,245 / 2,697 / 4,509 N | 7.6 mm | 82 J |
| **Ø20 round bar across the middle** | **172 N** | **0 N (clean)** | 1,322 / 2,392 / 4,506 N | 7.3 mm | 77 J |
| 20 mm wide × 30 mm tall blade across the middle | 224 N | 2 N (clean) | 1,515 / 2,319 / 4,075 N | 7.2 mm | 78 J |
| 40 mm tall × 50 mm wide block across, stopped at 20 mm | 748 N | 7 N (clean) | 796 / 1,747 / 4,280 N | 6.5 mm | 68 J |
| 3 mm thin plate, 50 mm wide, across, no centre rod | 372 N | **466 N (snags)** | 897 / 1,688 / 4,516 N | 6.5 mm | 65 J |

## Results: quick mesh (all candidates; forces read about 25% high)

| First press | Press 1 peak | Pull-out on retract | Platen force to 20 / 15 / 10 mm | Final thickness |
|---|---|---|---|---|
| Full flat plate only (reference) | 8,738 N | — | 2,856 / 3,229 / 8,578 N | 10.4 mm |
| 3 mm plate, 50 mm wide, across, no rod | 464 N | 1,406 N (snags) | 1,743 / 2,780 / 5,432 N | 8.5 mm |
| 20 mm plate, 50 mm wide, across, no rod | 1,202 N | 418 N (snags) | 1,772 / 2,784 / 5,468 N | 8.8 mm |
| 40 mm block, 50 mm wide, across | 1,646 N | 75 N (snags) | 1,017 / 2,210 / 4,931 N | 8.5 mm |
| 40 mm block, 50 mm wide, across, stop at 20 mm | 775 N | 12 N | 1,100 / 2,277 / 5,072 N | 8.5 mm |
| 20 × 30 mm blade across | 258 N | 6 N | 2,283 / 2,596 / 4,771 N | 8.3 mm |
| Ø10 round bar across | 187 N | 1 N | 1,901 / 2,440 / 5,908 N | 8.8 mm |
| Ø20 round bar across | 226 N | 4 N | 1,636 / 2,398 / 4,422 N | 8.1 mm |
| Ø20 round bar across, stop at 20 mm | 184 N | 0 N | 2,328 / 2,803 / 5,957 N | 8.4 mm |
| Ø30 round bar across | 276 N | 51 N (snags) | 1,791 / 2,952 / 5,062 N | 8.2 mm |
| Ø40 round bar across | 578 N | 154 N | 1,352 / 2,165 / 4,546 N | 8.4 mm |
| Ø20 round bar along the can | 3,979 N | 140 N | 4,195 / 5,857 / 8,083 N | 10.1 mm |
| 30 mm wide plate along the can | 6,256 N | 49 N | 1,896 / 3,277 / 7,187 N | 9.3 mm |
| Top-down, can tilted 15°, full plate to 25 mm | 1,617 N | 0 N | 2,188 / 2,711 / 6,377 N | 9.3 mm |

## What it means for the mechanism

- **Best first press: a round bar, Ø10–20 mm, across the middle of the can lying on its side.** It creases the can into a V for only 150–170 N. Plain round steel bar slides out of the crease, so it retracts with essentially no pull-out force. Ø20 is the better pick: it barely costs more force than Ø10, and it is stiffer, so it won't bend between its supports.
- **Thin plates snag.** A 3 mm plate needs little force, but the can's ends fold up and over it. Pulling it back out takes 470 N (standard mesh) to 1,400 N (quick mesh), and it can drag the can with it. Flat-sided tools that go deep (20–40 mm plates or blocks pushed down to 8 mm) also get gripped by the metal wrapped around their sides. Round bars of 30–40 mm start to drag too.
- **Pressing along the can's length is the wrong way.** It needs 4–6 kN because the tool has to crush the stiff seam and base rings straight away.
- **The platen is what sets the size of the mechanism.** Pre-creasing with the bar cuts the platen force by about 45% to reach 20 mm (1.3 vs 2.4 kN), 33% to reach 15 mm (2.4 vs 3.6 kN) and 20% to reach 10 mm (4.5 vs 5.7 kN). Below about 15 mm the platen is crushing the double seam and the base stand ring, the two stiffest parts of the can, and every route needs about 4–4.5 kN to reach 10 mm. A realistic target for a hand-operated platen is **15–20 mm** (1.3–2.7 kN, about a 9–18:1 lever for a 150 N push). Going to 10 mm needs a ~30:1 lever or a toggle/screw press.
- **If the platen force matters more than press 1's force:** a 40 mm tall × 50 mm wide block that only goes down to 20 mm still retracts cleanly. It costs about 750 N on press 1 but lowers the platen force to 0.8 kN at 20 mm and 1.7 kN at 15 mm.
- **Model caveats:** fold patterns vary ±10–15% between runs. The pull-out force assumes the can is held on the bed during retraction. A can that is not held would simply be lifted by a snagging tool, which is the same problem in practice.
