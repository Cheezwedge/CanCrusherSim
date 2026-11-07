// Explicit-dynamics elastic-plastic thin-shell solver.
//
// Discretisation (rotation-free shell on a triangle mesh):
//  * Membrane: constant-strain triangles, total-Lagrangian Green strain,
//    plane-stress J2 (von Mises) plasticity with Voce hardening.
//  * Bending: rotation-free. The dihedral angle of every interior edge is
//    tracked; each triangle recovers its curvature-change tensor from the
//    angles of its three edges through a 3x3 operator that is exact for any
//    uniform curvature field on the actual (unfolded) neighbour geometry.
//    This gives an isotropic plate response with the correct D and Poisson
//    ratio (plain hinge-spring models give nu = -1/3 on inscribed meshes).
//    Plasticity is evaluated per triangle on the bending stress
//    6M/t^2 with a von Mises yield surface that rises from first yield to the
//    fully plastic moment (sigma_y t^2/4) with hardening, and the Ilyushin
//    membrane-force interaction M/Mp <= 1 - (N/Np)^2. Hinge moments follow by
//    energy conjugacy, so a fold along an edge dissipates exactly m_p * l * angle.
//  * Contact: penalty contact with rigid tools (SDF) including Coulomb friction
//    with elastic stick; node-triangle self-contact with a contact thickness so
//    folds stack on each other instead of passing through.
//  * Time integration: central difference (symplectic Euler), lumped masses,
//    selective + global mass scaling, Cundall local non-viscous damping and a
//    little stiffness-proportional damping for quasi-static crushing.

import { MATERIALS, prepareMaterial, flowStress, returnMapJ2, membraneYield, makeBendingYield, bendingFlowNoG } from './materials.js';
import { buildHinges } from './canGeometry.js';

const TWO_PI = 2 * Math.PI;

