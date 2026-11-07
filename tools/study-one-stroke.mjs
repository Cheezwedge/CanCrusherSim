// One-stroke combined head (spring-loaded crease bar inside a slotted flat
// platen) vs the two-press sequence (crease bar, retract, flat platen).
//   node tools/study-one-stroke.mjs [resolution] [jobs=4]
import { fork } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CrushScenario, smoothSeries } from '../src/physics/scenario.js';
import { UI_DEFAULTS, uiToParams } from '../src/sim/strategies.js';

const HEIGHTS = [25, 20, 15, 12];
export const CASES = [
  { key: 'two-press', name: 'Two presses: Ø20 bar, retract, flat platen', twoPress: true },
  { key: 'combo-p30', name: 'One stroke: bar 30 mm below slotted platen, spring 300→450 N', combo: { protrusion: 0.030, preload: 300, fullForce: 450 } },
  { key: 'combo-p45', name: 'One stroke: bar 45 mm below slotted platen, spring 300→450 N', combo: { protrusion: 0.045, preload: 300, fullForce: 450 } },
  { key: 'combo-p45-soft', name: 'One stroke: bar 45 mm below, spring 200→300 N', combo: { protrusion: 0.045, preload: 200, fullForce: 300 } },
];

function paramsFor(c, res) {
  const p = uiToParams({ ...UI_DEFAULTS, res, tilt: 90, tool: 'bar', barD: 20, barL: 160, rod: 0, gap: 8 });
  if (c.twoPress) p.secondPress = { enabled: true, size: 0.16, finalGap: 0.006, shape: 'flat' };
  else p.presses = [{ tool: p.tool, finalGap: 0.006, label: 'combined head', combo: c.combo }];
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
  const jobsArg = process.argv.find((a) => a.startsWith('jobs='));
  const jobs = jobsArg ? +jobsArg.slice(5) : 4;
  const self = fileURLToPath(import.meta.url);
  const t0 = Date.now();
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (next < CASES.length) {
      const c = CASES[next++];
      const r = await new Promise((resolve) => {
        const child = fork(self, ['--child']);
        child.on('message', (m) => resolve({ c, ...m }));
        child.on('exit', (code) => { if (code) resolve({ c, error: `exit ${code}` }); });
        child.send({ params: paramsFor(c, res) });
      });
      results.push(r);
      console.log(`${c.key} done (${((Date.now() - t0) / 1000).toFixed(0)} s)${r.error ? ' ' + r.error : ''}`);
    }
  }));
  const rows = results.filter((r) => r.summary).map(({ c, summary: s, hist }) => {
    const sm = smoothSeries(hist.F, 5);
    const at = {};
    for (const H of HEIGHTS) {
      let mx = 0, ok = false;
      // only the flattening press counts towards thickness (stage 1 for two presses)
      const stage = c.twoPress ? 1 : 0;
      for (let i = 0; i < sm.length; i++) {
        if (hist.stage[i] !== stage) { if (hist.stage[i] < stage) mx = Math.max(mx, sm[i]); continue; }
        mx = Math.max(mx, sm[i]);
        if (hist.canH[i] * 1000 <= H) { ok = true; break; }
      }
      at[H] = ok ? mx : null;
    }
    return { key: c.key, name: c.name, res, forceToThickness: at, totalWork: s.work, finalThickness: s.finalHeight * 1000, strokes: c.twoPress ? 2 : 1, springMax: s.stages[0].springMax };
  });
  rows.sort((a, b) => CASES.findIndex((c) => c.key === a.key) - CASES.findIndex((c) => c.key === b.key));
  mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
  writeFileSync(new URL(`../docs/one-stroke-${res}.json`, import.meta.url), JSON.stringify(rows, null, 1));
  const f = (v) => (v === null || v === undefined ? '—' : Math.round(v).toLocaleString('en-US'));
  let md = `| Design | Strokes | Peak press force to reach ${HEIGHTS.join(' / ')} mm (N) | Energy (J) | Final thickness (mm) |\n|---|---|---|---|---|\n`;
  for (const r of rows) md += `| ${r.name} | ${r.strokes} | ${HEIGHTS.map((H) => f(r.forceToThickness[H])).join(' / ')} | ${r.totalWork.toFixed(0)} | ${r.finalThickness.toFixed(1)} |\n`;
  writeFileSync(new URL(`../docs/one-stroke-${res}.md`, import.meta.url), md);
  console.log('\n' + md + `\ndone in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
