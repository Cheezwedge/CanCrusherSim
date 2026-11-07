# Can Crush Lab

A 3D simulator for crushing an aluminum beverage can. It models the can as a thin elastic-plastic metal shell. You can crush it top-down, from the side or at any angle in between, with a flat plate, a round bar or a round punch of any size. The can buckles and folds the way real cans do. While it crushes you watch it in 3D and the force–travel curve is recorded. The numbers you get are the ones you need to design a crusher:

- **force to start crushing**, the first buckle
- **peak force**
- **average force**
- **energy**
- **crushed height**
- **hand force and handle travel** for a given lever ratio

## Run it

Needs Node.js 18 or newer. There are no dependencies to install.

```bash
npm start              # serves the app at http://localhost:8080
```

Any static web server also works. Opening `index.html` straight from disk does not, because browsers block module scripts and workers on `file://` pages. Three.js loads from the jsDelivr CDN, so the browser needs internet access.

Headless runs and checks:

```bash
node tools/run.mjs '{"tiltDeg":15,"resolution":"standard"}'   # one crush, prints the force curve
npm test                                                     # unit tests + benchmarks (~1 min)
npm run validate                                             # prints the validation table below
node tools/make-reference.mjs                                # regenerates the built-in reference runs
```

## Using the simulator

| Panel | What it controls |
|---|---|
| **Can** | Size (12 oz standard, 16 oz tall, 12 oz sleek, 8.4 oz slim) and side-wall thickness. **Shape imperfection** sets how wavy the can is; real cans are never perfectly round, which is why they buckle below the theoretical load. **Pre-dent** presses a Ø10 mm steel ball into the wall before crushing. **Random can #** picks a different (reproducible) imperfection pattern. |
| **Crush direction** | Can tilt from upright: 0° crushes end-on (top-down), 90° lays the can on its side. Anything in between is an oblique crush. |
| **Crusher** | Flat plate (width × depth), round bar (diameter × length) or round punch (diameter, edge radius). You can rotate it about the vertical axis and shift it off-centre. Also sets steel-on-can friction. |
| **Run** | Where the crusher stops (height above the bed) and the mesh resolution. *Quick look* is fast but reads ~25% high on forces. *Standard* is the default. *Fine* is the most accurate and slowest. |

During a run the 3D view can show the painted can or the **plastic strain** (where the metal has permanently yielded). **Cut away** removes the front half so you can see folds stacking inside.

**Compare strategies** keeps runs side by side. **Run 6 strategies** runs six standard crushing approaches for your current can in parallel. **Lever sizing** turns the peak force into hand force and handle travel for a given lever ratio.

## What the six standard strategies show (12 oz can, standard mesh)

These are the precomputed reference rows the app opens with. The can starts 122 mm tall. Top-down runs stop at 25 mm and side runs at 12 mm.

| Strategy | Force to start | Peak (to stop) | Energy | Ends up |
|---|---|---|---|---|
| Top-down, full plate | 1,470 N | 2,640 N | 68 J | 26 mm tall |
| Top-down after a 3 mm side dent | 1,510 N | 2,840 N | 71 J | 26 mm |
| **Top-down, can tilted 15°** | **450 N** | **1,630 N** | **45 J** | 27 mm |
| Top-down, Ø40 punch on the lid | 1,620 N | 1,900 N | 54 J | 34 mm |
| Side, full plate | 420 N | 3,510 N | 84 J | 30 mm (flat, still long) |
| Side, Ø20 bar across the middle | 76 N | 161 N | 5 J | only the middle is pinched |

What this means for a low-effort crusher:

1. **Don't load the can perfectly square.** An upright can is a nearly perfect column, and its wall holds about 1.5 kN before it buckles. Tilting it about 15° under a flat plate, or loading one side of the rim, triggers the collapse at a third of that force (about 450 N). It also uses about a third less energy and still flattens the can to about 27 mm. A cradle that holds the can slightly tilted, or a pressing plate that meets the rim at an angle, gets this benefit.
2. **Top-down gives the most compact result.** The can folds into a stack about 25 mm tall.
3. **Stop at about 25 mm.** Below that the folds are stacked solid and the force climbs steeply: about 2.6 kN at 25 mm, over 4 kN at 20 mm. Over-travel adds a lot of force and saves almost no space.
4. **Crushing from the side needs little force but does not compact the can.** A narrow bar pinches the middle for under 200 N. Flattening the whole can from the side needs about 3.5 kN at the end, because the bottom and the lid seam are stiff rings, and the result is still 120 mm long.
5. **A small punch on the lid doesn't help.** It dishes the lid first and then crushes the can at about the same force, and leaves it taller.
6. **A lever trades force for distance, not energy.** A top-down crush takes about 45–70 J, roughly lifting a 5–7 kg bag by 1 m. With a 6:1 lever the tilted-can crush needs about 270 N at the handle at its peak, and only 75 N to start. The straight crush needs about 440 N at the peak. For a comfortable push of about 150 N, aim for a lever of about 11:1 with a tilted cradle, or about 18:1 for a square one.
7. **A pre-dent helped less than expected in this model** (see limitations). The tilt or off-centre load is the reliable trick.