export class ShellSolver {
  /**
   * @param {object} mesh  from buildCanMesh (positions may already be transformed)
   * @param {object} opts
   *   massScale       global density scaling factor S (>= 1)
   *   dtSafety        fraction of the critical step (default 0.6)
   *   localDamping    Cundall coefficient (default 0.2)
   *   stiffDamping    stiffness-proportional damping ratio at the highest frequency
   *   contactThickness  self-contact thickness (m)
   *   selfContact     enable self-contact (default true)
   *   yieldScale      multiply yield stresses (material variability)
   */
  constructor(mesh, opts = {}) {
    this.opts = opts;
    const X = mesh.X;
    const N = (this.N = X.length / 3);
    const tris = mesh.tris;
    const T = (this.T = tris.length / 3);
    this.tris = tris;
    this.x = Float64Array.from(X);
    this.X0 = Float64Array.from(X);
    this.v = new Float64Array(3 * N);
    this.f = new Float64Array(3 * N);
    this.nodeThick = mesh.nodeThick;
    this.mats = MATERIALS.map((m) => prepareMaterial(m, opts.yieldScale ?? 1));

    // ---- triangles --------------------------------------------------------
    this.DmInv = new Float64Array(4 * T);
    this.A0 = new Float64Array(T);
    this.thick = Float64Array.from(mesh.triThick);
    this.mat = Uint8Array.from(mesh.triMat);
    this.Ep = new Float64Array(3 * T);      // plastic Green strain (tensor comps 11,22,12)
    this.alpha = new Float64Array(T);       // equivalent plastic strain (membrane)
    this.Eprev = new Float64Array(3 * T);   // previous total strain (for damping)
    this.triN = new Float64Array(3 * T);    // current unnormalised normal (|N| = 2A)
    this.triRatio2 = new Float64Array(T);   // (von Mises / yield)^2 (membrane)
    this.triSY = new Float64Array(T);       // current membrane yield stress (Pa)
    const dtPhys = new Float64Array(T);
    const te1 = new Float64Array(3 * T), te2 = new Float64Array(3 * T);

    for (let e = 0; e < T; e++) {
      const i0 = 3 * tris[3 * e], i1 = 3 * tris[3 * e + 1], i2 = 3 * tris[3 * e + 2];
      const ax = X[i1] - X[i0], ay = X[i1 + 1] - X[i0 + 1], az = X[i1 + 2] - X[i0 + 2];
      const bx = X[i2] - X[i0], by = X[i2 + 1] - X[i0 + 1], bz = X[i2 + 2] - X[i0 + 2];
      const la = Math.hypot(ax, ay, az);
      const e1x = ax / la, e1y = ay / la, e1z = az / la;
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const nl = Math.hypot(nx, ny, nz);
      const e2x = (ny * e1z - nz * e1y) / nl, e2y = (nz * e1x - nx * e1z) / nl, e2z = (nx * e1y - ny * e1x) / nl;
      // rest coords: p1 = (la, 0), p2 = (b.e1, b.e2)
      const p2x = bx * e1x + by * e1y + bz * e1z;
      const p2y = bx * e2x + by * e2y + bz * e2z;
      // Dm = [[la, p2x],[0, p2y]] ; inverse
      const det = la * p2y;
      this.DmInv[4 * e] = p2y / det;      // Di00
      this.DmInv[4 * e + 1] = -p2x / det; // Di01
      this.DmInv[4 * e + 2] = 0;          // Di10
      this.DmInv[4 * e + 3] = la / det;   // Di11
      this.A0[e] = 0.5 * nl;
      te1[3 * e] = e1x; te1[3 * e + 1] = e1y; te1[3 * e + 2] = e1z;
      te2[3 * e] = e2x; te2[3 * e + 1] = e2y; te2[3 * e + 2] = e2z;
      this.triN[3 * e] = nx; this.triN[3 * e + 1] = ny; this.triN[3 * e + 2] = nz;
      const lb = Math.hypot(bx, by, bz);
      const lc = Math.hypot(X[i2] - X[i1], X[i2 + 1] - X[i1 + 1], X[i2 + 2] - X[i1 + 2]);
      const lmax = Math.max(la, lb, lc);
      const alt = nl / lmax;
      const m = this.mats[this.mat[e]];
      const c = Math.sqrt(m.E / (m.rho * (1 - m.nu * m.nu)));
      dtPhys[e] = alt / c;
    }

    for (let e = 0; e < T; e++) this.triSY[e] = this.mats[this.mat[e]].sy0;

    // ---- hinges and per-triangle curvature operators ----------------------
    // Boundary (free) edges carry no hinge.
    const { hinges } = buildHinges(tris, N);
    const H = (this.H = hinges.length);
    this.hIdx = new Int32Array(4 * H);
    this.hTri = new Int32Array(2 * H);
    this.hK = new Float64Array(H);      // effective rotational stiffness (stability only)
    this.hTheta = new Float64Array(H);
    this.hTheta0 = new Float64Array(H);
    this.hMh = new Float64Array(H);     // generalised moment conjugate to the angle
    this.hCos = new Float64Array(H);    // unit (cos, sin) of the current angle
    this.hSin = new Float64Array(H);
    this.triHinge = new Int32Array(3 * T).fill(-1);
    this.triB = new Float64Array(9 * T);
    this.Ebp = new Float64Array(3 * T);   // plastic outer-fibre bending strain (tensor)
    this.alphaB = new Float64Array(T);    // equivalent outer-fibre plastic strain
    this.triSB = new Float64Array(T);     // bending yield (sigma_b units, without N-M factor)
    this.Kprev = new Float64Array(3 * T); // previous curvature (damping)
    const hCoef = new Float64Array(3 * H); // theta = a1 K11 + a2 K22 + a3 K12 (hinge frame)
    const triCoefRows = new Float64Array(9 * T);
    const rowSet = new Uint8Array(3 * T);
    const edgeSlot = (e, i, j) => {
      for (let k = 0; k < 3; k++) if (tris[3 * e + k] === i && tris[3 * e + ((k + 1) % 3)] === j) return k;
      return -1;
    };
    const rowFor = (e, slot, ax, ay, az, l, a1, a2, a3) => {
      // edge direction of the hinge (a->b) in triangle e's local 2D frame
      const ex = (ax * te1[3 * e] + ay * te1[3 * e + 1] + az * te1[3 * e + 2]) / l;
      const ey = (ax * te2[3 * e] + ay * te2[3 * e + 1] + az * te2[3 * e + 2]) / l;
      const yx = -ey, yy = ex;
      const r = 9 * e + 3 * slot;
      triCoefRows[r] = a1 * ex * ex + a2 * yx * yx + a3 * ex * yx;
      triCoefRows[r + 1] = a1 * ey * ey + a2 * yy * yy + a3 * ey * yy;
      triCoefRows[r + 2] = 2 * a1 * ex * ey + 2 * a2 * yx * yy + a3 * (ex * yy + ey * yx);
      rowSet[3 * e + slot] = 1;
    };
    const unfoldCoef = (a, b, c, d) => {
      const ax = X[3 * b] - X[3 * a], ay = X[3 * b + 1] - X[3 * a + 1], az = X[3 * b + 2] - X[3 * a + 2];
      const l = Math.hypot(ax, ay, az);
      const ux = ax / l, uy = ay / l, uz = az / l;
      const tip = (q) => {
        const qx = X[3 * q] - X[3 * a], qy = X[3 * q + 1] - X[3 * a + 1], qz = X[3 * q + 2] - X[3 * a + 2];
        const px = qx * ux + qy * uy + qz * uz;
        const py = Math.hypot(qx - px * ux, qy - px * uy, qz - px * uz);
        return [px, py];
      };
      const [cx, cy] = tip(c);
      let [dx, dy] = d >= 0 ? tip(d) : [cx, cy]; // free edge: mirror image
      dy = -dy;
      const a1 = 0.5 * dx * (dx - l) / dy - 0.5 * cx * (cx - l) / cy;
      const a2 = 0.5 * (dy - cy);
      const a3 = dx - cx;
      return { ax, ay, az, l, a1, a2, a3 };
    };
    for (let h = 0; h < H; h++) {
      const g = hinges[h];
      this.hIdx[4 * h] = g.a; this.hIdx[4 * h + 1] = g.b; this.hIdx[4 * h + 2] = g.c; this.hIdx[4 * h + 3] = g.d;
      this.hTri[2 * h] = g.t1; this.hTri[2 * h + 1] = g.t2;
      const u = unfoldCoef(g.a, g.b, g.c, g.d);
      hCoef[3 * h] = u.a1; hCoef[3 * h + 1] = u.a2; hCoef[3 * h + 2] = u.a3;
      const s1 = edgeSlot(g.t1, g.a, g.b), s2 = edgeSlot(g.t2, g.b, g.a);
      this.triHinge[3 * g.t1 + s1] = h;
      this.triHinge[3 * g.t2 + s2] = h;
      rowFor(g.t1, s1, u.ax, u.ay, u.az, u.l, u.a1, u.a2, u.a3);
      rowFor(g.t2, s2, u.ax, u.ay, u.az, u.l, u.a1, u.a2, u.a3);
    }
    // free edges: mirrored pseudo-hinge with zero rotation (symmetry condition)
    for (let e = 0; e < T; e++) {
      for (let k = 0; k < 3; k++) {
        if (rowSet[3 * e + k]) continue;
        const a = tris[3 * e + k], b = tris[3 * e + ((k + 1) % 3)], c = tris[3 * e + ((k + 2) % 3)];
        const u = unfoldCoef(a, b, c, -1);
        rowFor(e, k, u.ax, u.ay, u.az, u.l, u.a1, u.a2, u.a3);
      }
    }
    // invert the 3x3 angle<-curvature maps
    for (let e = 0; e < T; e++) {
      const r = 9 * e, C = triCoefRows;
      // C rows = edges (theta_k), cols = kappa (11, 22, 12)
      const c00 = C[r], c01 = C[r + 1], c02 = C[r + 2];
      const c10 = C[r + 3], c11 = C[r + 4], c12 = C[r + 5];
      const c20 = C[r + 6], c21 = C[r + 7], c22 = C[r + 8];
      const det = c00 * (c11 * c22 - c12 * c21) - c01 * (c10 * c22 - c12 * c20) + c02 * (c10 * c21 - c11 * c20);
      const id = 1 / det;
      // B = C^-1 : rows = kappa comps, cols = edges
      const B = this.triB;
      B[r] = (c11 * c22 - c12 * c21) * id; B[r + 1] = (c02 * c21 - c01 * c22) * id; B[r + 2] = (c01 * c12 - c02 * c11) * id;
      B[r + 3] = (c12 * c20 - c10 * c22) * id; B[r + 4] = (c00 * c22 - c02 * c20) * id; B[r + 5] = (c02 * c10 - c00 * c12) * id;
      B[r + 6] = (c10 * c21 - c11 * c20) * id; B[r + 7] = (c01 * c20 - c00 * c21) * id; B[r + 8] = (c00 * c11 - c01 * c10) * id;
      const m = this.mats[this.mat[e]];
      this.triSB[e] = bendingFlowNoG(m, 0);
      // effective rotational stiffness of each edge seen from this triangle
      const t = this.thick[e];
      const Dq = (this.A0[e] * t * t * t) / 12;
      for (let k = 0; k < 3; k++) {
        const h = this.triHinge[3 * e + k];
        if (h < 0) continue;
        const k11 = B[r + k], k22 = B[r + 3 + k], k12 = B[r + 6 + k];
        this.hK[h] += Dq * (m.C11 * (k11 * k11 + k22 * k22) + 2 * m.C12 * k11 * k22 + 4 * m.G * k12 * k12);
      }
    }
    this._computeHingeAngles(true);
    this.hTheta0.set(this.hTheta);
    this._membraneYield = this.mats.map((m) => membraneYield(m));
    this._bendYield = makeBendingYield();

    // ---- masses, mass scaling and time step ---------------------------------
    const S = Math.max(1, opts.massScale ?? 1);
    const safety = opts.dtSafety ?? 0.6;
    const sorted = Float64Array.from(dtPhys).sort();
    const dtRef = sorted[Math.floor(0.15 * (T - 1))];
    const dtTarget = safety * dtRef * Math.sqrt(S);
    this.mPhys = new Float64Array(N);
    this.m = new Float64Array(N);
    for (let e = 0; e < T; e++) {
      const mt = this.mats[this.mat[e]];
      const mass = (mt.rho * this.thick[e] * this.A0[e]) / 3;
      const dte = safety * dtPhys[e];
      const s = Math.max(S, (dtTarget / dte) ** 2);
      for (let k = 0; k < 3; k++) {
        const i = tris[3 * e + k];
        this.mPhys[i] += mass;
        this.m[i] += mass * s;
      }
    }
    // bending (hinge) stability check: omega^2 = k sum |g|^2 / m
    for (let pass = 0; pass < 2; pass++) {
      const grads = this._hingeGradNorms();
      for (let h = 0; h < H; h++) {
        let w2 = 0;
        for (let k = 0; k < 4; k++) w2 += grads[4 * h + k] / this.m[this.hIdx[4 * h + k]];
        w2 *= this.hK[h] * 4; // 4: several hinges + membrane share each node
        const dth = (safety * 2) / Math.sqrt(w2);
        if (dth < dtTarget) {
          const s = (dtTarget / dth) ** 2;
          for (let k = 0; k < 4; k++) this.m[this.hIdx[4 * h + k]] *= s;
        }
      }
    }
    this.dt = dtTarget;
    let mp = 0, ms = 0;
    for (let i = 0; i < N; i++) { mp += this.mPhys[i]; ms += this.m[i]; }
    this.massPhysical = mp;
    this.massScaled = ms;
    this.invM = new Float64Array(N);
    for (let i = 0; i < N; i++) this.invM[i] = 1 / this.m[i];

    this.localDamping = opts.localDamping ?? 0.2;
    this.beta = (opts.stiffDamping ?? 0.1) * this.dt;
    this.gravity = opts.gravity ?? -9.81; // applied with physical mass along y

    // ---- tools / contact --------------------------------------------------
    this.tools = [];
    this.toolFric = [];
    this.contactKappa = opts.contactKappa ?? 0.15;
    this.contactZeta = 0.4;

    // ---- self contact -----------------------------------------------------
    this.selfContact = opts.selfContact ?? true;
    this.hc = opts.contactThickness ?? 0.5e-3;
    this.scMargin = opts.contactMargin ?? Math.max(0.6e-3, this.hc);
    this.cellSize = Math.max(mesh.meanEdge || 0.003, 2 * (this.hc + this.scMargin));
    this.pairNode = new Int32Array(16 * N);
    this.pairTri = new Int32Array(16 * N);
    this.nPairs = 0;
    this.travelSinceRebuild = Infinity;
    this.triStamp = new Int32Array(T).fill(-1);
    this.excluded = new Set();
    this.scForceTotal = 0;
    this.fixed = null;
    if (this.selfContact) {
      // pairs already within the contact distance at rest are excluded
      this._rebuildSelfContact(true);
    }

    this.time = 0;
    this.steps = 0;
    this.kinetic = 0;
    this.maxSpeed = 0;
    this.plasticWork = 0;
    this._rm = new Float64Array(6);
  }

