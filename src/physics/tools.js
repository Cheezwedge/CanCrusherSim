// Rigid crushing tools described by signed distance functions (SDF).
// Every tool exposes sdf(x, y, z, n) -> signed distance (m) and writes the
// outward unit normal into n[0..2]. Tools translate (and may be yawed about the
// vertical y axis); they are perfectly rigid, like hardened steel compared with
// a 0.1 mm aluminium wall.

class ToolBase {
  constructor(kind, opts = {}) {
    this.kind = kind;
    this.px = 0; this.py = 0; this.pz = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.setYaw(opts.yawDeg || 0);
    this.friction = opts.friction ?? 0.25;
    // accumulated reaction force exerted BY the can ON the tool (N)
    this.fx = 0; this.fy = 0; this.fz = 0;
    this.contactCount = 0;
    this.enabled = true;
    // how far the tool reaches below its reference point py (for contact culling)
    this.reachBelow = 0;
    // true for tools approaching from above (allows cheap culling by height)
    this.fromAbove = true;
  }
  setYaw(deg) {
    this.yaw = (deg * Math.PI) / 180;
    this.cy = Math.cos(this.yaw);
    this.sy = Math.sin(this.yaw);
  }
  // world -> local (rotation about y by -yaw)
  _local(x, y, z, l) {
    const dx = x - this.px, dz = z - this.pz;
    l[0] = this.cy * dx - this.sy * dz;
    l[1] = y - this.py;
    l[2] = this.sy * dx + this.cy * dz;
  }
  _toWorldN(n) {
    const nx = n[0], nz = n[2];
    n[0] = this.cy * nx + this.sy * nz;
    n[2] = -this.sy * nx + this.cy * nz;
  }
  /**
   * Press rod: a vertical round rod of radius ramR rising from the top of the
   * tool body (ramBase above py). It is part of the rigid tool, so metal that
   * folds up and over a thin plate lands on it instead of passing through.
   * Takes local coordinates (y relative to py) and the body's distance/normal
   * (normal still in local axes); returns the union distance.
   */
  _ram(lx, lyRef, lz, d, n) {
    const r = this.ramR;
    if (!r) return d;
    const rho = Math.sqrt(lx * lx + lz * lz);
    const below = this.ramBase - lyRef;
    let dr, nx = 0, ny = 0, nz = 0;
    if (below > 0) {
      if (rho > r) {
        const a = rho - r;
        dr = Math.sqrt(a * a + below * below);
        nx = (a / dr) * (lx / rho); nz = (a / dr) * (lz / rho); ny = -below / dr;
      } else { dr = below; ny = -1; }
    } else {
      dr = rho - r;
      if (rho > 1e-12) { nx = lx / rho; nz = lz / rho; } else nx = 1;
    }
    if (dr < d) { n[0] = nx; n[1] = ny; n[2] = nz; return dr; }
    return d;
  }
  /** Lowest point of the tool (y) relative to its reference position. */
  get bottomOffset() { return 0; }
  describe() { return { kind: this.kind }; }
}

const _l = new Float64Array(3);

/** Infinite flat anvil: the half-space y >= py (normal +y). */
export class PlaneTool extends ToolBase {
  constructor(opts = {}) { super('plane', opts); }
  sdf(x, y, z, n) {
    n[0] = 0; n[1] = 1; n[2] = 0;
    return y - this.py;
  }
  describe() { return { kind: 'plane', y: this.py }; }
}

/** Half-space with an arbitrary unit normal (n . (x - p) >= 0), e.g. a backstop. */
export class WallTool extends ToolBase {
  constructor(opts = {}) {
    super('wall', opts);
    const [a, b, c] = opts.normal;
    const l = Math.hypot(a, b, c);
    this.nx = a / l; this.ny = b / l; this.nz = c / l;
    this.fromAbove = false;
  }
  sdf(x, y, z, n) {
    n[0] = this.nx; n[1] = this.ny; n[2] = this.nz;
    return this.nx * (x - this.px) + this.ny * (y - this.py) + this.nz * (z - this.pz);
  }
  describe() { return { kind: 'wall', normal: [this.nx, this.ny, this.nz] }; }
}

