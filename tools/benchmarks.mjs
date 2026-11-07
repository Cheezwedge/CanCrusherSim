// Closed-form benchmarks for the shell solver. Used by the tests and by
// `npm run validate` (which prints a summary table).
import { buildTubeMesh, makeRng } from '../src/physics/canGeometry.js';
import { ShellSolver } from '../src/physics/solver.js';
import { PlaneTool, PlateTool } from '../src/physics/tools.js';
import { MATERIALS } from '../src/physics/materials.js';

const E = MATERIALS[0].E, NU = MATERIALS[0].nu, SY = MATERIALS[0].sy0;

/**
 * Open tube (R = 33 mm, L = 100 mm) squeezed between two flat plates.
 * Theory: elastic k = L D / (0.1488 R^3); plastic collapse P = 4 M_p L / R.
 */
export function ringCrush({ t = 1e-4, travel = 0.01, v = 0.01, nTheta = 48 } = {}) {
  const R = 0.033, L = 0.1;
  const mesh = buildTubeMesh({ R, L, t, nTheta });
  for (let i = 0; i < mesh.X.length / 3; i++) { mesh.X[3 * i + 1] += R + t / 2; mesh.X[3 * i + 2] -= L / 2; }
  const s = new ShellSolver(mesh, { massScale: 400, localDamping: 0.1, gravity: 0, selfContact: false, dtSafety: 0.8 });
  const anvil = s.addTool(new PlaneTool({ friction: 0.25 })); anvil.py = 0;
  const top = s.addTool(new PlateTool({ width: 0.2, length: 0.2, friction: 0.25 }));
  top.py = 2 * R + t + 1e-5;
  const D = (E * t ** 3) / (12 * (1 - NU * NU));
  const kTheory = (L * D) / (0.1488 * R ** 3);
  const Pc = (SY * t * t * L) / R;
  let d = 0, F4 = 0, F8 = 0;
  const avg = [];
  while (d < travel) {
    top.vy = -v; s.step(); d += v * s.dt;
    avg.push(top.fy); if (avg.length > 200) avg.shift();
    const Fm = avg.reduce((a, b) => a + b, 0) / avg.length;
    if (!F4 && d >= travel / 2) F4 = Fm;
    if (d >= travel) F8 = Fm;
  }
  return { kTheory, Pc, F: F8, kSecant: (F8 - F4) / (travel / 2), travel };
}

/**
 * Axial compression of the bare can wall (R = 33 mm, t = 0.097 mm, L = 90 mm)
 * with a broad-spectrum random imperfection. Classical load
 * P = 2 pi E t^2 / sqrt(3 (1 - nu^2)).
 */
export function tubeBuckling({ imperfection = 0.05e-3, nTheta = 44, seed = 5 } = {}) {
  const R = 0.033, L = 0.09, t = 0.097e-3;
  const mesh = buildTubeMesh({ R, L, t, nTheta });
  const N = mesh.X.length / 3;
  const rng = makeRng(seed);
  const modes = [];
  for (let m = 1; m <= 14; m++) for (let n = 0; n <= 16; n++) modes.push({ m, n, c: (rng() * 2 - 1) / (1 + 0.08 * (m + n)), ph: rng() * 6.28 });
  const w = new Float64Array(N);
  let mx = 0;
  for (let i = 0; i < N; i++) {
    const th = Math.atan2(mesh.X[3 * i + 1], mesh.X[3 * i]), z = mesh.X[3 * i + 2] / L;
    let d = 0;
    for (const md of modes) d += md.c * Math.sin(md.m * Math.PI * z) * Math.cos(md.n * th + md.ph);
    w[i] = d; mx = Math.max(mx, Math.abs(d));
  }
  for (let i = 0; i < N; i++) {
    const th = Math.atan2(mesh.X[3 * i + 1], mesh.X[3 * i]);
    const r = R + (imperfection * w[i]) / mx, z = mesh.X[3 * i + 2];
    mesh.X[3 * i] = r * Math.cos(th); mesh.X[3 * i + 1] = z + 1e-4; mesh.X[3 * i + 2] = r * Math.sin(th);
  }
  const s = new ShellSolver(mesh, { massScale: 400, localDamping: 0.1, selfContact: false, dtSafety: 0.8, gravity: 0 });
  const anvil = s.addTool(new PlaneTool({ friction: 0.6 })); anvil.py = 0;
  const top = s.addTool(new PlateTool({ width: 0.2, length: 0.2, friction: 0.6 })); top.py = L + 2.5e-4;
  const Pcl = (2 * Math.PI * E * t * t) / Math.sqrt(3 * (1 - NU * NU));
  let d = 0, peak = 0;
  const v = 0.015;
  while (d < 0.0012) { top.vy = -v; s.step(); d += v * s.dt; if (top.fy > peak) peak = top.fy; }
  return { classical: Pcl, peak, knockdown: peak / Pcl };
}