  addTool(tool) {
    this.tools.push(tool);
    this.toolFric.push({ fx: new Float64Array(this.N), fy: new Float64Array(this.N), fz: new Float64Array(this.N) });
    return tool;
  }

  _hingeGradNorms() {
    // |dtheta/dx_k|^2 for each of the 4 hinge nodes at the current geometry
    const out = new Float64Array(4 * this.H);
    const x = this.x, hIdx = this.hIdx;
    for (let h = 0; h < this.H; h++) {
      const a = 3 * hIdx[4 * h], b = 3 * hIdx[4 * h + 1], c = 3 * hIdx[4 * h + 2], d = 3 * hIdx[4 * h + 3];
      const ex = x[b] - x[a], ey = x[b + 1] - x[a + 1], ez = x[b + 2] - x[a + 2];
      const le2 = ex * ex + ey * ey + ez * ez;
      const cx = x[c] - x[a], cy = x[c + 1] - x[a + 1], cz = x[c + 2] - x[a + 2];
      const dx = x[d] - x[a], dy = x[d + 1] - x[a + 1], dz = x[d + 2] - x[a + 2];
      const n1x = ey * cz - ez * cy, n1y = ez * cx - ex * cz, n1z = ex * cy - ey * cx;
      const n2x = dy * ez - dz * ey, n2y = dz * ex - dx * ez, n2z = dx * ey - dy * ex;
      const n1sq = n1x * n1x + n1y * n1y + n1z * n1z, n2sq = n2x * n2x + n2y * n2y + n2z * n2z;
      const gc = le2 / n1sq, gd = le2 / n2sq; // |le N/|N|^2|^2 = le^2/|N|^2
      out[4 * h + 2] = gc; out[4 * h + 3] = gd;
      out[4 * h] = 0.5 * (gc + gd); out[4 * h + 1] = 0.5 * (gc + gd);
    }
    return out;
  }

  _computeHingeAngles(init) {
    const x = this.x, hIdx = this.hIdx, th = this.hTheta;
    for (let h = 0; h < this.H; h++) {
      const a = 3 * hIdx[4 * h], b = 3 * hIdx[4 * h + 1], c = 3 * hIdx[4 * h + 2], d = 3 * hIdx[4 * h + 3];
      const ex = x[b] - x[a], ey = x[b + 1] - x[a + 1], ez = x[b + 2] - x[a + 2];
      const cx = x[c] - x[a], cy = x[c + 1] - x[a + 1], cz = x[c + 2] - x[a + 2];
      const dx = x[d] - x[b], dy = x[d + 1] - x[b + 1], dz = x[d + 2] - x[b + 2];
      // N1 = e x (c-a); N2 = (a-b) x (d-b) = -e x (d-b)
      const n1x = ey * cz - ez * cy, n1y = ez * cx - ex * cz, n1z = ex * cy - ey * cx;
      const n2x = -(ey * dz - ez * dy), n2y = -(ez * dx - ex * dz), n2z = -(ex * dy - ey * dx);
      const le = Math.sqrt(ex * ex + ey * ey + ez * ez);
      const cs = n1x * n2x + n1y * n2y + n1z * n2z;
      const crx = n1y * n2z - n1z * n2y, cry = n1z * n2x - n1x * n2z, crz = n1x * n2y - n1y * n2x;
      const sn = (crx * ex + cry * ey + crz * ez) / le;
      let t = Math.atan2(sn, cs);
      if (!init) {
        let dlt = t - th[h];
        dlt -= TWO_PI * Math.round(dlt / TWO_PI);
        t = th[h] + dlt;
      }
      th[h] = t;
      this.hCos[h] = Math.cos(t);
      this.hSin[h] = Math.sin(t);
    }
  }

  // =========================================================================
  /** One explicit time step: internal + contact forces, then integration. */
  step() {
    this.computeForces();
    this._integrate();
  }