/** Steel ball indenter; reference point = ball centre. */
export class BallTool extends ToolBase {
  constructor(opts = {}) {
    super('ball', opts);
    this.rad = opts.diameter / 2;
    this.reachBelow = this.rad;
    this.fromAbove = false;
  }
  sdf(x, y, z, n) {
    const dx = x - this.px, dy = y - this.py, dz = z - this.pz;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (l < 1e-12) { n[0] = 0; n[1] = 1; n[2] = 0; return -this.rad; }
    n[0] = dx / l; n[1] = dy / l; n[2] = dz / l;
    return l - this.rad;
  }
  describe() { return { kind: 'ball', diameter: this.rad * 2 }; }
}

/**
 * Flat platen: rounded box. Reference point = centre of the bottom face.
 * width along local x, length along local z, edge radius r.
 */
export class PlateTool extends ToolBase {
  constructor(opts) {
    super('plate', opts);
    this.hx = opts.width / 2;
    this.hz = opts.length / 2;
    this.hy = opts.thickness ? opts.thickness / 2 : 0.010;
    this.r = Math.min(opts.edgeRadius ?? 0.002, this.hx * 0.999, this.hz * 0.999, this.hy * 0.999);
    this.ramR = Math.max(0, (opts.ramDiameter ?? 0.018) / 2);
    this.ramBase = 2 * this.hy;
    // optional slot across the middle (along local x): the plate becomes two
    // side pieces separated by `slot` in local z
    this.slot = opts.slot ?? 0;
    if (this.slot > 0) {
      this.hzp = (2 * this.hz - this.slot) / 4;
      this.zc = this.slot / 2 + this.hzp;
      this.r = Math.min(this.r, this.hzp * 0.999);
    }
  }
  sdf(x, y, z, n) {
    this._local(x, y, z, _l);
    const lx = _l[0], ly = _l[1] - this.hy;
    const sl = this.slot > 0;
    const lz = sl ? Math.abs(_l[2]) - this.zc : _l[2];
    const r = this.r;
    const qx = Math.abs(lx) - (this.hx - r);
    const qy = Math.abs(ly) - (this.hy - r);
    const qz = Math.abs(lz) - ((sl ? this.hzp : this.hz) - r);
    const mx = qx > 0 ? qx : 0, my = qy > 0 ? qy : 0, mz = qz > 0 ? qz : 0;
    const len = Math.sqrt(mx * mx + my * my + mz * mz);
    let d;
    if (len > 1e-12) {
      d = len - r;
      n[0] = (lx < 0 ? -mx : mx) / len;
      n[1] = (ly < 0 ? -my : my) / len;
      n[2] = (lz < 0 ? -mz : mz) / len;
    } else {
      n[0] = 0; n[1] = 0; n[2] = 0;
      if (qx >= qy && qx >= qz) { d = qx - r; n[0] = lx < 0 ? -1 : 1; }
      else if (qy >= qz) { d = qy - r; n[1] = ly < 0 ? -1 : 1; }
      else { d = qz - r; n[2] = lz < 0 ? -1 : 1; }
    }
    if (sl && _l[2] < 0) n[2] = -n[2];
    d = this._ram(lx, _l[1], _l[2], d, n);
    this._toWorldN(n);
    return d;
  }
  /** True if a point lies on top of the plate (above its top face, inside its outline). */
  isOverTop(x, y, z) {
    this._local(x, y, z, _l);
    return _l[1] > 2 * this.hy && _l[1] < 2 * this.hy + 0.03 && Math.abs(_l[0]) < this.hx && Math.abs(_l[2]) < this.hz;
  }
  describe() {
    return { kind: 'plate', width: this.hx * 2, length: this.hz * 2, thickness: this.hy * 2, edgeRadius: this.r, yaw: this.yaw, ramDiameter: this.ramR * 2, slot: this.slot };
  }
}

/**
 * Round bar (capsule) lying horizontally along local x.
 * Reference point = lowest point of the bar's mid-section.
 */
