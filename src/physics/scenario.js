// Crush scenario: places a can (any tilt from upright to lying on its side) on
// a rigid anvil, drives one or more rigid crushers down in sequence at a
// prescribed speed, and records the force-displacement response. Between
// presses the crusher retracts while the can is held on the bed, which measures
// whether metal folded over the crusher snags it (pull-out force).

import { buildCanMesh, meshVolume, CAN_PRESETS } from './canGeometry.js';
import { ShellSolver } from './solver.js';
import { PlaneTool, WallTool, BallTool, makeTool } from './tools.js';

export const RESOLUTIONS = {
  coarse: { nTheta: 44, label: 'Coarse (fast preview)' },
  standard: { nTheta: 56, label: 'Standard' },
  fine: { nTheta: 72, label: 'Fine (slow)' },
};

export const DEFAULT_PARAMS = {
  can: 'std355',
  canOverrides: {},
  resolution: 'standard',
  tiltDeg: 0,            // 0 = upright (crush top-down), 90 = lying on its side
  rollDeg: 0,            // rotation of the can about its own axis
  tool: {
    type: 'plate',       // plate | bar | punch
    width: 0.100,        // plate: size along tool x (m)
    length: 0.100,       // plate: size along tool z; bar: bar length (m)
    diameter: 0.020,     // bar / punch diameter (m)
    edgeRadius: 0.003,   // plate / punch edge rounding (m)
    yawDeg: 0,           // rotate the tool about the vertical axis
    offsetX: 0,          // horizontal offset of the tool from the can centre (m)
    offsetZ: 0,
  },
  friction: 0.25,        // steel tool on painted aluminium
  imperfection: 0.08,    // random shape imperfection amplitude (mm)
  seed: 7,
  // Pre-dent (mm). mode 'pressed' (default): a Ø10 mm steel ball is pushed
  // `depth` mm into the wall and withdrawn before crushing, so the dent has real
  // creases, work hardening and residual stress. mode 'geometric': stress-free
  // smooth dimple built into the initial shape.
  dent: { depth: 0, heightFrac: 0.5, azimuthDeg: 0, width: 7, mode: 'pressed', ball: 10 },
  finalGap: 0.018,       // crusher stops this far above the anvil (m)
  maxForce: 9000,        // N: stop if exceeded (beyond any hand-operated crusher)
  speed: 0.25,           // crusher speed while the can folds (m/s, mass-scaled time)
  minSpeed: 0.035,       // crusher speed during the stiff elastic loading / first buckle
  governor: 0.3,         // stiffness governor gain (smaller = more quasi-static)
  massScale: 400,
  dtSafety: 0.8,
  localDamping: 0.1,
  release: true,         // back the crusher off at the end to measure spring-back
  // Optional sequence of presses. Each entry: { tool, finalGap, label }.
  // When omitted a single press uses `tool` and `finalGap`.
  presses: null,
  // Convenience: append a large flat platen that flattens what press 1 left.
  secondPress: { enabled: false, size: 0.16, finalGap: 0.006 },
  retractMax: 0.020,     // how far a crusher may be pulled back while still snagged (m)
  retractSpeed: 0.15,
  selfContact: true,
  yieldScale: 1,
};

function deepMerge(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b || {})) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') out[k] = deepMerge(a[k], b[k]);
    else if (b[k] !== undefined) out[k] = b[k];
  }
  return out;
}

export function resolveParams(p) {
  return deepMerge(DEFAULT_PARAMS, p || {});
}

