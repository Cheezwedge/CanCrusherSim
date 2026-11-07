// Second-press platen shape study. First press: Ø20 round bar across the
// middle of a can lying on its side (stops 8 mm above the bed), retracted;
// then platens of different shapes. Reports the platen force needed to get the
// can (its thickest point, under load) down to 25 / 20 / 15 / 12 mm.
//   node tools/study-platen-shapes.mjs [resolution] [only=key1,key2] [jobs=4]
import { fork } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CrushScenario, smoothSeries } from '../src/physics/scenario.js';
import { UI_DEFAULTS, uiToParams } from '../src/sim/strategies.js';

export const PLATENS = [
  { key: 'flat', name: 'Flat', sp: { shape: 'flat' } },
  { key: 'convex400', name: 'Curved, bulging down (R 400 mm)', sp: { shape: 'convex', radius: 0.4 } },
  { key: 'convex250', name: 'Curved, bulging down (R 250 mm)', sp: { shape: 'convex', radius: 0.25 } },
  { key: 'concave400', name: 'Curved, dished up (R 400 mm)', sp: { shape: 'concave', radius: 0.4 } },
  { key: 'roof5', name: 'Roof / V pointing down (5°)', sp: { shape: 'roof', angleDeg: 5 } },
  { key: 'valley5', name: 'Valley / V pointing up (5°)', sp: { shape: 'valley', angleDeg: 5 } },
  { key: 'tilt8', name: 'Flat, tilted 8° (one end first)', sp: { shape: 'tilt', angleDeg: 8 } },
  { key: 'hinge', name: 'Hinged clamshell (pivot past one end)', sp: { shape: 'hinge' } },
];
const HEIGHTS = [25, 20, 15, 12];

function paramsFor(c, res) {
  const p = uiToParams({ ...UI_DEFAULTS, res, tilt: 90, tool: 'bar', barD: 20, barL: 160, rod: 0, gap: 8 });
  p.secondPress = { enabled: true, size: 0.16, finalGap: 0.006, ...c.sp };
  return p;
}

if (process.argv[2] === '--child') {
  process.on('message', ({ params }) => {
    const sc = new CrushScenario(params);
    while (!sc.advance(500)) { /* run */ }
    const h = sc.history;
    process.send({ summary: sc.summary(), hist: { d: h.d, F: h.F, stage: h.stage, canH: h.canH } });
    process.exit(0);
  });
} else {
  const res = process.argv[2] || 'coarse';
  const onlyArg = process.argv.find((a) => a.startsWith('only='));
  const only = onlyArg ? onlyArg.slice(5).split(',') : null;
  const jobsArg = process.argv.find((a) => a.startsWith('jobs='));
  const jobs = jobsArg ? +jobsArg.slice(5) : 4;
  const list = PLATENS.filter((c) => !only || only.includes(c.key));
  const self = fileURLToPath(import.meta.url);
  const t0 = Date.now();
  const results = [];
  let next = 0;
  const runOne = (c) => new Promise((resolve) => {
    const child = fork(self, ['--child']);
    child.on('message', (m) => resolve({ c, ...m }));
    child.on('exit', (code) => { if (code) resolve({ c, error: `exit ${code}` }); });
    child.send({ params: paramsFor(c, res) });
  });
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (next < list.length) {
      const c = list[next++];
      const r = await runOne(c);
      results.push(r);
      console.log(`${c.key.padEnd(11)} done (${((Date.now() - t0) / 1000).toFixed(0)} s)${r.error ? ' ' + r.error : ''}`);
    }
  }));
  const rows = results.filter((r) => r.summary).map(({ c, summary: s, hist }) => {
    const idx = [];
    for (let i = 0; i < hist.stage.length; i++) if (hist.stage[i] === 1) idx.push(i);
    const sm = smoothSeries(idx.map((i) => hist.F[i]), 5);
    const at = {};
    let minH = Infinity;
    for (const H of HEIGHTS) {
      let mx = 0, ok = false;
      for (let k = 0; k < idx.length; k++) {
        mx = Math.max(mx, sm[k]);
        if (hist.canH[idx[k]] * 1000 <= H) { ok = true; break; }
      }
      at[H] = ok ? mx : null;
    }
    for (const i of idx) minH = Math.min(minH, hist.canH[i] * 1000);
    const st = s.stages[1];
    return {
      key: c.key, name: c.name, res, forceToThickness: at, minLoadedThickness: minH,
      platenPeak: st.peakForce, platenWork: st.work, finalThickness: s.finalHeight * 1000, stopReason: st.stopReason,
      press1Peak: s.stages[0].peakForce,
    };
  });
  rows.sort((a, b) => PLATENS.findIndex((c) => c.key === a.key) - PLATENS.findIndex((c) => c.key === b.key));
  mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
  const tag = only ? `-${res}-subset` : `-${res}`;
  writeFileSync(new URL(`../docs/platen-shapes${tag}.json`, import.meta.url), JSON.stringify(rows, null, 1));
  const f = (v) => (v === null || v === undefined ? '—' : Math.round(v).toLocaleString('en-US'));
  let md = `| Platen | Force to get the can to ${HEIGHTS.join(' / ')} mm thick (N) | Thinnest under load (mm) | Platen energy (J) | Thickness after release (mm) |\n|---|---|---|---|---|\n`;
  for (const r of rows) md += `| ${r.name} | ${HEIGHTS.map((H) => f(r.forceToThickness[H])).join(' / ')} | ${r.minLoadedThickness.toFixed(1)} | ${r.platenWork.toFixed(0)} | ${r.finalThickness.toFixed(1)} |\n`;
  writeFileSync(new URL(`../docs/platen-shapes${tag}.md`, import.meta.url), md);
  console.log('\n' + md + `\ndone in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