export class BarTool extends ToolBase {
  constructor(opts) {
    super('bar', opts);
    this.rad = opts.diameter / 2;
    this.hl = Math.max(0, opts.length / 2 - this.rad);
    this.ramR = Math.min((opts.ramDiameter ?? 0.018) / 2, this.rad * 0.9);
    this.ramBase = 2 * this.rad;
  }
  sdf(x, y, z, n) {
    this._local(x, y, z, _l);
    const lx = _l[0], ly = _l[1] - this.rad, lz = _l[2];
    const cx = lx > this.hl ? this.hl : lx < -this.hl ? -this.hl : lx;
    const dx = lx - cx;
    const len = Math.sqrt(dx * dx + ly * ly + lz * lz);
    if (len < 1e-12) { n[0] = 0; n[1] = -1; n[2] = 0; return -this.rad; }
    n[0] = dx / len; n[1] = ly / len; n[2] = lz / len;
    const d = this._ram(lx, _l[1], lz, len - this.rad, n);
    this._toWorldN(n);
    return d;
  }
  isOverTop(x, y, z) {
    this._local(x, y, z, _l);
    return _l[1] > this.rad && _l[1] < 2 * this.rad + 0.03 && Math.abs(_l[0]) < this.hl + this.rad && Math.abs(_l[2]) < 0.8 * this.rad;
  }
  describe() { return { kind: 'bar', diameter: this.rad * 2, length: (this.hl + this.rad) * 2, yaw: this.yaw, ramDiameter: this.ramR * 2 }; }
}

/**
 * Round punch: vertical cylinder with a rounded bottom edge.
 * Reference point = centre of the bottom face.
 */
export class PunchTool extends ToolBase {
  constructor(opts) {
    super('punch', opts);
    this.R = opts.diameter / 2;
    this.hh = opts.height ? opts.height / 2 : 0.015;
    this.r = Math.min(opts.edgeRadius ?? 0.0015, this.R * 0.999, this.hh * 0.999);
    this.ramR = Math.min((opts.ramDiameter ?? 0.018) / 2, this.R);
    this.ramBase = 2 * this.hh;
  }
  sdf(x, y, z, n) {
    this._local(x, y, z, _l);
    const lx = _l[0], ly = _l[1] - this.hh, lz = _l[2];
    const rho = Math.sqrt(lx * lx + lz * lz);
    const r = this.r;
    const qr = rho - (this.R - r);
    const qy = Math.abs(ly) - (this.hh - r);
    const mr = qr > 0 ? qr : 0, my = qy > 0 ? qy : 0;
    const len = Math.sqrt(mr * mr + my * my);
    let d, nr, ny;
    if (len > 1e-12) { d = len - r; nr = mr / len; ny = (ly < 0 ? -my : my) / len; }
    else if (qr >= qy) { d = qr - r; nr = 1; ny = 0; }
    else { d = qy - r; nr = 0; ny = ly < 0 ? -1 : 1; }
    if (rho > 1e-12) { n[0] = (nr * lx) / rho; n[2] = (nr * lz) / rho; } else { n[0] = 0; n[2] = 0; }
    n[1] = ny;
    d = this._ram(lx, _l[1], lz, d, n);
    this._toWorldN(n);
    return d;
  }
  isOverTop(x, y, z) {
    this._local(x, y, z, _l);
    return _l[1] > 2 * this.hh && _l[1] < 2 * this.hh + 0.03 && Math.hypot(_l[0], _l[2]) < this.R;
  }
  describe() { return { kind: 'punch', diameter: this.R * 2, height: this.hh * 2, edgeRadius: this.r, ramDiameter: this.ramR * 2 }; }
}

/**
 * Platen whose bottom face has a profile along its local z axis (the can's
 * length when the can lies on its side). Reference point py = lowest point.
 *   flat | convex (cylinder bulging down, radius) | concave (dished up, radius)
 *   roof (V, apex down, angleDeg) | valley (V, apex up) | tilt (one end lower)
 */