export class CrushScenario {
  constructor(params) {
    const P = (this.params = resolveParams(params));
    const res = RESOLUTIONS[P.resolution] || RESOLUTIONS.standard;
    const mesh = (this.mesh = buildCanMesh({
      preset: P.can,
      overrides: P.canOverrides,
      nTheta: res.nTheta,
      imperfection: P.imperfection,
      seed: P.seed,
      dent: P.dent.mode === 'geometric' ? P.dent : null,
    }));
    this.spec = mesh.spec;

    // ---- place the can: local (x, y, z=axis) -> world (y up) -------------
    const X = mesh.X;
    const N = X.length / 3;
    const tilt = (P.tiltDeg * Math.PI) / 180;
    const roll = (P.rollDeg * Math.PI) / 180;
    const ct = Math.cos(tilt), st = Math.sin(tilt), cr = Math.cos(roll), sr = Math.sin(roll);
    const Hm = mesh.spec.H / 1000;
    // local can frame (axis = z, base at z = 0) -> world (y up), before lifting onto the anvil
    const toWorld = (lx, ly, lz, out) => {
      const rx = cr * lx - sr * ly, ry = sr * lx + cr * ly; // roll about the can axis
      const wx = rx, wy = lz, wz = -ry;                       // upright: world = (x, z, -y)
      out[0] = wx; out[1] = ct * wy - st * wz; out[2] = st * wy + ct * wz; // tilt about world x
      return out;
    };
    const tmp = [0, 0, 0];
    for (let i = 0; i < N; i++) {
      toWorld(X[3 * i], X[3 * i + 1], X[3 * i + 2] - Hm / 2, tmp); // centre at mid-height
      X[3 * i] = tmp[0]; X[3 * i + 1] = tmp[1]; X[3 * i + 2] = tmp[2];
    }
    // sit on the anvil (y = 0) accounting for half the wall thickness
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < N; i++) {
      minY = Math.min(minY, X[3 * i + 1] - 0.5 * mesh.nodeThick[i]);
    }
    for (let i = 0; i < N; i++) X[3 * i + 1] -= minY - 1e-6;
    for (let i = 0; i < N; i++) maxY = Math.max(maxY, X[3 * i + 1] + 0.5 * mesh.nodeThick[i]);
    this.initialHeight = maxY;
    this.axis = [0, ct, st];
    const lift = -(minY - 1e-6);

    // pressed pre-dent: where and in which direction to push
    this.dentPlan = null;
    if (P.dent && P.dent.depth > 0 && P.dent.mode !== 'geometric') {
      const R = mesh.spec.R / 1000;
      const zb = 0.33 * mesh.spec.R, zN0 = mesh.spec.H - 20;
      const zd = (zb + (zN0 - zb) * (P.dent.heightFrac ?? 0.5)) / 1000;
      const th = ((P.dent.azimuthDeg ?? 0) * Math.PI) / 180;
      const pt = toWorld(R * Math.cos(th), R * Math.sin(th), zd - Hm / 2, [0, 0, 0]);
      pt[1] += lift;
      const nrm = toWorld(Math.cos(th), Math.sin(th), 0, [0, 0, 0]);
      const centre = toWorld(0, 0, zd - Hm / 2, [0, 0, 0]);
      centre[1] += lift;
      this.dentPlan = { point: pt, normal: nrm, centre, R, depth: P.dent.depth / 1000, ball: (P.dent.ball ?? 10) / 1000 };
    }