  /** Assemble all nodal forces into this.f (updates plastic state). */
  computeForces() {
    const T = this.T, H = this.H;
    const x = this.x, f = this.f;
    const dt = this.dt;
    f.fill(0);

    // ---------------- membrane (CST + J2 plane stress) ----------------------
    const tris = this.tris, DmInv = this.DmInv, A0 = this.A0, thick = this.thick;
    const Ep = this.Ep, alpha = this.alpha, Eprev = this.Eprev, triN = this.triN;
    const triRatio2 = this.triRatio2, triSY = this.triSY, matArr = this.mat, mats = this.mats;
    const beta = this.beta, invDt = 1 / dt, rm = this._rm;
    let plasticW = 0;
    for (let e = 0; e < T; e++) {
      const i0 = 3 * tris[3 * e], i1 = 3 * tris[3 * e + 1], i2 = 3 * tris[3 * e + 2];
      const d1x = x[i1] - x[i0], d1y = x[i1 + 1] - x[i0 + 1], d1z = x[i1 + 2] - x[i0 + 2];
      const d2x = x[i2] - x[i0], d2y = x[i2 + 1] - x[i0 + 1], d2z = x[i2 + 2] - x[i0 + 2];
      const q = 4 * e;
      const D00 = DmInv[q], D01 = DmInv[q + 1], D11 = DmInv[q + 3]; // D10 = 0
      // F = [d1 d2] Dm^-1 : col0 = d1*D00 ; col1 = d1*D01 + d2*D11
      const f0x = d1x * D00, f0y = d1y * D00, f0z = d1z * D00;
      const f1x = d1x * D01 + d2x * D11, f1y = d1y * D01 + d2y * D11, f1z = d1z * D01 + d2z * D11;
      const c00 = f0x * f0x + f0y * f0y + f0z * f0z;
      const c11 = f1x * f1x + f1y * f1y + f1z * f1z;
      const c01 = f0x * f1x + f0y * f1y + f0z * f1z;
      const E11 = 0.5 * (c00 - 1), E22 = 0.5 * (c11 - 1), E12 = 0.5 * c01;
      const p3 = 3 * e;
      const mt = mats[matArr[e]];
      const C11 = mt.C11, C12 = mt.C12, G = mt.G;
      const ee11 = E11 - Ep[p3], ee22 = E22 - Ep[p3 + 1], ee12 = E12 - Ep[p3 + 2];
      let s11 = C11 * ee11 + C12 * ee22;
      let s22 = C12 * ee11 + C11 * ee22;
      let s12 = 2 * G * ee12;
      const vm2 = s11 * s11 - s11 * s22 + s22 * s22 + 3 * s12 * s12;
      const sy = triSY[e];
      if (vm2 > sy * sy) {
        const al = alpha[e];
        const dl = returnMapJ2(mt.ka, mt.kb, s11, s22, s12, al, this._membraneYield[matArr[e]], rm);
        s11 = rm[0]; s22 = rm[1]; s12 = rm[2];
        Ep[p3] += rm[3]; Ep[p3 + 1] += rm[4]; Ep[p3 + 2] += rm[5];
        const an = al + dl;
        alpha[e] = an;
        triSY[e] = flowStress(mt, an);
        plasticW += (s11 * rm[3] + s22 * rm[4] + 2 * s12 * rm[5]) * A0[e] * thick[e];
        triRatio2[e] = 1;
      } else {
        triRatio2[e] = vm2 / (sy * sy);
      }
      // stiffness-proportional damping on the strain rate
      const r11 = (E11 - Eprev[p3]) * invDt, r22 = (E22 - Eprev[p3 + 1]) * invDt, r12 = (E12 - Eprev[p3 + 2]) * invDt;
      Eprev[p3] = E11; Eprev[p3 + 1] = E22; Eprev[p3 + 2] = E12;
      const S11 = s11 + beta * (C11 * r11 + C12 * r22);
      const S22 = s22 + beta * (C12 * r11 + C11 * r22);
      const S12 = s12 + beta * 2 * G * r12;
      // P = F S ; forces = -A t P Dm^-T
      const At = A0[e] * thick[e];
      const P0x = f0x * S11 + f1x * S12, P0y = f0y * S11 + f1y * S12, P0z = f0z * S11 + f1z * S12;
      const P1x = f0x * S12 + f1x * S22, P1y = f0y * S12 + f1y * S22, P1z = f0z * S12 + f1z * S22;
      // node1: -(P0*D00 + P1*D01) ; node2: -(P1*D11)  (D10 = 0)
      const g1x = -At * (P0x * D00 + P1x * D01), g1y = -At * (P0y * D00 + P1y * D01), g1z = -At * (P0z * D00 + P1z * D01);
      const g2x = -At * P1x * D11, g2y = -At * P1y * D11, g2z = -At * P1z * D11;
      f[i1] += g1x; f[i1 + 1] += g1y; f[i1 + 2] += g1z;
      f[i2] += g2x; f[i2 + 1] += g2y; f[i2 + 2] += g2z;
      f[i0] -= g1x + g2x; f[i0 + 1] -= g1y + g2y; f[i0 + 2] -= g1z + g2z;
      // current normal (for hinges)
      triN[p3] = d1y * d2z - d1z * d2y;
      triN[p3 + 1] = d1z * d2x - d1x * d2z;
      triN[p3 + 2] = d1x * d2y - d1y * d2x;
    }

    // ---------------- bending, pass 1: dihedral angles ------------------------
    const hIdx = this.hIdx, hTri = this.hTri, hMh = this.hMh;
    const hTheta = this.hTheta, hTheta0 = this.hTheta0, hCos = this.hCos, hSin = this.hSin;
    for (let h = 0; h < H; h++) {
      const q4 = 4 * h;
      const a = 3 * hIdx[q4], b = 3 * hIdx[q4 + 1];
      const t1 = 3 * hTri[2 * h], t2 = 3 * hTri[2 * h + 1];
      const n1x = triN[t1], n1y = triN[t1 + 1], n1z = triN[t1 + 2];
      const n2x = triN[t2], n2y = triN[t2 + 1], n2z = triN[t2 + 2];
      const ex = x[b] - x[a], ey = x[b + 1] - x[a + 1], ez = x[b + 2] - x[a + 2];
      const cs = n1x * n2x + n1y * n2y + n1z * n2z;
      const crx = n1y * n2z - n1z * n2y, cry = n1z * n2x - n1x * n2z, crz = n1x * n2y - n1y * n2x;
      const sn = (crx * ex + cry * ey + crz * ez) / Math.sqrt(ex * ex + ey * ey + ez * ez);
      // Incremental dihedral angle: rotate (cs, sn) back by the previous angle
      // and take atan of the (tiny) remainder -- exact, and much cheaper than
      // atan2 every step. Angles are tracked continuously beyond +-pi.
      const rinv = 1 / Math.sqrt(cs * cs + sn * sn);
      const cu = cs * rinv, su = sn * rinv;
      const c0 = hCos[h], s0 = hSin[h];
      const yy = su * c0 - cu * s0, xx = cu * c0 + su * s0;
      let dlt;
      if (xx > 0.995 && yy < 0.1 && yy > -0.1) {
        const z = yy / xx, z2 = z * z;
        dlt = z * (1 - z2 * (0.3333333333333333 - z2 * (0.2 - z2 * 0.14285714285714285)));
      } else {
        dlt = Math.atan2(yy, xx);
      }
      hCos[h] = cu; hSin[h] = su;
      hTheta[h] += dlt;
      hMh[h] = 0;
    }

    // ---------------- bending, pass 2: curvature, plasticity, moments ---------
    const triHinge = this.triHinge, triB = this.triB, Ebp = this.Ebp, alphaB = this.alphaB;
    const triSB = this.triSB, Kprev = this.Kprev, by = this._bendYield;
    for (let e = 0; e < T; e++) {
      const p3 = 3 * e, r = 9 * e;
      const h0 = triHinge[p3], h1 = triHinge[p3 + 1], h2 = triHinge[p3 + 2];
      const d0 = h0 >= 0 ? hTheta[h0] - hTheta0[h0] : 0;
      const d1 = h1 >= 0 ? hTheta[h1] - hTheta0[h1] : 0;
      const d2 = h2 >= 0 ? hTheta[h2] - hTheta0[h2] : 0;
      const k11 = triB[r] * d0 + triB[r + 1] * d1 + triB[r + 2] * d2;
      const k22 = triB[r + 3] * d0 + triB[r + 4] * d1 + triB[r + 5] * d2;
      const k12 = triB[r + 6] * d0 + triB[r + 7] * d1 + triB[r + 8] * d2;
      const t = thick[e], ht = 0.5 * t;
      const mt = mats[matArr[e]];
      const C11 = mt.C11, C12 = mt.C12, G = mt.G;
      // outer-fibre bending strain and stress (sigma_b = 6 M / t^2)
      const b11 = ht * k11 - Ebp[p3], b22 = ht * k22 - Ebp[p3 + 1], b12 = ht * k12 - Ebp[p3 + 2];
      let s11 = C11 * b11 + C12 * b22;
      let s22 = C12 * b11 + C11 * b22;
      let s12 = 2 * G * b12;
      let gN = 1 - triRatio2[e];
      if (gN < 0.08) gN = 0.08;
      const syb = triSB[e] * gN;
      const vm2 = s11 * s11 - s11 * s22 + s22 * s22 + 3 * s12 * s12;
      if (vm2 > syb * syb) {
        by.m = mt; by.g = gN;
        const ab = alphaB[e];
        const dl = returnMapJ2(mt.ka, mt.kb, s11, s22, s12, ab, by, rm);
        s11 = rm[0]; s22 = rm[1]; s12 = rm[2];
        Ebp[p3] += rm[3]; Ebp[p3 + 1] += rm[4]; Ebp[p3 + 2] += rm[5];
        const an = ab + dl;
        alphaB[e] = an;
        triSB[e] = bendingFlowNoG(mt, an);
        // dissipated work: M : dkappa_p * A = (t/3) sigma_b : deps_bp * A
        plasticW += (s11 * rm[3] + s22 * rm[4] + 2 * s12 * rm[5]) * A0[e] * t / 3;
      }
      // stiffness-proportional damping on the curvature rate
      const r11 = (k11 - Kprev[p3]) * invDt * ht, r22 = (k22 - Kprev[p3 + 1]) * invDt * ht, r12 = (k12 - Kprev[p3 + 2]) * invDt * ht;
      Kprev[p3] = k11; Kprev[p3 + 1] = k22; Kprev[p3 + 2] = k12;
      s11 += beta * (C11 * r11 + C12 * r22);
      s22 += beta * (C12 * r11 + C11 * r22);
      s12 += beta * 2 * G * r12;
      // generalised hinge moments: Mh_j += A (t^2/6) (s11 B0j + s22 B1j + 2 s12 B2j)
      const qm = (A0[e] * t * t) / 6;
      const w12 = 2 * s12;
      if (h0 >= 0) hMh[h0] += qm * (s11 * triB[r] + s22 * triB[r + 3] + w12 * triB[r + 6]);
      if (h1 >= 0) hMh[h1] += qm * (s11 * triB[r + 1] + s22 * triB[r + 4] + w12 * triB[r + 7]);
      if (h2 >= 0) hMh[h2] += qm * (s11 * triB[r + 2] + s22 * triB[r + 5] + w12 * triB[r + 8]);
    }

    // ---------------- bending, pass 3: hinge forces ---------------------------
    for (let h = 0; h < H; h++) {
      const M = hMh[h];
      if (M === 0) continue;
      const q4 = 4 * h;
      const a = 3 * hIdx[q4], b = 3 * hIdx[q4 + 1], c = 3 * hIdx[q4 + 2], d = 3 * hIdx[q4 + 3];
      const t1 = 3 * hTri[2 * h], t2 = 3 * hTri[2 * h + 1];
      const n1x = triN[t1], n1y = triN[t1 + 1], n1z = triN[t1 + 2];
      const n2x = triN[t2], n2y = triN[t2 + 1], n2z = triN[t2 + 2];
      const xa = x[a], ya = x[a + 1], za = x[a + 2];
      const ex = x[b] - xa, ey = x[b + 1] - ya, ez = x[b + 2] - za;
      const le = Math.sqrt(ex * ex + ey * ey + ez * ez);
      const ile = 1 / le;
      // gradients of theta (Bridson et al. 2003; Wardetzky et al. 2007)
      const i1 = 1 / (n1x * n1x + n1y * n1y + n1z * n1z);
      const i2 = 1 / (n2x * n2x + n2y * n2y + n2z * n2z);
      const ca = ((x[c] - xa) * ex + (x[c + 1] - ya) * ey + (x[c + 2] - za) * ez) * ile;
      const da = ((x[d] - xa) * ex + (x[d + 1] - ya) * ey + (x[d + 2] - za) * ez) * ile;
      const cb = ca - le, db = da - le; // (c-b).e = (c-a).e - |e|
      // f = -M * dtheta/dx
      const wc = M * le * i1, wd = M * le * i2;          // tip c: +M le N1/|N1|^2
      const wa1 = M * cb * i1, wa2 = M * db * i2;        // node a: +M (cb N1/n1sq + db N2/n2sq)
      const wb1 = -M * ca * i1, wb2 = -M * da * i2;      // node b: -M (ca N1/n1sq + da N2/n2sq)
      f[c] += wc * n1x; f[c + 1] += wc * n1y; f[c + 2] += wc * n1z;
      f[d] += wd * n2x; f[d + 1] += wd * n2y; f[d + 2] += wd * n2z;
      f[a] += wa1 * n1x + wa2 * n2x; f[a + 1] += wa1 * n1y + wa2 * n2y; f[a + 2] += wa1 * n1z + wa2 * n2z;
      f[b] += wb1 * n1x + wb2 * n2x; f[b + 1] += wb1 * n1y + wb2 * n2y; f[b + 2] += wb1 * n1z + wb2 * n2z;
    }
    this.plasticWork += plasticW;

    // ---------------- rigid tool contact ------------------------------------
    this._toolContact();

    // ---------------- self contact ------------------------------------------
    if (this.selfContact) {
      if (this.travelSinceRebuild * 2 > this.scMargin) this._rebuildSelfContact(false);
      this._selfContactForces();
    }

  }

