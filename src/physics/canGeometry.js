// Can geometry: axisymmetric profile of a two-piece aluminum beverage can and
// a near-equilateral triangle mesh of the closed surface (base dome + body +
// neck + double seam + lid). All lengths in this module are in METERS unless a
// name ends in "Mm".

// Dimensions are typical measured values for North-American / European cans.
// Wall gauges: the ironed side wall is the thinnest part (~0.1 mm); the top
// wall is left thicker so it can be necked and flanged; the base is close to
// the starting sheet gauge; the lid (end) is a stiffer 5182 alloy.
export const CAN_PRESETS = {
  std355: {
    label: '12 oz / 355 mL standard',
    R: 33.0, H: 122.2, Rn: 27.2, standR: 25.2, domeDepth: 10.0,
    wall: 0.097, topWall: 0.150, base: 0.270, lid: 0.215, seam: 0.70,
  },
  tall473: {
    label: '16 oz / 473 mL tall',
    R: 33.0, H: 157.0, Rn: 27.2, standR: 25.2, domeDepth: 10.0,
    wall: 0.100, topWall: 0.155, base: 0.275, lid: 0.215, seam: 0.70,
  },
  sleek355: {
    label: '12 oz / 355 mL sleek',
    R: 29.1, H: 146.0, Rn: 25.0, standR: 22.0, domeDepth: 9.0,
    wall: 0.095, topWall: 0.145, base: 0.265, lid: 0.210, seam: 0.65,
  },
  slim250: {
    label: '8.4 oz / 250 mL slim',
    R: 26.5, H: 134.5, Rn: 25.0, standR: 20.2, domeDepth: 8.5,
    wall: 0.095, topWall: 0.145, base: 0.265, lid: 0.210, seam: 0.65,
  },
};

export const MAT_BODY = 0;
export const MAT_LID = 1;

// --- small curve helpers (2D points as [r, z] in mm) -----------------------
function bezier3(p0, p1, p2, p3, u) {
  const v = 1 - u;
  const a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}
function lerp2(p0, p1, u) {
  return [p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u];
}
const smooth = (u) => u * u * (3 - 2 * u);

/**
 * Build the meridian profile as a dense polyline from the base centre to the
 * lid centre. Each point: { r, z, t, mat } with r, z, t in mm.
 */
