// Fast unit tests of the physics core: geometry, consistency, calibration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCanMesh, buildTubeMesh, buildHinges, meshVolume, CAN_PRESETS, makeRng } from '../src/physics/canGeometry.js';
import { ShellSolver } from '../src/physics/solver.js';
import { MATERIALS, prepareMaterial, returnMapJ2, membraneYield } from '../src/physics/materials.js';

test('every can preset is a closed, outward-oriented surface with realistic volume and mass', () => {
  const expected = { std355: [365, 395], tall473: [480, 515], sleek355: [350, 380], slim250: [265, 295] };
  for (const key of Object.keys(CAN_PRESETS)) {
    const m = buildCanMesh({ preset: key, nTheta: 48, imperfection: 0 });
    const { boundary } = buildHinges(m.tris, m.X.length / 3);
    assert.equal(boundary.length, 0, `${key} has open edges`);
    const mL = meshVolume(m.X, m.tris) * 1e6;
    assert.ok(mL > expected[key][0] && mL < expected[key][1], `${key} volume ${mL.toFixed(0)} mL`);
    const s = new ShellSolver(m, { selfContact: false });
    const g = s.massPhysical * 1000;
    assert.ok(g > 10 && g < 17, `${key} mass ${g.toFixed(1)} g`);
  }
});

test('rigid translation and rotation produce no internal force', () => {
  const m = buildCanMesh({ preset: 'std355', nTheta: 32, imperfection: 0.05 });
  const s = new ShellSolver(m, { selfContact: false, gravity: 0 });
  const a = 0.7, c = Math.cos(a), sn = Math.sin(a);
  for (let i = 0; i < s.N; i++) {
    const x = s.x[3 * i], y = s.x[3 * i + 1], z = s.x[3 * i + 2];
    s.x[3 * i] = c * x - sn * z + 0.01; s.x[3 * i + 1] = y - 0.02; s.x[3 * i + 2] = sn * x + c * z;
  }
  s.computeForces();
  let fmax = 0;
  for (const v of s.f) fmax = Math.max(fmax, Math.abs(v));
  assert.ok(fmax < 1e-6, `max force ${fmax}`);
});

test('internal forces are the exact gradient of the elastic energy', () => {
  const mesh = buildTubeMesh({ R: 0.02, L: 0.02, t: 2e-4, nTheta: 12 });
  const s = new ShellSolver(mesh, { selfContact: false, gravity: 0, stiffDamping: 0 });
  const rng = makeRng(3);
  for (let i = 0; i < s.x.length; i++) s.x[i] += (rng() - 0.5) * 2e-5;
  s.computeForces();
  const f = Float64Array.from(s.f);
  const h = 1e-9;
  for (let k = 0; k < 12; k++) {
    const i = Math.floor(rng() * s.x.length);
    const x0 = s.x[i];
    s.x[i] = x0 + h; const Ep = s.elasticEnergy();
    s.x[i] = x0 - h; const Em = s.elasticEnergy();
    s.x[i] = x0;
    const g = (Ep - Em) / (2 * h);
    const tol = 1e-3 * Math.max(1e-3, Math.abs(g));
    assert.ok(Math.abs(-f[i] - g) < tol, `dof ${i}: force ${-f[i]} vs dE/dx ${g}`);
  }
});

test('bending energy matches isotropic plate theory for all curvature modes', () => {
  // flat strip with the can's staggered triangulation, bent into quadratic shapes
  const R = 0.033, L = 0.04, t = 1e-4, nT = 48;
  const tube = buildTubeMesh({ R, L, t, nTheta: nT });
  const N = tube.X.length / 3;
  const th = new Float64Array(N), zz = new Float64Array(N);
  for (let i = 0; i < N; i++) { th[i] = Math.atan2(tube.X[3 * i + 1], tube.X[3 * i]); if (th[i] < 0) th[i] += 2 * Math.PI; zz[i] = tube.X[3 * i + 2]; }
  const tris = [];
  for (let e = 0; e < tube.tris.length; e += 3) {
    const a = tube.tris[e], b = tube.tris[e + 1], c = tube.tris[e + 2];
    if (Math.max(th[a], th[b], th[c]) - Math.min(th[a], th[b], th[c]) < 1) tris.push(a, b, c);
  }
  const T = tris.length / 3;
  const mk = (fz) => {
    const X = new Float64Array(3 * N);
    for (let i = 0; i < N; i++) { const u = R * th[i] - R * Math.PI, w = zz[i] - L / 2; X[3 * i] = u; X[3 * i + 1] = fz(u, w); X[3 * i + 2] = w; }
    return { X, tris: Int32Array.from(tris), nodeThick: new Float64Array(N).fill(t), triThick: new Float64Array(T).fill(t), triMat: new Uint8Array(T), meanEdge: 0.004 };
  };
  const flat = mk(() => 0);
  const s = new ShellSolver(flat, { selfContact: false });
  const D = s.mats[0].D1 * t ** 3, nu = s.mats[0].nu;
  let A = 0; for (let e = 0; e < T; e++) A += s.A0[e];
  const k = 2;
  for (const [name, [a, b, c]] of Object.entries({ k11: [k, 0, 0], k22: [0, k, 0], sphere: [k, k, 0], saddle: [k, -k, 0], twist: [0, 0, k] })) {
    s.x.set(mk((u, w) => 0.5 * a * u * u + 0.5 * b * w * w + c * u * w).X);
    s._computeHingeAngles(false);
    const ratio = s.bendingEnergy() / (0.5 * D * (a * a + b * b + 2 * nu * a * b + 2 * (1 - nu) * c * c) * A);
    assert.ok(ratio > 0.88 && ratio < 1.05, `${name}: discrete/continuum energy ${ratio.toFixed(3)}`);
    s.x.set(flat.X); s._computeHingeAngles(false);
  }
});

test('plane-stress J2 return mapping lands on the yield surface', () => {
  const m = prepareMaterial(MATERIALS[0]);
  const yp = membraneYield(m);
  const out = new Float64Array(6);
  for (const [s11, s22, s12] of [[400e6, 0, 0], [350e6, 350e6, 0], [0, 0, 250e6], [300e6, -200e6, 50e6]]) {
    const dl = returnMapJ2(m.ka, m.kb, s11, s22, s12, 0, yp, out);
    const vm = Math.sqrt(out[0] ** 2 - out[0] * out[1] + out[1] ** 2 + 3 * out[2] ** 2);
    assert.ok(dl > 0);
    assert.ok(Math.abs(vm - yp.flow(dl)) < 1e-3 * vm, `vm ${vm} vs flow ${yp.flow(dl)}`);
  }
});