  _integrate() {
    const N = this.N, x = this.x, v = this.v, f = this.f, dt = this.dt;
    const invM = this.invM, mPhys = this.mPhys, g = this.gravity, ld = this.localDamping;
    let ke = 0, vmax2 = 0;
    const fixed = this.fixed; // optional hold-down mask (1 = node held in place)
    for (let i = 0; i < N; i++) {
      const p = 3 * i;
      if (fixed && fixed[i]) { v[p] = 0; v[p + 1] = 0; v[p + 2] = 0; continue; }
      let fx = f[p], fy = f[p + 1] + mPhys[i] * g, fz = f[p + 2];
      let vx = v[p], vy = v[p + 1], vz = v[p + 2];
      // Cundall local damping: oppose the out-of-balance force, not the motion
      fx -= ld * Math.abs(fx) * (vx > 0 ? 1 : vx < 0 ? -1 : 0);
      fy -= ld * Math.abs(fy) * (vy > 0 ? 1 : vy < 0 ? -1 : 0);
      fz -= ld * Math.abs(fz) * (vz > 0 ? 1 : vz < 0 ? -1 : 0);
      const im = invM[i] * dt;
      vx += fx * im; vy += fy * im; vz += fz * im;
      v[p] = vx; v[p + 1] = vy; v[p + 2] = vz;
      x[p] += vx * dt; x[p + 1] += vy * dt; x[p + 2] += vz * dt;
      const s2 = vx * vx + vy * vy + vz * vz;
      ke += mPhys[i] * s2;
      if (s2 > vmax2) vmax2 = s2;
    }
    this.kinetic = 0.5 * ke;
    this.maxSpeed = Math.sqrt(vmax2);
    this.travelSinceRebuild += this.maxSpeed * dt;
    for (const tool of this.tools) {
      tool.px += tool.vx * dt; tool.py += tool.vy * dt; tool.pz += tool.vz * dt;
    }
    this.time += dt;
    this.steps++;
  }