export function buildProfileMm(spec) {
  const { R, H, Rn, standR, domeDepth, wall, topWall, base, lid, seam } = spec;
  const segs = [];
  // thickness helpers
  const tBodyAt = (z) => {
    // base -> wall transition just above the bottom shoulder, wall, then the
    // thicker top wall below the neck.
    const zb = 0.33 * R;
    const zTop0 = H - 30, zTop1 = H - 22;
    if (z < zb) return base;
    if (z < zb + 6) return base + (wall - base) * smooth((z - zb) / 6);
    if (z < zTop0) return wall;
    if (z < zTop1) return wall + (topWall - wall) * smooth((z - zTop0) / (zTop1 - zTop0));
    return topWall;
  };

  // 1. Base dome: spherical cap from centre (0, domeDepth) to dome edge.
  const rdE = standR - 2.6, zdE = 3.0;
  const hCap = domeDepth - zdE;
  const Rs = (rdE * rdE + hCap * hCap) / (2 * hCap);
  const angE = Math.asin(rdE / Rs);
  segs.push({ n: 120, mat: MAT_BODY, f: (u) => {
    const a = u * angE;
    return { p: [Rs * Math.sin(a), domeDepth - Rs * (1 - Math.cos(a))], t: base };
  } });
  // 2. Inner wall of the stand bead, down to the stand ring (z = 0).
  const pB0 = [rdE, zdE], pB3 = [standR + 0.3, 0.0];
  segs.push({ n: 40, mat: MAT_BODY, f: (u) => ({ p: bezier3(pB0, [rdE + 0.9, zdE - 1.6], [standR - 0.9, 0.0], pB3, u), t: base }) });
  // 3. Outer bottom profile: stand ring up and out to the body radius.
  const zb = 0.33 * R;
  const pO3 = [R, zb];
  segs.push({ n: 80, mat: MAT_BODY, f: (u) => {
    // the heel rises steeply (~45 deg) from the stand ring, then turns vertical
    const p = bezier3(pB3, [standR + 1.6, 1.4], [R - 0.4, zb - 4.5], pO3, u);
    return { p, t: tBodyAt(p[1]) };
  } });
  // 4. Straight body.
  const zN0 = H - 20.0;
  segs.push({ n: 400, mat: MAT_BODY, f: (u) => {
    const p = lerp2(pO3, [R, zN0], u);
    return { p, t: tBodyAt(p[1]) };
  } });
  // 5. Neck (die-necked taper) down to the seam radius.
  const zN1 = H - 6.5;
  segs.push({ n: 80, mat: MAT_BODY, f: (u) => ({ p: bezier3([R, zN0], [R, zN0 + 5.0], [Rn, zN1 - 4.0], [Rn, zN1], u), t: topWall }) });
  segs.push({ n: 10, mat: MAT_BODY, f: (u) => ({ p: lerp2([Rn, zN1], [Rn, H - 5.2], u), t: topWall }) });
  // 6. Double seam: a compact multi-layer ring (modelled as one thick band).
  const seamPts = [[Rn, H - 5.2], [Rn + 1.4, H - 4.2], [Rn + 1.4, H - 0.6], [Rn + 0.8, H], [Rn - 1.2, H]];
  for (let k = 0; k < seamPts.length - 1; k++) {
    const a = seamPts[k], b = seamPts[k + 1];
    segs.push({ n: 12, mat: MAT_BODY, f: (u) => ({ p: lerp2(a, b, u), t: k === 0 ? topWall + (seam - topWall) * smooth(u) : seam }) });
  }
  // 7. Lid: chuck wall down into the countersink, then the centre panel.
  const pL0 = [Rn - 1.2, H], pL1 = [Rn - 2.7, H - 4.8];
  segs.push({ n: 20, mat: MAT_LID, f: (u) => ({ p: lerp2(pL0, pL1, u), t: seam + (lid - seam) * smooth(Math.min(1, u * 2.5)) }) });
  const panelR = pL1[0];
  segs.push({ n: 80, mat: MAT_LID, f: (u) => {
    const r = panelR * (1 - u);
    // shallow panel dome (about 0.6 mm)
    const z = (H - 4.8) + 0.6 * (1 - (r / panelR) ** 2);
    return { p: [r, z], t: lid };
  } });

  const pts = [];
  for (let s = 0; s < segs.length; s++) {
    const seg = segs[s];
    for (let i = (s === 0 ? 0 : 1); i <= seg.n; i++) {
      const { p, t } = seg.f(i / seg.n);
      pts.push({ r: Math.max(0, p[0]), z: p[1], t, mat: seg.mat });
    }
  }
  pts[pts.length - 1].r = 0;
  return pts;
}

/** Resample a dense profile at (approximately) uniform arc length ds (mm). */
function resampleProfile(pts, ds) {
  const L = [0];
  for (let i = 1; i < pts.length; i++) {
    L.push(L[i - 1] + Math.hypot(pts[i].r - pts[i - 1].r, pts[i].z - pts[i - 1].z));
  }
  const total = L[L.length - 1];
  const n = Math.max(4, Math.round(total / ds));
  const out = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const s = (total * k) / n;
    while (j < pts.length - 2 && L[j + 1] < s) j++;
    const u = (s - L[j]) / Math.max(1e-12, L[j + 1] - L[j]);
    const a = pts[j], b = pts[j + 1];
    out.push({
      r: a.r + (b.r - a.r) * u,
      z: a.z + (b.z - a.z) * u,
      t: a.t + (b.t - a.t) * u,
      mat: u < 0.5 ? a.mat : b.mat,
      s,
    });
  }
  out[0].r = 0;
  out[out.length - 1].r = 0;
  return { rings: out, length: total };
}