    this.solver = new ShellSolver(mesh, {
      massScale: P.massScale,
      selfContact: P.selfContact,
      yieldScale: P.yieldScale,
      dtSafety: P.dtSafety,
      localDamping: P.localDamping,
    });
    const s = this.solver;
    this.anvil = s.addTool(new PlaneTool({ friction: P.friction }));
    this.anvil.py = 0;
    // ---- presses ----------------------------------------------------------
    const specs = Array.isArray(P.presses) && P.presses.length
      ? P.presses.map((ps) => ({ ...ps }))
      : [{ tool: P.tool, finalGap: P.finalGap, label: 'crusher' }];
    if (P.secondPress && P.secondPress.enabled) {
      const sp = P.secondPress;
      const sz = sp.size ?? 0.16;
      const shape = sp.shape || 'flat';
      let tl;
      if (shape === 'hinge') tl = { type: 'hinge', width: sz, length: sz + 0.04, thickness: 0.02 };
      else if (shape === 'flat') tl = { type: 'plate', width: sz, length: sz, thickness: 0.02, edgeRadius: 0.003, ramDiameter: 0.018 };
      else tl = { type: 'profile', width: sz, length: sz, thickness: 0.02, profile: shape, radius: sp.radius ?? 0.4, angleDeg: sp.angleDeg ?? 6 };
      specs.push({ tool: tl, finalGap: sp.finalGap ?? 0.006, label: 'platen', motion: shape === 'hinge' ? 'hinge' : 'translate' });
    }
    this.presses = specs.map((ps, k) => {
      const t = s.addTool(makeTool({ ...ps.tool, friction: P.friction }));
      t.px = ps.tool.offsetX || 0;
      t.pz = ps.tool.offsetZ || 0;
      t.enabled = k === 0;
      t.py = k === 0 ? maxY + 0.0003 : 1; // later presses wait parked far above
      return {
        spec: ps, tool: t, label: ps.label || (k === 0 ? 'crusher' : `press ${k + 1}`),
        targetY: ps.finalGap, startY: t.py, stroke: 0, travel: 0, work: 0,
        startTravel: 0, firstSample: 0, peak: { F: 0, d: 0 },
        springBack: null, pullForce: 0, snagged: false, overTop: 0, heightAfter: null, stopReason: '',
        motion: ps.motion || 'translate', rc: 0, phiEnd: 0,
      };
    });
    this.stage = 0;
    this.tool = this.presses[0].tool;
    this.presses[0].stroke = Math.max(0, this.presses[0].startY - this.presses[0].targetY);
    // kept for compatibility with single-press callers
    this.toolStartY = this.tool.py;
    this.targetY = this.presses[0].targetY;
    this.stroke = this.presses[0].stroke;

    // pre-dent tools (ball indenter + backstop), active only before the crush
    if (this.dentPlan) {
      const dp = this.dentPlan;
      const ball = (this.ball = s.addTool(new BallTool({ diameter: dp.ball, friction: P.friction })));
      const clear = 0.0005;
      ball.px = dp.point[0] + dp.normal[0] * (dp.ball / 2 + clear);
      ball.py = dp.point[1] + dp.normal[1] * (dp.ball / 2 + clear);
      ball.pz = dp.point[2] + dp.normal[2] * (dp.ball / 2 + clear);
      this.ballStart = [ball.px, ball.py, ball.pz];
      this.dentPush = clear + dp.depth;
      // backstop on the far side unless the anvil already supports the can
      if (dp.normal[1] < 0.7) {
        const n = dp.normal;
        const wall = (this.backstop = s.addTool(new WallTool({ normal: [n[0], n[1], n[2]], friction: 0.6 })));
        // find the far-side extreme of the can along -n
        let mn = Infinity;
        for (let i = 0; i < N; i++) {
          const d = (X[3 * i] - dp.centre[0]) * n[0] + (X[3 * i + 1] + lift - dp.centre[1]) * n[1] + (X[3 * i + 2] - dp.centre[2]) * n[2] - 0.5 * mesh.nodeThick[i];
          if (d < mn) mn = d;
        }
        wall.px = dp.centre[0] + n[0] * (mn - 1e-5);
        wall.py = dp.centre[1] + n[1] * (mn - 1e-5);
        wall.pz = dp.centre[2] + n[2] * (mn - 1e-5);
      }
      this.dentSpeed = 0.06;
      this.dentMoved = 0;
    }

