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
  }
  sdf(x, y, z, n) {
    this._local(x, y, z, _l);
    const lx = _l[0], ly = _l[1] - this.hy, lz = _l[2];
    const r = this.r;
    const qx = Math.abs(lx) - (this.hx - r);
    const qy = Math.abs(ly) - (this.hy - r);
    const qz = Math.abs(lz) - (this.hz - r);
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
    d = this._ram(lx, _l[1], lz, d, n);
    this._toWorldN(n);
    return d;
  }
  describe() {
    return { kind: 'plate', width: this.hx * 2, length: this.hz * 2, thickness: this.hy * 2, edgeRadius: this.r, yaw: this.yaw, ramDiameter: this.ramR * 2 };
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
  describe() { return { kind: 'bar', diameter: this.rad * 2, length: (this.hl + this.rad) * 2, yaw: this.yaw }; }
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
  describe() { return { kind: 'punch', diameter: this.R * 2, height: this.hh * 2, edgeRadius: this.r, ramDiameter: this.ramR * 2 }; }
}

export function makeTool(spec) {
  switch (spec.type) {
    case 'plate': return new PlateTool(spec);
    case 'bar': return new BarTool(spec);
    case 'punch': return new PunchTool(spec);
    case 'plane': return new PlaneTool(spec);
    default: throw new Error('unknown tool type ' + spec.type);
  }
}