// Deterministic PRNG (mulberry32) so imperfections are reproducible.
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate the triangulated can surface.
 * @param {object} opts
 *   preset: key of CAN_PRESETS, or a spec object
 *   overrides: partial spec (mm) to override preset values
 *   nTheta: nodes around the body circumference (resolution)
 *   imperfection: amplitude (mm) of random low-order radial waviness
 *   seed: PRNG seed
 *   dent: { depth (mm, inward), heightFrac (0..1 of body), azimuthDeg, width (mm) }
 * @returns mesh object (meters)
 */
export function buildCanMesh(opts = {}) {
  const base = typeof opts.preset === 'object' ? opts.preset : CAN_PRESETS[opts.preset || 'std355'];
  const spec = { ...base, ...(opts.overrides || {}) };
  const nTheta = opts.nTheta || 64;
  const sCirc = (2 * Math.PI * spec.R) / nTheta; // circumferential spacing (mm)
  const ds = sCirc * Math.sqrt(3) / 2;             // ring spacing for equilateral tris

  const profile = buildProfileMm(spec);
  const { rings } = resampleProfile(profile, ds);

  // ring node counts
  // Keep a structured mesh (nTheta nodes per ring) everywhere the load path
  // runs (bottom profile, body, neck, seam); only the base dome and the lid
  // panel are graded towards their centres.
  const rCut = Math.min(spec.standR - 2.6, 0.82 * spec.Rn - 1.5);
  const ringInfo = [];
  let phase = 0;
  for (let i = 0; i < rings.length; i++) {
    const rg = rings[i];
    let n;
    if (rg.r < 1e-6) n = 1;
    else if (rg.r >= rCut) n = nTheta;
    else n = Math.max(6, Math.round((nTheta * rg.r) / rCut));
    phase += Math.PI / Math.max(n, 6);
    ringInfo.push({ ...rg, n, phase });
  }

  // nodes
  const nodeList = [];
  const ringStart = [];
  for (const rg of ringInfo) {
    ringStart.push(nodeList.length);
    for (let j = 0; j < rg.n; j++) {
      const th = rg.n === 1 ? 0 : rg.phase + (2 * Math.PI * j) / rg.n;
      nodeList.push({ r: rg.r, th, z: rg.z, t: rg.t, mat: rg.mat, s: rg.s });
    }
  }

  // triangles via zipper between consecutive rings (outward CCW orientation)
  const tris = [];
  for (let i = 0; i < ringInfo.length - 1; i++) {
    const A = ringInfo[i], B = ringInfo[i + 1];
    const a0 = ringStart[i], b0 = ringStart[i + 1];
    const nA = A.n, nB = B.n;
    if (nA === 1) {
      for (let k = 0; k < nB; k++) tris.push(a0, b0 + ((k + 1) % nB), b0 + k);
      continue;
    }
    if (nB === 1) {
      for (let j = 0; j < nA; j++) tris.push(a0 + j, a0 + ((j + 1) % nA), b0);
      continue;
    }
    const angA = (j) => A.phase + (2 * Math.PI * j) / nA;
    // B index whose angle is closest to (and not after) angA(0)
    let kStart = Math.floor(((angA(0) - B.phase) / (2 * Math.PI)) * nB);
    let bBase = B.phase + (2 * Math.PI * kStart) / nB;
    while (bBase > angA(0)) { kStart--; bBase -= (2 * Math.PI) / nB; }
    const angB = (m) => bBase + (2 * Math.PI * m) / nB;
    const idxA = (j) => a0 + (((j % nA) + nA) % nA);
    const idxB = (m) => b0 + ((((kStart + m) % nB) + nB) % nB);
    let ia = 0, ib = 0;
    while (ia < nA || ib < nB) {
      const nextA = angA(ia + 1), nextB = angB(ib + 1);
      if (ib >= nB || (ia < nA && nextA <= nextB)) {
        tris.push(idxA(ia), idxA(ia + 1), idxB(ib));
        ia++;
      } else {
        tris.push(idxA(ia), idxB(ib + 1), idxB(ib));
        ib++;
      }
    }
  }

  // --- imperfections (stress-free initial geometry) ---------------------
  const N = nodeList.length;
  const X = new Float64Array(3 * N);
  const zb = 0.33 * spec.R, zN0 = spec.H - 20.0;
  const modes = [];
  const amp = opts.imperfection ?? 0.08;
  if (amp > 0) {
    const rng = makeRng(opts.seed ?? 1);
    // Broad spectrum down to buckling-relevant wavelengths (~6-13 mm): thin
    // cylinders are imperfection sensitive only to imperfections that resemble
    // their short-wave buckling modes.
    for (let m = 1; m <= 14; m++) {
      for (let n = 0; n <= 16; n++) {
        modes.push({ m, n, c: (rng() * 2 - 1) / (1 + 0.08 * (m + n)), ph: rng() * 2 * Math.PI });
      }
    }
    // also a few localized random bumps (real cans have local dings)
    for (let k = 0; k < 4; k++) {
      modes.push({ bump: true, th: rng() * 2 * Math.PI, z: zb + rng() * (zN0 - zb), w: 4 + rng() * 6, c: (rng() * 2 - 1) * 1.0 });
    }
  }
  const imperf = (th, z) => {
    if (z <= zb || z >= zN0) return 0;
    const u = (z - zb) / (zN0 - zb);
    let d = 0;
    for (const md of modes) {
      if (md.bump) {
        let dth = Math.atan2(Math.sin(th - md.th), Math.cos(th - md.th));
        const dx = dth * spec.R, dz = z - md.z;
        d += md.c * Math.exp(-(dx * dx + dz * dz) / (2 * md.w * md.w));
      } else {
        d += md.c * Math.sin(md.m * Math.PI * u) * Math.cos(md.n * th + md.ph);
      }
    }
    return d;
  };
  // normalise so the max |imperfection| equals amp
  let maxImp = 0;
  if (amp > 0) {
    for (const nd of nodeList) maxImp = Math.max(maxImp, Math.abs(imperf(nd.th, nd.z)));
  }
  const impScale = maxImp > 0 ? amp / maxImp : 0;

  const dent = opts.dent && opts.dent.depth > 0 ? opts.dent : null;
  const dentZ = dent ? zb + (zN0 - zb) * (dent.heightFrac ?? 0.5) : 0;
  const dentTh = dent ? ((dent.azimuthDeg ?? 0) * Math.PI) / 180 : 0;
  const dentW = dent ? (dent.width ?? 8) : 1;

  const nodeThick = new Float64Array(N);
  const nodeMat = new Uint8Array(N);
  const uv = new Float32Array(2 * N);
  const H = spec.H;
  for (let i = 0; i < N; i++) {
    const nd = nodeList[i];
    let r = nd.r;
    if (nd.r >= spec.R - 1e-6) {
      r += impScale * imperf(nd.th, nd.z);
      if (dent) {
        const dth = Math.atan2(Math.sin(nd.th - dentTh), Math.cos(nd.th - dentTh));
        const dx = dth * spec.R, dz = nd.z - dentZ;
        r -= dent.depth * Math.exp(-(dx * dx + dz * dz) / (2 * dentW * dentW));
      }
    }
    X[3 * i] = (r * Math.cos(nd.th)) / 1000;
    X[3 * i + 1] = (r * Math.sin(nd.th)) / 1000;
    X[3 * i + 2] = nd.z / 1000;
    nodeThick[i] = nd.t / 1000;
    nodeMat[i] = nd.mat;
    // texture coords: u around, v by height (body); lid/base map to v ends
    uv[2 * i] = (((nd.th / (2 * Math.PI)) % 1) + 1) % 1;
    uv[2 * i + 1] = nd.z / H;
  }

  const T = tris.length / 3;
  const triIdx = new Int32Array(tris);
  const triThick = new Float64Array(T);
  const triMat = new Uint8Array(T);
  for (let e = 0; e < T; e++) {
    const a = triIdx[3 * e], b = triIdx[3 * e + 1], c = triIdx[3 * e + 2];
    triThick[e] = (nodeThick[a] + nodeThick[b] + nodeThick[c]) / 3;
    triMat[e] = nodeMat[a] + nodeMat[b] + nodeMat[c] >= 2 ? MAT_LID : MAT_BODY;
  }

  const mesh = {
    spec, nTheta, X, tris: triIdx, nodeThick, triThick, triMat, uv,
    nodeTheta: Float32Array.from(nodeList, (n) => n.th),
    nodeZ0: Float32Array.from(nodeList, (n) => n.z / 1000),
    ringStart, ringCount: ringInfo.map((r) => r.n),
    meanEdge: sCirc / 1000,
  };
  // sanity: outward orientation => positive volume
  if (meshVolume(X, triIdx) < 0) {
    for (let e = 0; e < T; e++) {
      const tmp = triIdx[3 * e + 1]; triIdx[3 * e + 1] = triIdx[3 * e + 2]; triIdx[3 * e + 2] = tmp;
    }
  }
  return mesh;
}

