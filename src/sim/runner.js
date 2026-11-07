// Simulation runner shared by the Web Worker and the main-thread fallback.
// Protocol (messages in):  start {id, params, headless}, preview {id, params},
//   pause, resume, stop, ack
// Messages out: init, frame, progress, done, error

import { CrushScenario } from '../physics/scenario.js';

export function createRunner(post, { sliceMs = 30 } = {}) {
  let sc = null;
  let id = 0;
  let running = false;
  let headless = false;
  let frameWanted = true;
  let histSent = 0;
  let timer = null;
  let lastProgressPost = 0;

  const yieldToEvents = (fn) => setTimeout(fn, 0);

  function positionsMm() {
    const x = sc.solver.x;
    const out = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) out[i] = x[i] * 1000;
    return out;
  }

  function live() {
    const h = sc.history;
    const n = h.F.length;
    let Fnow = 0;
    if (n) {
      let s = 0, c = 0;
      for (let i = Math.max(0, n - 4); i < n; i++) { s += h.F[i]; c++; }
      Fnow = s / c;
    }
    return {
      force: Fnow,
      travel: sc.travel * 1000,
      work: sc.work,
      peak: sc.peak.F,
      toolY: sc.tool.py * 1000,
      height: sc.currentHeight() * 1000,
      progress: sc.progress(),
      phase: sc.phase,
      simTime: sc.solver.time,
      steps: sc.solver.steps,
      speed: sc.vCur,
      wallTime: sc.wallTime,
      aux: auxMm(),
      stage: sc.stage,
      stages: sc.presses.length,
      pressLabel: sc.presses[sc.stage].label,
    };
  }

  function auxMm() {
    const a = sc.auxTools();
    if (!a) return null;
    const mm = (o) => o && { ...o, x: o.x * 1000, y: o.y * 1000, z: o.z * 1000, d: o.d ? o.d * 1000 : undefined };
    return { active: a.active, ball: mm(a.ball), backstop: mm(a.backstop), dentForce: a.dentForce };
  }

  function histDelta() {
    const h = sc.history;
    const n = h.d.length;
    const d = new Float32Array(n - histSent), F = new Float32Array(n - histSent), st = new Uint8Array(n - histSent);
    for (let i = histSent; i < n; i++) { d[i - histSent] = h.d[i] * 1000; F[i - histSent] = h.F[i]; st[i - histSent] = h.stage[i]; }
    histSent = n;
    return { d, F, s: st };
  }

  function toolMm() {
    const t = sc.activeTool();
    return { ...t, x: t.x * 1000, y: t.y * 1000, z: t.z * 1000 };
  }

  let stageSent = 0;
  function sendFrame() {
    const pos = positionsMm();
    const strain = sc.solver.nodePlasticStrain();
    const hist = histDelta();
    const msg = { type: 'frame', id, positions: pos, strain, hist, live: live() };
    if (sc.stage !== stageSent) { stageSent = sc.stage; msg.tool = toolMm(); }
    post(msg, [pos.buffer, strain.buffer, hist.d.buffer, hist.F.buffer, hist.s.buffer]);
  }

  function finish() {
    running = false;
    const summary = sc.summary();
    const h = sc.history;
    const msg = {
      type: 'done', id, summary,
      history: { d: Float32Array.from(h.d, (v) => v * 1000), F: Float32Array.from(h.F), s: Uint8Array.from(h.stage) },
      live: live(),
      tool: toolMm(),
    };
    const transfer = [msg.history.d.buffer, msg.history.F.buffer, msg.history.s.buffer];
    if (!headless) {
      msg.positions = positionsMm();
      msg.strain = sc.solver.nodePlasticStrain();
      transfer.push(msg.positions.buffer, msg.strain.buffer);
    }
    post(msg, transfer);
  }

  function loop() {
    timer = null;
    if (!running || !sc) return;
    const t0 = performance.now();
    let done = false;
    try {
      while (performance.now() - t0 < sliceMs) {
        if (sc.advance(40)) { done = true; break; }
      }
    } catch (err) {
      running = false;
      post({ type: 'error', id, message: String(err && err.message || err) });
      return;
    }
    if (done) { finish(); return; }
    if (headless) {
      const now = performance.now();
      if (now - lastProgressPost > 400) {
        lastProgressPost = now;
        post({ type: 'progress', id, live: live() });
      }
    } else if (frameWanted) {
      frameWanted = false;
      sendFrame();
    }
    timer = yieldToEvents(loop);
  }

  function start(msg) {
    if (timer) clearTimeout(timer);
    running = false;
    id = msg.id;
    headless = !!msg.headless;
    frameWanted = true;
    histSent = 0;
    stageSent = 0;
    try {
      sc = new CrushScenario(msg.params);
    } catch (err) {
      post({ type: 'error', id, message: String(err && err.message || err) });
      return;
    }
    const s = sc.solver;
    if (!headless) {
      const tris = Int32Array.from(s.tris);
      const uv = Float32Array.from(sc.mesh.uv);
      const pos = positionsMm();
      post({
        type: 'init', id,
        mesh: { tris, uv, positions: pos, nNodes: s.N },
        tool: { ...sc.tool.describe(), x: sc.tool.px * 1000, y: sc.tool.py * 1000, z: sc.tool.pz * 1000 },
        can: sc.spec,
        info: {
          nodes: s.N, triangles: s.T, hinges: s.H,
          dt: s.dt, massScale: s.massScaled / s.massPhysical,
          initialHeight: sc.initialHeight * 1000, stroke: sc.stroke * 1000,
          canMass: s.massPhysical * 1000, volume: sc.v0 * 1e6,
          axis: sc.axis,
        },
      }, [tris.buffer, uv.buffer, pos.buffer]);
    }
    if (msg.preview) return; // geometry only; wait for 'resume'
    running = true;
    timer = yieldToEvents(loop);
  }

  return function handle(msg) {
    switch (msg.type) {
      case 'start': start(msg); break;
      case 'preview': start({ ...msg, preview: true, headless: false }); break;
      case 'pause': running = false; if (timer) { clearTimeout(timer); timer = null; } break;
      case 'resume': if (sc && !sc.done && !running) { running = true; timer = yieldToEvents(loop); } break;
      case 'stop': running = false; if (timer) { clearTimeout(timer); timer = null; } sc = null; break;
      case 'ack': frameWanted = true; break;
      default: break;
    }
  };
}