  _toolContact() {
    const N = this.N, x = this.x, v = this.v, f = this.f, m = this.m, dt = this.dt;
    const nodeThick = this.nodeThick;
    const kap = this.contactKappa, zeta = this.contactZeta;
    const invDt2 = 1 / (dt * dt);
    const n = new Float64Array(3);
    for (let ti = 0; ti < this.tools.length; ti++) {
      const tool = this.tools[ti];
      const fr = this.toolFric[ti];
      const ffx = fr.fx, ffy = fr.fy, ffz = fr.fz;
      const mu = tool.friction;
      let Fx = 0, Fy = 0, Fz = 0, count = 0;
      // every tool is referenced at its lowest point (py); the anvil plane is
      // a half-space y >= py. Nodes clearly away from the contact face are
      // rejected without evaluating the SDF.
      if (!tool.enabled) {
        if (tool.contactCount) { ffx.fill(0); ffy.fill(0); ffz.fill(0); }
        tool.fx = 0; tool.fy = 0; tool.fz = 0; tool.contactCount = 0;
        continue;
      }
      const isPlane = tool.kind === 'plane';
      const cull = isPlane || tool.fromAbove;
      const rot = !!tool.rotating;
      let Mres = 0;
      const tv = _tv;
      tv[0] = tool.vx; tv[1] = tool.vy; tv[2] = tool.vz;
      const yLim = tool.py + (isPlane ? 0.002 : -0.002 - tool.reachBelow);
      for (let i = 0; i < N; i++) {
        const p = 3 * i;
        const y = x[p + 1];
        if (cull && (isPlane ? y > yLim : y < yLim)) {
          if (ffx[i] !== 0 || ffy[i] !== 0 || ffz[i] !== 0) { ffx[i] = 0; ffy[i] = 0; ffz[i] = 0; }
          continue;
        }
        const off = 0.5 * nodeThick[i];
        const dist = tool.sdf(x[p], y, x[p + 2], n);
        const pen = off - dist;
        if (pen <= 0) {
          if (ffx[i] !== 0 || ffy[i] !== 0 || ffz[i] !== 0) { ffx[i] = 0; ffy[i] = 0; ffz[i] = 0; }
          continue;
        }
        const mi = m[i];
        const kc = kap * mi * invDt2;
        const cc = 2 * zeta * Math.sqrt(kap) * mi / dt;
        if (rot) tool.velocityAt(x[p], y, x[p + 2], tv);
        const rvx = v[p] - tv[0], rvy = v[p + 1] - tv[1], rvz = v[p + 2] - tv[2];
        const vn = rvx * n[0] + rvy * n[1] + rvz * n[2];
        let fn = kc * pen - cc * vn;
        if (fn < 0) fn = 0;
        // friction: incremental elastic stick + Coulomb cap
        const vtx = rvx - vn * n[0], vty = rvy - vn * n[1], vtz = rvz - vn * n[2];
        let tx = ffx[i] - kc * vtx * dt, ty = ffy[i] - kc * vty * dt, tz = ffz[i] - kc * vtz * dt;
        const tdn = tx * n[0] + ty * n[1] + tz * n[2];
        tx -= tdn * n[0]; ty -= tdn * n[1]; tz -= tdn * n[2];
        const tmag = Math.sqrt(tx * tx + ty * ty + tz * tz);
        const tmax = mu * fn;
        if (tmag > tmax && tmag > 0) { const s = tmax / tmag; tx *= s; ty *= s; tz *= s; }
        ffx[i] = tx; ffy[i] = ty; ffz[i] = tz;
        const cx = fn * n[0] + tx, cy = fn * n[1] + ty, cz = fn * n[2] + tz;
        f[p] += cx; f[p + 1] += cy; f[p + 2] += cz;
        Fx -= cx; Fy -= cy; Fz -= cz;
        if (rot) Mres += (y - tool.py) * cz - (x[p + 2] - tool.pz) * cy;
        count++;
      }
      // Extra sample points (edge midpoints and triangle centres) for shaped
      // tools, so a thin plate edge, a narrow bar or the press rod cannot slip
      // between the nodes of the 3-4 mm mesh. Normal force only.
      if (!isPlane && tool.kind !== 'wall') {
        const hIdx = this.hIdx, H = this.H, tris = this.tris, T = this.T;
        for (let pass = 0; pass < 2; pass++) {
          const M = pass === 0 ? H : T;
          const k = pass === 0 ? 2 : 3;
          const w = 1 / k;
          for (let s = 0; s < M; s++) {
            const i0 = pass === 0 ? hIdx[4 * s] : tris[3 * s];
            const i1 = pass === 0 ? hIdx[4 * s + 1] : tris[3 * s + 1];
            const i2 = pass === 0 ? i1 : tris[3 * s + 2];
            const a = 3 * i0, b = 3 * i1, c = 3 * i2;
            const sy = pass === 0 ? 0.5 * (x[a + 1] + x[b + 1]) : (x[a + 1] + x[b + 1] + x[c + 1]) / 3;
            if (cull && sy < yLim) continue;
            const sx = pass === 0 ? 0.5 * (x[a] + x[b]) : (x[a] + x[b] + x[c]) / 3;
            const sz = pass === 0 ? 0.5 * (x[a + 2] + x[b + 2]) : (x[a + 2] + x[b + 2] + x[c + 2]) / 3;
            const off = pass === 0 ? 0.25 * (nodeThick[i0] + nodeThick[i1]) : (nodeThick[i0] + nodeThick[i1] + nodeThick[i2]) / 6;
            const dist = tool.sdf(sx, sy, sz, n);
            const pen = off - dist;
            if (pen <= 0) continue;
            const ms = pass === 0 ? 0.5 * (m[i0] + m[i1]) : (m[i0] + m[i1] + m[i2]) / 3;
            const kc = kap * ms * invDt2 * w;
            const cc = 2 * zeta * Math.sqrt(kap) * ms * w / dt;
            if (rot) tool.velocityAt(sx, sy, sz, tv);
            let vn;
            if (pass === 0) vn = (0.5 * (v[a] + v[b]) - tv[0]) * n[0] + (0.5 * (v[a + 1] + v[b + 1]) - tv[1]) * n[1] + (0.5 * (v[a + 2] + v[b + 2]) - tv[2]) * n[2];
            else vn = ((v[a] + v[b] + v[c]) / 3 - tv[0]) * n[0] + ((v[a + 1] + v[b + 1] + v[c + 1]) / 3 - tv[1]) * n[1] + ((v[a + 2] + v[b + 2] + v[c + 2]) / 3 - tv[2]) * n[2];
            let fn = kc * pen - cc * vn;
            if (fn <= 0) continue;
            const fx = fn * n[0] * w, fy = fn * n[1] * w, fz = fn * n[2] * w;
            f[a] += fx; f[a + 1] += fy; f[a + 2] += fz;
            f[b] += fx; f[b + 1] += fy; f[b + 2] += fz;
            if (pass === 1) { f[c] += fx; f[c + 1] += fy; f[c + 2] += fz; }
            Fx -= fn * n[0]; Fy -= fn * n[1]; Fz -= fn * n[2];
            if (rot) Mres += (sy - tool.py) * fn * n[2] - (sz - tool.pz) * fn * n[1];
          }
        }
      }
      tool.fx = Fx; tool.fy = Fy; tool.fz = Fz; tool.contactCount = count;
      if (rot) tool.mres = Mres;
    }
  }

