// Material models for can-stock aluminium alloys.
// Flow stress uses a Voce saturation law plus a small linear term:
//   sigma_y(ep) = sy0 + Q (1 - exp(-b ep)) + Hlin ep
// Values are representative of baked can stock (yield after the paint-bake
// cycle) and hard-temper end stock.

export const MATERIALS = [
  {
    id: 0,
    label: 'AA3104/3004-H19 body stock (baked)',
    E: 69.0e9, nu: 0.33, rho: 2720,
    sy0: 270e6, Q: 35e6, b: 18, Hlin: 120e6,
  },
  {
    id: 1,
    label: 'AA5182-H48 end stock',
    E: 70.0e9, nu: 0.33, rho: 2650,
    sy0: 320e6, Q: 45e6, b: 15, Hlin: 120e6,
  },
];

export function flowStress(m, ep) {
  return m.sy0 + m.Q * (1 - Math.exp(-m.b * ep)) + m.Hlin * ep;
}
export function flowSlope(m, ep) {
  return m.Q * m.b * Math.exp(-m.b * ep) + m.Hlin;
}

/** Precompute constants used by the solver's inner loops. */
export function prepareMaterial(m, yieldScale = 1) {
  const E = m.E, nu = m.nu;
  const C11 = E / (1 - nu * nu);
  return {
    ...m,
    sy0: m.sy0 * yieldScale,
    Q: m.Q * yieldScale,
    C11, C12: nu * C11, G: E / (2 * (1 + nu)),
    // plane-stress return-mapping constants in the rotated (a,b,c) basis
    ka: E / (2 * (1 - nu)), // E/(1-nu) * 1/2
    kb: (3 * E) / (2 * (1 + nu)), // 3G
    D1: E / (12 * (1 - nu * nu)), // bending stiffness per t^3
  };
}

const SQ2 = Math.SQRT1_2;

/**
 * Plane-stress J2 return mapping (backward Euler, Simo & Taylor style) in the
 * basis where the elastic matrix and the Mises projector are both diagonal.
 *   a = (s11+s22)/sqrt2, b = (s22-s11)/sqrt2, c = s12
 *   vm^2 = a^2/2 + 3 b^2/2 + 3 c^2
 * Input: elastic constants (ka = E/(2(1-nu)), kb = 3G), trial stress,
 * current equivalent plastic strain, and a yield provider with flow(alpha)
 * and slope(alpha). Output in out[0..5]: s11, s22, s12, dEp11, dEp22,
 * dEp12 (tensor). Returns the equivalent plastic strain increment.
 */
export function returnMapJ2(ka, kb, s11, s22, s12, alpha, yp, out) {
  const at = (s11 + s22) * SQ2;
  const bt = (s22 - s11) * SQ2;
  const ct = s12;
  const A = 0.5 * at * at;
  const B = 1.5 * bt * bt + 3 * ct * ct;
  let q = 0;
  let dl = 0;
  let vm = Math.sqrt(A + B);
  for (let it = 0; it < 30; it++) {
    const fa = 1 / (1 + ka * q), fb = 1 / (1 + kb * q);
    const vm2 = A * fa * fa + B * fb * fb;
    vm = Math.sqrt(vm2);
    dl = q * vm;
    const sy = yp.flow(alpha + dl);
    const r = vm - sy;
    if (Math.abs(r) < 1e-7 * sy) break;
    const dvm = (-A * ka * fa * fa * fa - B * kb * fb * fb * fb) / vm;
    const dr = dvm - yp.slope(alpha + dl) * (vm + q * dvm);
    let qn = q - r / dr;
    if (!(qn > 0)) qn = q * 0.5;
    q = qn;
  }
  const fa = 1 / (1 + ka * q), fb = 1 / (1 + kb * q);
  const a = at * fa, b = bt * fb, c = ct * fb;
  // plastic strain increments in (a,b,c): da = q a/2, db = 3 q b/2, dgc = 3 q c
  const dea = 0.5 * q * a, deb = 1.5 * q * b, dgc = 3 * q * c;
  out[0] = (a - b) * SQ2;
  out[1] = (a + b) * SQ2;
  out[2] = c;
  out[3] = (dea - deb) * SQ2;
  out[4] = (dea + deb) * SQ2;
  out[5] = 0.5 * dgc;
  return dl;
}

/** Membrane yield provider for a prepared material. */
export function membraneYield(m) {
  return { flow: (a) => flowStress(m, a), slope: (a) => flowSlope(m, a) };
}

/**
 * Bending yield provider, written in terms of the outer-fibre "bending stress"
 * sigma_b = 6 M / t^2. First yield at sigma_y, rising to the fully plastic
 * moment (sigma_b = 1.5 sigma_y) as the outer-fibre plastic strain grows,
 * which mimics the moment-curvature curve of a solid section; times the
 * material hardening and the Ilyushin membrane interaction factor g.
 * Mutable fields (m, g) are set by the solver before each use.
 */
export function makeBendingYield() {
  return {
    m: null,
    g: 1,
    flow(a) {
      const m = this.m;
      const ar = (0.7 * m.sy0) / m.E;
      return this.g * flowStress(m, a) * (1.5 - 0.5 * Math.exp(-a / ar));
    },
    slope(a) {
      const m = this.m;
      const ar = (0.7 * m.sy0) / m.E;
      const ex = Math.exp(-a / ar);
      return this.g * (flowSlope(m, a) * (1.5 - 0.5 * ex) + flowStress(m, a) * (0.5 * ex) / ar);
    },
  };
}

export function bendingFlowNoG(m, a) {
  const ar = (0.7 * m.sy0) / m.E;
  return flowStress(m, a) * (1.5 - 0.5 * Math.exp(-a / ar));
}