/** Enclosed volume of a closed, outward-oriented triangle mesh (m^3). */
export function meshVolume(X, tris) {
  let v = 0;
  for (let e = 0; e < tris.length; e += 3) {
    const a = 3 * tris[e], b = 3 * tris[e + 1], c = 3 * tris[e + 2];
    v += X[a] * (X[b + 1] * X[c + 2] - X[b + 2] * X[c + 1])
       - X[a + 1] * (X[b] * X[c + 2] - X[b + 2] * X[c])
       + X[a + 2] * (X[b] * X[c + 1] - X[b + 1] * X[c]);
  }
  return v / 6;
}

/** Build the unique-edge (hinge) list. Each interior edge appears once. */
export function buildHinges(tris, nNodes) {
  const T = tris.length / 3;
  const map = new Map();
  const hinges = [];
  for (let e = 0; e < T; e++) {
    for (let k = 0; k < 3; k++) {
      const a = tris[3 * e + k], b = tris[3 * e + ((k + 1) % 3)], c = tris[3 * e + ((k + 2) % 3)];
      const key = a < b ? a * nNodes + b : b * nNodes + a;
      const other = map.get(key);
      if (other === undefined) {
        map.set(key, { a, b, c, t: e });
      } else {
        // other has (a', b') = (b, a) for consistent orientation
        hinges.push({ a: other.a, b: other.b, c: other.c, d: c, t1: other.t, t2: e });
        map.delete(key);
      }
    }
  }
  return { hinges, boundary: [...map.values()] };
}