## The physics model

The model is a 3D explicit-dynamics finite-element shell solver written in plain JavaScript (`src/physics`). It runs in a Web Worker so the page stays responsive.

**Geometry** (`canGeometry.js`): the can is built from its meridian profile:
- domed base on a stand ring and a steep heel
- ironed side wall
- die-necked shoulder
- multi-layer double seam (a thick ring)
- 5182-alloy lid with countersink and panel

It is meshed with near-equilateral staggered triangles: about 1,800 (quick), 2,900 (standard) or 5,400 (fine) nodes. Wall gauges follow real two-piece cans:
- 0.097 mm thin wall
- 0.15 mm neck
- 0.27 mm base
- 0.215 mm lid

The 12 oz model holds 378 mL brimful and weighs 14.4 g.

Imperfections are a random field with a broad spectrum down to about 6 mm wavelengths. Thin cylinders are only sensitive to imperfections that resemble their short-wave buckling modes.

**Material** (`materials.js`): body stock is AA3104-H19 after paint bake (E = 69 GPa, σy = 270 MPa); the lid is AA5182 (σy = 320 MPa). Both use Voce hardening.

**Membrane:** constant-strain triangles with Green strain (large rotations exact) and plane-stress von Mises plasticity with a backward-Euler return map.

**Bending:** rotation-free. Each edge's dihedral angle is tracked. Each triangle recovers its curvature tensor from its three edge angles, through an operator that is exact for any uniform curvature on the actual mesh.
- This gives an isotropic plate with the correct stiffness D and Poisson ratio. Simple hinge-spring models give an effective ν of −1/3 and 2–4× too much stiffness on curved meshes.
- Bending plasticity uses von Mises on the bending stress 6M/t², rising from first yield to the fully plastic moment σy·t²/4 with hardening.
- The Ilyushin membrane-force interaction M ≤ Mp·(1 − (N/Np)²) applies.
- Internal forces are the exact gradient of the elastic energy; this is checked in the tests.

**Contact:**
- Rigid steel tools are signed-distance shapes with penalty contact and Coulomb friction (elastic stick).
- Shell self-contact is node-to-triangle with spatial hashing, so folds stack on each other instead of passing through.

**Quasi-static crushing:**
- Mass scaling (×~400), Cundall local damping and a speed governor.
- The crusher moves slowly through the stiff elastic phase, which sets the start force, then speeds up while the can folds.
- Convergence was checked against much slower runs.

## Validation

| Benchmark | Theory | Simulation | Ratio |
|---|---|---|---|
| Elastic ring crush stiffness (t = 0.1 mm) | 121 N/m | 118 N/m | 0.98 |
| Plastic ring collapse load 4·Mp·L/R (t = 1 mm) | 818 N | 882 N | 1.08 (includes hardening) |
| Axial buckling of the can wall, near-perfect | 2,495 N | 2,260 N | 0.91 |
| Axial buckling, 0.05 mm random imperfection | 2,495 N | 1,622 N | 0.65 |
| Axial buckling, 0.1 mm random imperfection | 2,495 N | 1,577 N | 0.63 |
| Plate bending energy (cylinder, sphere, saddle, twist) | D·κ²/2 | — | 0.91–0.99 |

More checks:
- Test cylinders as thin as a can (R/t ≈ 340) usually buckle at 0.4–0.6 of the classical load. At standard resolution the model gives about 0.5–0.6.
- The full 12 oz can first buckles at about 1.5 kN in a diamond pattern on the side wall, in line with the ~1 kN minimum axial load can makers design to.
- The average crush force while it folds (500–700 N) falls between the classic Alexander and Pugsley–Macaulay formulas for thin tubes (about 450–700 N for this can).

## Limitations

- **Fold patterns are chaotic**, as in real cans. Different imperfection seeds change forces by ±10–15%. Run a few seeds before trusting small differences.
- **Mesh resolution:** the quick mesh reads ~25–35% high on forces. Use standard or fine for numbers you design with.
- **Dents:** pressed dents are simulated physically (ball indentation with spring-back and residual stress). But a dent much smaller than about two elements (3–4 mm at standard resolution) gets smoothed. That may be why the model shows only a small drop in start force from a side dent, while experiments on dented cylinders often report 15–30%.
- **No tearing:** aluminum can crack at very tight folds; the model doesn't fracture.
- **Only empty, open cans:** a sealed full can is held up by its internal pressure and behaves completely differently.
- **Contact thickness:** self-contact uses a 0.5 mm thickness for numerical robustness, so a fully stacked can ends up a few mm taller than a real one.

## Project layout

```
index.html               app page (layout + styles)
src/physics/             solver: geometry, materials, tools, shell solver, scenario
src/sim/                 worker runner, main-thread fallback, strategy definitions
src/ui/                  Three.js view, force chart, app controller, reference runs
tests/                   node:test unit tests and benchmarks
tools/                   static server, CLI runner, benchmarks, reference generator
```