    this.vmax = P.speed;
    this.vmin = Math.min(P.minSpeed, P.speed);
    // Speed governor: the crusher slows down whenever the can is stiff (elastic
    // loading before buckling) so the mass-scaled dynamics stay quasi-static,
    // and speeds up while the can is folding plastically (low tangent stiffness).
    this.vCur = this.vmin;
    this.mEff = s.massScaled / 3;
    this.Ff = 0; this._kD = 0; this._kF = 0; this._kSteps = 0; this.kEst = 0;
    this.tauUp = 0.004; this.tauDown = 0.0006;
    this.buckled = false; this.fRunMax = 0;
    this.phase = this.dentPlan ? 'dent-in' : 'crush';
    this.done = false;
    this.travel = 0;        // cumulative crusher travel over all presses
    this.pressTravel = 0;   // travel of the current press
    this.history = { d: [], F: [], W: [], h: [], ke: [], stage: [], canH: [] };
    this.fixed = null;
    this._acc = { F: 0, n: 0 };
    this.sampleEvery = 0.0001; // record every 0.1 mm of travel
    this._nextSample = 0;
    this.work = 0;
    this.peak = { F: 0, d: 0 };
    this.stopReason = '';
    this.releaseStart = null;
    this.springBack = 0;
    this.v0 = meshVolume(s.x, s.tris);
    this.wallTime = 0;
  }

  get dt() { return this.solver.dt; }

  _toolVelocity() {
    if (this.phase === 'crush') return -this.vCur;
    if (this.phase === 'release') return this.params.retractSpeed;
    return 0;
  }

  _govern(F) {
    const P = this.params, dt = this.solver.dt;
    this.Ff += (F - this.Ff) * 0.05;
    this._kSteps++;
    const dd = this.pressTravel - this._kD;
    if (dd >= 0.01e-3 && this._kSteps >= 25) {
      const k = (this.Ff - this._kF) / dd;
      this.kEst = Math.max(k, this.kEst * 0.6, 0);
      this._kD = this.pressTravel; this._kF = this.Ff; this._kSteps = 0;
    }
    // Until the can first gives way (or 6 mm of travel) run slowly: the elastic
    // pre-buckling phase is the stiffest part and sets the peak force.
    if (!this.buckled) {
      if (this.Ff > this.fRunMax) this.fRunMax = this.Ff;
      if ((this.fRunMax > 30 && this.Ff < 0.85 * this.fRunMax) || this.pressTravel > 0.004) this.buckled = true;
    }
    const ref = Math.abs(this.Ff) + 40;
    const kk = Math.sqrt(Math.max(this.kEst, 1) * this.mEff);
    let vT;
    if (!this.buckled) {
      // stiff structure -> slow; compliant structure (e.g. side crush) -> faster
      vT = Math.min(this.vmax, Math.max(this.vmin, (0.5 * P.governor * ref) / kk));
    } else {
      vT = Math.min(this.vmax, Math.max(0.5 * this.vmax, (P.governor * ref) / kk));
    }
    const tau = vT < this.vCur ? this.tauDown : this.tauUp;
    this.vCur += (vT - this.vCur) * Math.min(1, dt / tau);
  }

  /** Advance up to n solver steps. Returns true when finished. */
  advance(n) {
    if (this.done) return true;
    const s = this.solver, P = this.params;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    for (let k = 0; k < n; k++) {
      const tool = this.tool;
      const pr = this.presses[this.stage];
      const hinge = pr.motion === 'hinge';
      if (hinge) {
        tool.vy = 0;
        tool.omega = this.phase === 'crush' ? this.vCur / pr.rc : this.phase === 'release' ? -P.retractSpeed / pr.rc : 0;
      } else tool.vy = this._toolVelocity();
      if (this.phase === 'dent-in' || this.phase === 'dent-out') { this._dentStep(); continue; }
      s.step();
      if (hinge) tool.phi -= tool.omega * s.dt;
      // force from the can pushing the crusher back (N); for a hinged platen the
      // resisting moment expressed as a force at the can's centre
      const F = hinge ? tool.mres / pr.rc : tool.fy;
      if (this.phase === 'crush') {
        this._govern(F);
        const dd = hinge ? this.vCur * s.dt : -tool.vy * s.dt;
        this.travel += dd;
        this.pressTravel += dd;
        this.work += F * dd;
        pr.travel += dd;
        pr.work += F * dd;
        this._acc.F += F; this._acc.n++;
        if (this.travel >= this._nextSample) {
          const Fa = this._acc.F / Math.max(1, this._acc.n);
          this._acc.F = 0; this._acc.n = 0;
          this.history.d.push(this.travel);
          this.history.F.push(Fa);
          this.history.W.push(this.work);
          this.history.h.push(hinge ? tool.py + pr.rc * Math.sin(tool.phi) : tool.py);
          this.history.ke.push(s.kinetic);
          this.history.stage.push(this.stage);
          this.history.canH.push(this.currentHeight());
          this._nextSample += this.sampleEvery;
          if (Fa > this.peak.F) { this.peak.F = Fa; this.peak.d = this.travel; }
          if (Fa > pr.peak.F) { pr.peak.F = Fa; pr.peak.d = this.pressTravel; }
          if (Fa > P.maxForce) { pr.stopReason = 'force limit'; this.stopReason = 'force limit'; this._endCrush(); }
        }
        if (hinge ? tool.phi <= 0 : tool.py <= pr.targetY) { pr.stopReason = pr.stopReason || 'stroke complete'; this.stopReason = this.stopReason || 'stroke complete'; this._endCrush(); }
        if (!Number.isFinite(s.x[0])) { this.stopReason = 'numerical failure'; this.done = true; return true; }
      } else if (this.phase === 'release') {
        const risen = hinge ? (tool.phi - this.releaseStart) * pr.rc : tool.py - this.releaseStart;
        // pull-out force: the can (held on the bed) dragging the crusher down
        this._pullAcc = this._pullAcc * 0.9 + Math.max(0, -F) * 0.1;
        if (this._pullAcc > pr.pullForce) pr.pullForce = this._pullAcc;
        if (tool.contactCount === 0) {
          if (pr.springBack === null) pr.springBack = risen;
          this._freeSteps++;
        } else this._freeSteps = 0;
        if ((this._freeSteps > 40 && risen > 0.001) || risen > P.retractMax) {
          pr.snagged = tool.contactCount > 0;
          if (pr.springBack === null) pr.springBack = risen;
          this._afterRelease();
          if (this.done) break;
        }
      }
      if (this.done) break;
    }
    if (t0) this.wallTime += performance.now() - t0;
    return this.done;
  }

  _dentStep() {
    const s = this.solver, ball = this.ball, dp = this.dentPlan;
    const sgn = this.phase === 'dent-in' ? -1 : 1;
    const v = this.dentSpeed;
    ball.vx = sgn * v * dp.normal[0]; ball.vy = sgn * v * dp.normal[1]; ball.vz = sgn * v * dp.normal[2];
    s.step();
    this.dentMoved += v * s.dt;
    const F = Math.abs(ball.fx * dp.normal[0] + ball.fy * dp.normal[1] + ball.fz * dp.normal[2]);
    if (this.phase === 'dent-in') {
      this.dentForce = Math.max(this.dentForce || 0, F);
      if (this.dentMoved >= this.dentPush) { this.phase = 'dent-out'; this.dentMoved = 0; }
    } else if (this.dentMoved >= this.dentPush + 0.002 || (ball.contactCount === 0 && this.dentMoved > 0.001)) {
      ball.vx = ball.vy = ball.vz = 0;
      ball.enabled = false;
      if (this.backstop) this.backstop.enabled = false;
      this.phase = 'crush';
    }
  }

  /** Positions of auxiliary (pre-dent) tools for display, in metres. */
  auxTools() {
    if (!this.ball) return null;
    const active = this.ball.enabled;
    return {
      active,
      ball: { x: this.ball.px, y: this.ball.py, z: this.ball.pz, d: this.ball.rad * 2 },
      backstop: this.backstop ? { x: this.backstop.px, y: this.backstop.py, z: this.backstop.pz, n: [this.backstop.nx, this.backstop.ny, this.backstop.nz] } : null,
      dentForce: this.dentForce || 0,
    };
  }

  _endCrush() {
    if (this.phase !== 'crush') return;
    const pr = this.presses[this.stage];
    if (!this.params.release && this.stage === this.presses.length - 1) {
      this.phase = 'finished';
      this.done = true;
      return;
    }
    this.phase = 'release';
    this.releaseStart = pr.motion === 'hinge' ? this.tool.phi : this.tool.py;
    this._pullAcc = 0;
    this._freeSteps = 0;
    pr.overTop = this._countOverTop(this.tool);
    // hold the can on the bed (like a stripper) while the crusher backs off
    const s = this.solver, x = s.x;
    if (!s.fixed) s.fixed = new Uint8Array(s.N);
    for (let i = 0; i < s.N; i++) s.fixed[i] = x[3 * i + 1] < 0.0015 ? 1 : 0;
  }

  /**
   * For a profiled platen the lowest point may not be above the can's highest
   * point: lift it so no node is inside the face when it starts.
   */
  _profileLift(tool) {
    if (tool.kind !== 'profile') return 0;
    const x = this.solver.x, n = [0, 0, 0];
    const top = this.currentHeight() + 0.0003;
    tool.py = top;
    let worst = 0;
    for (let i = 0; i < this.solver.N; i++) {
      const d = tool.sdf(x[3 * i], x[3 * i + 1], x[3 * i + 2], n) - 0.5 * this.solver.nodeThick[i];
      if (d < worst) worst = d;
    }
    return -worst + 0.0003;
  }

  /** Place a hinged platen: pivot just beyond the can's -z end at the stop height. */
  _placeHinge(pr) {
    const s = this.solver, x = s.x, t = pr.tool;
    let zmin = Infinity, zmax = -Infinity;
    for (let i = 0; i < s.N; i++) { zmin = Math.min(zmin, x[3 * i + 2]); zmax = Math.max(zmax, x[3 * i + 2]); }
    t.px = 0; t.py = pr.targetY; t.pz = zmin - 0.015;
    t.L = Math.max(t.L, zmax - t.pz + 0.02);
    pr.rc = 0.5 * (zmin + zmax) - t.pz;
    let phi0 = 0;
    for (let i = 0; i < s.N; i++) {
      const dz = x[3 * i + 2] - t.pz;
      if (dz < 0.002) continue;
      const a = Math.atan2(x[3 * i + 1] + 0.5 * s.nodeThick[i] + 0.0003 - t.py, dz);
      if (a > phi0) phi0 = a;
    }
    t.phi = phi0 + 0.004;
    pr.startY = t.phi;
    pr.stroke = pr.rc * t.phi;
  }

  /** Nodes of the can lying on top of the crusher (metal folded over it). */
  _countOverTop(tool) {
    if (typeof tool.isOverTop !== 'function') return 0;
    const x = this.solver.x;
    let c = 0;
    for (let i = 0; i < this.solver.N; i++) if (tool.isOverTop(x[3 * i], x[3 * i + 1], x[3 * i + 2])) c++;
    return c;
  }

  _afterRelease() {
    const s = this.solver;
    const pr = this.presses[this.stage];
    if (s.fixed) s.fixed.fill(0);
    pr.heightAfter = this.currentHeight();
    this.springBack = pr.springBack;
    this.tool.vy = 0;
    if (this.stage + 1 < this.presses.length) {
      this.tool.enabled = false;
      this.tool.py = 1;
      this.stage++;
      const nx = this.presses[this.stage];
      this.tool = nx.tool;
      nx.tool.enabled = true;
      if (nx.motion === 'hinge') this._placeHinge(nx);
      else {
        nx.tool.py = this.currentHeight() + 0.0003 + this._profileLift(nx.tool);
        nx.startY = nx.tool.py;
        nx.stroke = Math.max(0, nx.startY - nx.targetY);
      }
      nx.startTravel = this.travel;
      nx.firstSample = this.history.d.length;
      // fresh governor for the new press
      this.pressTravel = 0;
      this.vCur = this.vmin;
      this.Ff = 0; this._kD = 0; this._kF = 0; this._kSteps = 0; this.kEst = 0;
      this.buckled = false; this.fRunMax = 0;
      this.phase = 'crush';
    } else {
      this.phase = 'finished';
      this.done = true;
    }
  }

  /** Approximate number of solver steps for the whole run (for progress bars). */
  estimatedSteps() {
    return Math.ceil(this.stroke / (0.25 * this.vmax * this.solver.dt));
  }

  progress() {
    const n = this.presses.length;
    const pr = this.presses[this.stage];
    const f = pr.stroke > 0 ? Math.min(1, this.pressTravel / pr.stroke) : 1;
    return this.done ? 1 : (this.stage + f) / n;
  }

  /** Description of the crusher currently in use (for display). */
  activeTool() {
    const t = this.tool;
    return { ...t.describe(), x: t.px, y: t.py, z: t.pz, stage: this.stage, label: this.presses[this.stage].label, phi: t.phi ?? 0 };
  }

  /** Bounding height of the can now (m). */
  currentHeight() {
    const x = this.solver.x;
    let maxY = -Infinity;
    for (let i = 1; i < x.length; i += 3) if (x[i] > maxY) maxY = x[i];
    return maxY;
  }

  summary() {
    const h = this.history;
    const s = this.solver;
    const a0 = analyseCurve(h.d, h.F, 0, firstIndexOfStage(h.stage, 1));
    const overall = analyseCurve(h.d, h.F, 0, h.d.length);
    const vol = meshVolume(s.x, s.tris);
    const stages = this.presses.map((pr, k) => {
      const i0 = firstIndexOfStage(h.stage, k), i1 = firstIndexOfStage(h.stage, k + 1);
      const a = analyseCurve(h.d, h.F, i0, i1, pr.startTravel);
      return {
        label: pr.label, tool: pr.tool.describe(), finalGap: pr.targetY,
        initialPeak: a.initial ? a.initial.F : null, initialPeakAt: a.initial ? a.initial.d : null,
        peakForce: a.peak.F, peakAt: a.peak.d,
        work: pr.work, travel: pr.travel, meanForce: pr.travel > 0 ? pr.work / pr.travel : 0,
        springBack: pr.springBack ?? 0, pullForce: pr.pullForce, snagged: pr.snagged, overTop: pr.overTop,
        heightAfter: pr.heightAfter, stopReason: pr.stopReason,
      };
    });
    return {
      peakForce: overall.peak.F,
      peakAt: overall.peak.d,
      initialPeak: a0.initial ? a0.initial.F : null,
      initialPeakAt: a0.initial ? a0.initial.d : null,
      meanForce: this.travel > 0 ? this.work / this.travel : 0,
      work: this.work,
      travel: this.travel,
      finalHeight: this.currentHeight(),
      initialHeight: this.initialHeight,
      volume0: this.v0,
      volume: vol,
      volumeReduction: 1 - vol / this.v0,
      springBack: this.springBack ?? 0,
      stages,
      plasticWork: s.plasticWork,
      stopReason: this.stopReason,
      dentForce: this.dentForce || 0,
      steps: s.steps,
      wallTimeMs: this.wallTime,
      massScaleEffective: s.massScaled / s.massPhysical,
    };
  }
}