/**
 * Open circular tube (no ends) with the same staggered equilateral meshing as
 * the can body. Used for validation against closed-form ring/shell solutions.
 * R, L, t in metres; axis along +z from 0 to L.
 */
export function buildTubeMesh({ R, L, t, nTheta = 48, mat = MAT_BODY }) {
  const s = (2 * Math.PI * R) / nTheta;
  const ds = (s * Math.sqrt(3)) / 2;
  const nz = Math.max(2, Math.round(L / ds));
  const X = new Float64Array(3 * nTheta * (nz + 1));
  for (let k = 0; k <= nz; k++) {
    const ph = (k % 2) * (Math.PI / nTheta);
    for (let j = 0; j < nTheta; j++) {
      const th = ph + (2 * Math.PI * j) / nTheta;
      const i = k * nTheta + j;
      X[3 * i] = R * Math.cos(th); X[3 * i + 1] = R * Math.sin(th); X[3 * i + 2] = (L * k) / nz;
    }
  }
  const tris = [];
  for (let k = 0; k < nz; k++) {
    const a0 = k * nTheta, b0 = (k + 1) * nTheta;
    for (let j = 0; j < nTheta; j++) {
      const j1 = (j + 1) % nTheta;
      if (k % 2 === 0) {
        // ring k at phase 0, ring k+1 shifted by +half step
        tris.push(a0 + j, a0 + j1, b0 + j);
        tris.push(a0 + j1, b0 + j1, b0 + j);
      } else {
        tris.push(a0 + j, a0 + j1, b0 + j1);
        tris.push(a0 + j, b0 + j1, b0 + j);
      }
    }
  }
  const T = tris.length / 3;
  const N = X.length / 3;
  return {
    spec: { R: R * 1000, H: L * 1000 },
    X, tris: Int32Array.from(tris),
    nodeThick: new Float64Array(N).fill(t),
    triThick: new Float64Array(T).fill(t),
    triMat: new Uint8Array(T).fill(mat),
    uv: new Float32Array(2 * N),
    meanEdge: s,
  };
}