  // ---------------- self contact ---------------------------------------------
  _rebuildSelfContact(atRest) {
    const N = this.N, T = this.T, x = this.x, tris = this.tris;
    const r = this.hc + this.scMargin;
    const cs = this.cellSize, inv = 1 / cs;
    // count insertions
    const tableBits = Math.ceil(Math.log2(Math.max(1024, T * 8)));
    const tsize = 1 << tableBits, mask = tsize - 1;
    if (!this._hashCount || this._hashCount.length !== tsize + 1) {
      this._hashCount = new Int32Array(tsize + 1);
    }
    const cnt = this._hashCount;
    cnt.fill(0);
    const box = this._triBox || (this._triBox = new Int32Array(6 * T));
    let total = 0;
    for (let e = 0; e < T; e++) {
      const a = 3 * tris[3 * e], b = 3 * tris[3 * e + 1], c = 3 * tris[3 * e + 2];
      const x0 = Math.floor((Math.min(x[a], x[b], x[c]) - r) * inv), x1 = Math.floor((Math.max(x[a], x[b], x[c]) + r) * inv);
      const y0 = Math.floor((Math.min(x[a + 1], x[b + 1], x[c + 1]) - r) * inv), y1 = Math.floor((Math.max(x[a + 1], x[b + 1], x[c + 1]) + r) * inv);
      const z0 = Math.floor((Math.min(x[a + 2], x[b + 2], x[c + 2]) - r) * inv), z1 = Math.floor((Math.max(x[a + 2], x[b + 2], x[c + 2]) + r) * inv);
      box[6 * e] = x0; box[6 * e + 1] = x1; box[6 * e + 2] = y0; box[6 * e + 3] = y1; box[6 * e + 4] = z0; box[6 * e + 5] = z1;
      for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) for (let iz = z0; iz <= z1; iz++) {
        cnt[((Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & mask) + 1]++;
        total++;
      }
    }
    for (let i = 1; i <= tsize; i++) cnt[i] += cnt[i - 1];
    if (!this._hashEnt || this._hashEnt.length < total) this._hashEnt = new Int32Array(Math.ceil(total * 1.3));
    const ent = this._hashEnt;
    const fill = this._hashFill || (this._hashFill = new Int32Array(tsize));
    if (fill.length !== tsize) this._hashFill = new Int32Array(tsize);
    const fl = this._hashFill;
    for (let i = 0; i < tsize; i++) fl[i] = cnt[i];
    for (let e = 0; e < T; e++) {
      const x0 = box[6 * e], x1 = box[6 * e + 1], y0 = box[6 * e + 2], y1 = box[6 * e + 3], z0 = box[6 * e + 4], z1 = box[6 * e + 5];
      for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) for (let iz = z0; iz <= z1; iz++) {
        const hsh = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & mask;
        ent[fl[hsh]++] = e;
      }
    }
    // query nodes
    const stamp = this.triStamp;
    stamp.fill(-1);
    let np = 0;
    const cp = this._cp || (this._cp = new Float64Array(4));
    for (let i = 0; i < N; i++) {
      const p = 3 * i;
      const px = x[p], py = x[p + 1], pz = x[p + 2];
      const ix = Math.floor(px * inv), iy = Math.floor(py * inv), iz = Math.floor(pz * inv);
      const hsh = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & mask;
      for (let s = cnt[hsh], s1 = cnt[hsh + 1]; s < s1; s++) {
        const e = ent[s];
        if (stamp[e] === i) continue;
        stamp[e] = i;
        const ta = tris[3 * e], tb = tris[3 * e + 1], tc = tris[3 * e + 2];
        if (ta === i || tb === i || tc === i) continue;
        if (ix < box[6 * e] || ix > box[6 * e + 1] || iy < box[6 * e + 2] || iy > box[6 * e + 3] || iz < box[6 * e + 4] || iz > box[6 * e + 5]) continue;
        const d2 = closestPointTri(px, py, pz, x, 3 * ta, 3 * tb, 3 * tc, cp);
        if (d2 > r * r) continue;
        const key = i * T + e;
        if (atRest) {
          if (d2 < (this.hc * 1.05) ** 2) this.excluded.add(key);
          continue;
        }
        if (this.excluded.size && this.excluded.has(key)) continue;
        if (np >= this.pairNode.length) {
          // grow pair buffers
          const nn = new Int32Array(this.pairNode.length * 2), nt = new Int32Array(this.pairNode.length * 2);
          nn.set(this.pairNode); nt.set(this.pairTri);
          this.pairNode = nn; this.pairTri = nt;
        }
        this.pairNode[np] = i; this.pairTri[np] = e; np++;
      }
    }
    this._finishRebuild(np);
  }

  _finishRebuild(np) {
    this.nPairs = np;
    this.travelSinceRebuild = 0;
  }

  _selfContactForces() {
    const x = this.x, v = this.v, f = this.f, m = this.m, tris = this.tris;
    const hc = this.hc, dt = this.dt;
    const kap = 0.1, zeta = 0.3;
    const invDt2 = 1 / (dt * dt);
    const cp = this._cp;
    const pn = this.pairNode, pt = this.pairTri, triN = this.triN;
    let total = 0;
    for (let k = 0; k < this.nPairs; k++) {
      const i = pn[k], e = pt[k];
      const p = 3 * i;
      const a = 3 * tris[3 * e], b = 3 * tris[3 * e + 1], c = 3 * tris[3 * e + 2];
      const d2 = closestPointTri(x[p], x[p + 1], x[p + 2], x, a, b, c, cp);
      if (d2 >= hc * hc) continue;
      const wa = cp[1], wb = cp[2], wc = cp[3];
      const qx = wa * x[a] + wb * x[b] + wc * x[c];
      const qy = wa * x[a + 1] + wb * x[b + 1] + wc * x[c + 1];
      const qz = wa * x[a + 2] + wb * x[b + 2] + wc * x[c + 2];
      let nx = x[p] - qx, ny = x[p + 1] - qy, nz = x[p + 2] - qz;
      let dist = Math.sqrt(d2);
      if (dist > 1e-9) { nx /= dist; ny /= dist; nz /= dist; }
      else {
        const t3 = 3 * e;
        const l = Math.hypot(triN[t3], triN[t3 + 1], triN[t3 + 2]);
        nx = triN[t3] / l; ny = triN[t3 + 1] / l; nz = triN[t3 + 2] / l;
        dist = 0;
      }
      const pen = hc - dist;
      const mt = (m[a / 3] * wa + m[b / 3] * wb + m[c / 3] * wc);
      const meff = Math.min(m[i], mt);
      const kc = kap * meff * invDt2;
      const cc = 2 * zeta * Math.sqrt(kap) * meff / dt;
      const rvx = v[p] - (wa * v[a] + wb * v[b] + wc * v[c]);
      const rvy = v[p + 1] - (wa * v[a + 1] + wb * v[b + 1] + wc * v[c + 1]);
      const rvz = v[p + 2] - (wa * v[a + 2] + wb * v[b + 2] + wc * v[c + 2]);
      const vn = rvx * nx + rvy * ny + rvz * nz;
      let fn = kc * pen - cc * vn;
      if (fn <= 0) continue;
      // mild regularised friction between folds
      const vtx = rvx - vn * nx, vty = rvy - vn * ny, vtz = rvz - vn * nz;
      const vt = Math.sqrt(vtx * vtx + vty * vty + vtz * vtz);
      let fx = fn * nx, fy = fn * ny, fz = fn * nz;
      if (vt > 1e-9) {
        const ft = 0.2 * fn * Math.min(1, vt / 0.02) / vt;
        fx -= ft * vtx; fy -= ft * vty; fz -= ft * vtz;
      }
      f[p] += fx; f[p + 1] += fy; f[p + 2] += fz;
      f[a] -= wa * fx; f[a + 1] -= wa * fy; f[a + 2] -= wa * fz;
      f[b] -= wb * fx; f[b + 1] -= wb * fy; f[b + 2] -= wb * fz;
      f[c] -= wc * fx; f[c + 1] -= wc * fy; f[c + 2] -= wc * fz;
      total += fn;
    }
    this.scForceTotal = total;
  }

  // ---------------- diagnostics ----------------------------------------------
  /** Per-node equivalent plastic strain (max of membrane and outer-fibre bending). */
  nodePlasticStrain(out) {
    const N = this.N, T = this.T;
    const acc = out || new Float32Array(N);
    acc.fill(0);
    const tris = this.tris;
    for (let e = 0; e < T; e++) {
      const a = Math.max(this.alpha[e], this.alphaB[e]);
      if (a <= 0) continue;
      for (let k = 0; k < 3; k++) { const i = tris[3 * e + k]; if (a > acc[i]) acc[i] = a; }
    }
    return acc;
  }

  /** Elastic strain energy (membrane + bending) at the current positions (J). */
  elasticEnergy() {
    this._computeHingeAngles(false);
    const x = this.x, tris = this.tris;
    let W = 0;
    for (let e = 0; e < this.T; e++) {
      const i0 = 3 * tris[3 * e], i1 = 3 * tris[3 * e + 1], i2 = 3 * tris[3 * e + 2];
      const q = 4 * e, D00 = this.DmInv[q], D01 = this.DmInv[q + 1], D11 = this.DmInv[q + 3];
      const d1 = [x[i1] - x[i0], x[i1 + 1] - x[i0 + 1], x[i1 + 2] - x[i0 + 2]];
      const d2 = [x[i2] - x[i0], x[i2 + 1] - x[i0 + 1], x[i2 + 2] - x[i0 + 2]];
      const f0 = d1.map((v) => v * D00), f1 = d1.map((v, k) => v * D01 + d2[k] * D11);
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const e11 = 0.5 * (dot(f0, f0) - 1) - this.Ep[3 * e];
      const e22 = 0.5 * (dot(f1, f1) - 1) - this.Ep[3 * e + 1];
      const e12 = 0.5 * dot(f0, f1) - this.Ep[3 * e + 2];
      const m = this.mats[this.mat[e]];
      W += 0.5 * this.A0[e] * this.thick[e] * (m.C11 * (e11 * e11 + e22 * e22) + 2 * m.C12 * e11 * e22 + 4 * m.G * e12 * e12);
    }
    return W + this.bendingEnergy();
  }

  /** Bending curvature-change energy (J) - diagnostic. */
  bendingEnergy() {
    let W = 0;
    for (let e = 0; e < this.T; e++) {
      const r = 9 * e, p3 = 3 * e;
      const d = [0, 1, 2].map((k) => { const h = this.triHinge[p3 + k]; return h >= 0 ? this.hTheta[h] - this.hTheta0[h] : 0; });
      const B = this.triB;
      const k11 = B[r] * d[0] + B[r + 1] * d[1] + B[r + 2] * d[2];
      const k22 = B[r + 3] * d[0] + B[r + 4] * d[1] + B[r + 5] * d[2];
      const k12 = B[r + 6] * d[0] + B[r + 7] * d[1] + B[r + 8] * d[2];
      const m = this.mats[this.mat[e]];
      const t = this.thick[e];
      W += 0.5 * this.A0[e] * (t * t * t / 12) * (m.C11 * (k11 * k11 + k22 * k22) + 2 * m.C12 * k11 * k22 + 4 * m.G * k12 * k12);
    }
    return W;
  }
}

