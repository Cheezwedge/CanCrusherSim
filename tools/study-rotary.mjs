// Rotary double-action crusher: one crank turn drives a crease bar and a slotted
// flat platen through two eccentrics at different phases. Simulates the can
// under that motion and reports crank torque vs angle.
//   node tools/study-rotary.mjs [resolution] ['{"rb":33,...}' ...variants]
import { fork } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CrushScenario, smoothSeries } from '../src/physics/scenario.js';
import { UI_DEFAULTS, uiToParams } from '../src/sim/strategies.js';

export const DESIGN = { rb: 40, Lb: 1e5, rp: 40, Lp: 150, phi: 120, barGap: 8, platenGap: 12, endDeg: 150 };
const RHO = 0.05; // reference radius: s = angle * RHO, so torque = F_gen * RHO
const rad = Math.PI / 180;
export const dsl = (r, L, a) => r * (1 - Math.cos(a)) + L - Math.sqrt(L * L - (r * Math.sin(a)) ** 2);
export const barEcc = (g, th) => g.barGap + dsl(g.rb, g.Lb, th * rad);
export const platenFace = (g, th) => g.platenGap + dsl(g.rp, g.Lp, (th - g.phi) * rad);
// The bar's rod drives the blade through a lost-motion slot: the blade follows
// its eccentric but can never sit behind the platen face (a stop keeps it flush).
export const barTip = (g, th) => Math.min(barEcc(g, th), platenFace(g, th));
/** Crank angles (deg) where a fresh can fits: bar tip and platen face both >= 68 mm. */
export function loadWindow(g) {
  const ok = [];
  for (let t = 0; t < 360; t += 1) if (barTip(g, t) >= 68) ok.push(t);
  return ok.length ? [ok[0], ok[ok.length - 1]] : null;
}

export function kinTable(g) {
  // start where the bar tip is 67.5 mm up, before bar top-dead-centre (theta = 0)
  // (search backwards from bar top-dead-centre so both tools start clear of the can)
  let t0 = 0;
  while (t0 > -179 && barTip(g, t0) < 67.5) t0 -= 0.25;
  const rows = [];
  for (let t = t0; t <= g.endDeg + 1e-9; t += 0.5) rows.push([(t - t0) * rad * RHO, barTip(g, t) / 1000, platenFace(g, t) / 1000]);
  return { t0, rows };
}

if (process.argv[2] === '--child') {
  process.on('message', ({ params }) => {
    const sc = new CrushScenario(params);
    while (!sc.advance(500)) { /* run */ }
    const h = sc.history;
    process.send({ summary: sc.summary(), hist: { s: h.s, F: h.F, Fb: h.Fb, Fp: h.Fp, yb: h.yb, yp: h.h, canH: h.canH } }, () => process.exit(0));
  });
} else {
  const res = process.argv[2] || 'standard';
  const variants = process.argv.slice(3).filter((a) => a.startsWith('{')).map((a) => ({ ...DESIGN, ...JSON.parse(a) }));
  if (!variants.length) variants.push(DESIGN);
  const self = fileURLToPath(import.meta.url);
  const summarise = ({ g, t0, summary, hist }) => {
    const T = smoothSeries(hist.F, 5).map((f) => f * RHO);
    const th = hist.s.map((sv) => t0 + sv / RHO / rad);
    const n = th.length;
    let pk = 0;
    for (let i = 0; i < n; i++) if (T[i] > T[pk]) pk = i;
    let iTdc = th.findIndex((t) => t >= g.phi);
    if (iTdc < 0) iTdc = n - 1;
    const work = hist.F.reduce((a, f, i) => a + (i ? f * (hist.s[i] - hist.s[i - 1]) : 0), 0);
    const curve = [];
    for (let i = 0; i < n; i += 5) curve.push({ deg: +th[i].toFixed(1), torque: +T[i].toFixed(2), bar: Math.round(hist.Fb[i]), platen: Math.round(hist.Fp[i]), tip: +(hist.yb[i] * 1000).toFixed(1), face: +(hist.yp[i] * 1000).toFixed(1), canH: +(hist.canH[i] * 1000).toFixed(1) });
    return { design: g, res, loadWindow: loadWindow(g), startDeg: +t0.toFixed(1), peakTorque: +T[pk].toFixed(1), peakTorqueDeg: +th[pk].toFixed(0), maxBarForce: Math.round(Math.max(...hist.Fb)), maxPlatenForce: Math.round(Math.max(...hist.Fp)), platenForceAtTdc: Math.round(hist.Fp[iTdc] ?? 0), thicknessAtTdc: +(hist.canH[iTdc] * 1000).toFixed(1), finalThickness: +(summary.finalHeight * 1000).toFixed(1), work: +work.toFixed(1), steps: summary.steps, curve };
  };
  const show = (r) => {
    console.log(JSON.stringify(r.design), 'load window', JSON.stringify(r.loadWindow));
    console.log(` peak torque ${r.peakTorque} N·m at ${r.peakTorqueDeg}°, bar max ${r.maxBarForce} N, platen max ${r.maxPlatenForce} N, thickness at TDC ${r.thicknessAtTdc} mm, final ${r.finalThickness} mm, work ${r.work} J, steps ${r.steps}`);
    console.log(' ' + r.curve.filter((c, i) => i % 4 === 0 && c.deg > -5 && c.deg < r.design.phi + 12).map((c) => `${Math.round(c.deg)}°:${Math.round(c.torque)}`).join(' '));
  };
  const results = (await Promise.all(variants.map((g) => new Promise((resolve) => {
    const { t0, rows } = kinTable(g);
    const p = uiToParams({ ...UI_DEFAULTS, res, tilt: 90, tool: 'bar', barD: 20, barL: 160, rod: 0 });
    p.release = false;
    p.presses = [{ tool: p.tool, finalGap: 0, label: 'rotary head', kin: { table: rows, slot: 0.022 } }];
    const child = fork(self, ['--child']);
    const timer = setTimeout(() => { console.log('TIMEOUT', JSON.stringify(g)); child.kill('SIGKILL'); resolve(null); }, 25 * 60 * 1000);
    child.on('message', (m) => { clearTimeout(timer); const r = summarise({ g, t0, ...m }); show(r); resolve(r); });
    child.on('exit', (c) => { if (c) { clearTimeout(timer); console.log('FAILED', c, JSON.stringify(g)); resolve(null); } });
    child.send({ params: p });
  })))).filter(Boolean);
  writeFileSync(new URL(`../docs/rotary-${res}${variants.length > 1 ? '-variants' : ''}.json`, import.meta.url), JSON.stringify(results));
}
