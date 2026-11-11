// Low-profile crusher tool study: can a flat platen with a FIXED crease rib do
// the job in one stroke, or as press 1 of two (rib press, then flat press)?
//   node tools/study-rib-platen.mjs [resolution]
import { fork } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CrushScenario, smoothSeries } from '../src/physics/scenario.js';
import { UI_DEFAULTS, uiToParams } from '../src/sim/strategies.js';

const HEIGHTS = [25, 20, 15, 12];
const rigid = (P) => ({ protrusion: P, preload: 1e6, fullForce: 2e6 });
export const CASES = [
  { key: 'flat-1', name: 'One stroke: plain flat platen', flat: true },
  { key: 'rib10-1', name: 'One stroke: flat platen with fixed 10 mm rib', combo: rigid(0.010), gap: 0.006 },
  { key: 'rib20-1', name: 'One stroke: flat platen with fixed 20 mm rib', combo: rigid(0.020), gap: 0.006 },
  { key: 'rib10-2', name: 'Two strokes: 10 mm rib platen to 22 mm, then flat', combo: rigid(0.010), gap: 0.022, second: true },
  { key: 'rib20-2', name: 'Two strokes: 20 mm rib platen to 28 mm, then flat', combo: rigid(0.020), gap: 0.028, second: true },
  { key: 'bar-2', name: 'Two strokes: bare Ø20 bar to 8 mm, then flat (reference)', bar: true },
];
function paramsFor(c, res) {
  const p = uiToParams({ ...UI_DEFAULTS, res, tilt: 90, tool: c.flat ? 'plate' : 'bar', plateW: 160, plateL: 160, barD: 20, barL: 160, rod: 0, gap: 6 });
  if (c.combo) p.presses = [{ tool: p.tool, finalGap: c.gap, label: 'rib platen', combo: c.combo }];
  if (c.bar) p.finalGap = 0.008;
  if (c.second || c.bar) p.secondPress = { enabled: true, size: 0.16, finalGap: 0.006, shape: 'flat' };
  return p;
}
if (process.argv[2] === '--child') {
  process.on('message', ({ params }) => {
    const sc = new CrushScenario(params);
    while (!sc.advance(500)) { /* run */ }
    const h = sc.history;
    process.send({ summary: sc.summary(), hist: { F: h.F, stage: h.stage, canH: h.canH } });
    process.exit(0);
  });
} else {
  const res = process.argv[2] || 'standard';
  const self = fileURLToPath(import.meta.url);
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < CASES.length) {
      const c = CASES[next++];
      results.push(await new Promise((resolve) => {
        const child = fork(self, ['--child']);
        child.on('message', (m) => resolve({ c, ...m }));
        child.on('exit', (code) => { if (code) resolve({ c, error: code }); });
        child.send({ params: paramsFor(c, res) });
      }));
    }
  }));
  const rows = results.filter((r) => r.summary).map(({ c, summary: s, hist }) => {
    const sm = smoothSeries(hist.F, 5);
    const at = {};
    for (const H of HEIGHTS) {
      let mx = 0, ok = false;
      for (let i = 0; i < sm.length; i++) { mx = Math.max(mx, sm[i]); if (hist.canH[i] * 1000 <= H) { ok = true; break; } }
      at[H] = ok ? Math.round(mx) : null;
    }
    return { key: c.key, name: c.name, res, peakForceToThickness: at, stages: s.stages.map((t) => ({ label: t.label, peak: Math.round(t.peakForce), pull: Math.round(t.pullForce), snagged: t.snagged })), work: +s.work.toFixed(1), final: +(s.finalHeight * 1000).toFixed(1) };
  });
  rows.sort((a, b) => CASES.findIndex((c) => c.key === a.key) - CASES.findIndex((c) => c.key === b.key));
  writeFileSync(new URL(`../docs/rib-platen-${res}.json`, import.meta.url), JSON.stringify(rows, null, 1));
  for (const r of rows) console.log(r.name.padEnd(58), HEIGHTS.map((H) => r.peakForceToThickness[H] ?? '—').join(' / '), '| press1', r.stages[0].peak, 'pull', r.stages[0].pull, r.stages[0].snagged ? 'SNAG' : '', '| J', r.work, '| final', r.final);
}