function firstIndexOfStage(stage, k) {
  for (let i = 0; i < stage.length; i++) if (stage[i] >= k) return i;
  return stage.length;
}

/**
 * Peak and first-buckle force of the samples [i0, i1). The first buckle is the
 * first local maximum of the smoothed force followed by a drop of >= 15 %.
 * Travel positions are reported relative to `d0`.
 */
export function analyseCurve(d, F, i0, i1, d0 = 0) {
  const sub = F.slice(i0, i1);
  const n = sub.length;
  const sm = smoothSeries(sub, 5);
  let initial = null;
  for (let i = 1; i < n; i++) {
    if (sm[i] < sm[i - 1]) continue;
    let j = i + 1, mn = sm[i];
    while (j < n && sm[j] <= sm[i]) { mn = Math.min(mn, sm[j]); if (mn < 0.85 * sm[i]) break; j++; }
    if (j < n && mn < 0.85 * sm[i] && sm[i] > 20) { initial = { F: sm[i], d: d[i0 + i] - d0 }; break; }
  }
  let pk = 0;
  for (let i = 0; i < n; i++) if (sm[i] > sm[pk]) pk = i;
  return { initial, peak: { F: n ? sm[pk] : 0, d: n ? d[i0 + pk] - d0 : 0 } };
}

/** Centered moving average with half-width w samples. */
export function smoothSeries(a, w) {
  const n = a.length, out = new Array(n);
  let sum = 0, lo = 0, hi = -1;
  for (let i = 0; i < n; i++) {
    const L = Math.max(0, i - w), R = Math.min(n - 1, i + w);
    while (hi < R) sum += a[++hi];
    while (lo < L) sum -= a[lo++];
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}

export { CAN_PRESETS };