export class ProfilePlatenTool extends ToolBase {
  constructor(opts) {
    super('profile', opts);
    this.hx = opts.width / 2;
    this.hz = opts.length / 2;
    this.th = opts.thickness ?? 0.02;
    this.profile = opts.profile || 'flat';
    this.R = opts.radius ?? 0.4;
    this.ta = Math.tan(((opts.angleDeg ?? 6) * Math.PI) / 180);
    const hz = this.hz, R = this.R;
    if (this.profile === 'concave') this.c0 = Math.sqrt(Math.max(0, R * R - hz * hz));
  }
  /** Height of the bottom face above the lowest point, and its slope, at local z. */
  _yb(z, out) {
    const hz = this.hz, R = this.R, ta = this.ta;
    switch (this.profile) {
      case 'convex': { const q = Math.sqrt(R * R - z * z); out[0] = R - q; out[1] = z / q; return; }
      case 'concave': { const q = Math.sqrt(R * R - z * z); out[0] = q - this.c0; out[1] = -z / q; return; }
      case 'roof': out[0] = Math.abs(z) * ta; out[1] = z >= 0 ? ta : -ta; return;
      case 'valley': out[0] = (hz - Math.abs(z)) * ta; out[1] = z >= 0 ? -ta : ta; return;
      case 'tilt': out[0] = (z + hz) * ta; out[1] = ta; return;
      default: out[0] = 0; out[1] = 0;
    }
  }
  sdf(x, y, z, n) {
    this._local(x, y, z, _l);
    const lx = _l[0], ly = _l[1], lz = _l[2];
    const zc = lz > this.hz ? this.hz : lz < -this.hz ? -this.hz : lz;
    const yb = _pf; this._yb(zc, yb);
    const ex = Math.abs(lx) - this.hx, ez = Math.abs(lz) - this.hz;
    let d;
    if (ex <= 0 && ez <= 0) {
      const sl = yb[1], c = 1 / Math.sqrt(1 + sl * sl);
      d = (yb[0] - ly) * c;
      n[0] = 0; n[1] = -c; n[2] = sl * c;
    } else {
      const a = ex > 0 ? ex : 0, b = ez > 0 ? ez : 0;
      const v = yb[0] - ly > 0 ? yb[0] - ly : 0;
      d = Math.sqrt(a * a + b * b + v * v);
      if (d < 1e-12) { n[0] = 0; n[1] = -1; n[2] = 0; }
      else { n[0] = (lx < 0 ? -a : a) / d; n[1] = -v / d; n[2] = (lz < 0 ? -b : b) / d; }
    }
    this._toWorldN(n);
    return d;
  }
  describe() {
    return { kind: 'profile', width: this.hx * 2, length: this.hz * 2, thickness: this.th, profile: this.profile, radius: this.R, angleDeg: (Math.atan(this.ta) * 180) / Math.PI, yaw: this.yaw };
  }
}
const _pf = new Float64Array(2);

/**
 * Hinged (clamshell) platen, like a hand lever crusher's jaw. Its bottom face
 * passes through a pivot line parallel to world x at (pivotY, pivotZ) and
 * extends `length` along +z. phi = how far it is raised (0 = parallel to the
 * bed). omega > 0 closes it.
 */
export class HingedPlatenTool extends ToolBase {
  constructor(opts) {
    super('hinge', opts);
    this.hx = opts.width / 2;
    this.L = opts.length;
    this.th = opts.thickness ?? 0.02;
    this.phi = opts.phi ?? 0.5;
    this.omega = 0;
    this.rotating = true;
    this.fromAbove = false;
    this.mres = 0; // moment resisting closure about the pivot (N m)
  }
  sdf(x, y, z, n) {
    const dy = y - this.py, dz = z - this.pz;
    const c = Math.cos(this.phi), s = Math.sin(this.phi);
    const u = dz * c + dy * s;      // along the plate from the pivot
    const w = dy * c - dz * s;      // height above the bottom face
    const ex = Math.abs(x - this.px) - this.hx;
    const eu = u > this.L ? u - this.L : u < 0 ? -u : 0;
    const dFace = -w;               // > 0 below the face (outside the solid)
    if (ex <= 0 && eu <= 0) { n[0] = 0; n[1] = -c; n[2] = s; return dFace; }
    const a = ex > 0 ? ex : 0, v = dFace > 0 ? dFace : 0;
    const d = Math.sqrt(a * a + eu * eu + v * v);
    if (d < 1e-12) { n[0] = 0; n[1] = -c; n[2] = s; return 0; }
    // direction: combine x excess, along-plate excess, and below-face part
    const su = u > this.L ? 1 : -1;
    n[0] = ((x - this.px) < 0 ? -a : a) / d;
    n[1] = (su * eu * s - v * c) / d;
    n[2] = (su * eu * c + v * s) / d;
    return d;
  }
  velocityAt(x, y, z, out) {
    const w = this.omega;
    out[0] = 0; out[1] = -w * (z - this.pz); out[2] = w * (y - this.py);
  }
  describe() {
    return { kind: 'hinge', width: this.hx * 2, length: this.L, thickness: this.th, pivotY: this.py, pivotZ: this.pz, phi: this.phi };
  }
}

export function makeTool(spec) {
  switch (spec.type) {
    case 'profile': return new ProfilePlatenTool(spec);
    case 'hinge': return new HingedPlatenTool(spec);
    case 'plate': return new PlateTool(spec);
    case 'bar': return new BarTool(spec);
    case 'punch': return new PunchTool(spec);
    case 'plane': return new PlaneTool(spec);
    default: throw new Error('unknown tool type ' + spec.type);
  }
}