const _tv = new Float64Array(3);

/**
 * Squared distance from point p to triangle (a,b,c) (offsets into x).
 * Writes barycentric weights into out[1..3].
 * (Ericson, Real-Time Collision Detection, 5.1.5)
 */
export function closestPointTri(px, py, pz, x, a, b, c, out) {
  const ax = x[a], ay = x[a + 1], az = x[a + 2];
  const abx = x[b] - ax, aby = x[b + 1] - ay, abz = x[b + 2] - az;
  const acx = x[c] - ax, acy = x[c + 1] - ay, acz = x[c + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let u, vv, w;
  if (d1 <= 0 && d2 <= 0) { u = 1; vv = 0; w = 0; }
  else {
    const bpx = px - x[b], bpy = py - x[b + 1], bpz = pz - x[b + 2];
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { u = 0; vv = 1; w = 0; }
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const t = d1 / (d1 - d3); u = 1 - t; vv = t; w = 0; }
      else {
        const cpx = px - x[c], cpy = py - x[c + 1], cpz = pz - x[c + 2];
        const d5 = abx * cpx + aby * cpy + abz * cpz;
        const d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { u = 0; vv = 0; w = 1; }
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); u = 1 - t; vv = 0; w = t; }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const t = (d4 - d3) / ((d4 - d3) + (d5 - d6)); u = 0; vv = 1 - t; w = t;
            } else {
              const den = 1 / (va + vb + vc);
              vv = vb * den; w = vc * den; u = 1 - vv - w;
            }
          }
        }
      }
    }
  }
  const qx = u * ax + vv * x[b] + w * x[c];
  const qy = u * ay + vv * x[b + 1] + w * x[c + 1];
  const qz = u * az + vv * x[b + 2] + w * x[c + 2];
  out[1] = u; out[2] = vv; out[3] = w;
  const dx = px - qx, dy = py - qy, dz = pz - qz;
  return dx * dx + dy * dy + dz * dz;
}
