// Two-press design study: a first crusher (many shapes/sizes), retracted while
// the can is held on the bed, then a large flat platen that flattens what is left.
//   node tools/study-two-stage.mjs [resolution] [only=key1,key2] [jobs=4]
// Writes docs/two-stage-study.json and docs/two-stage-study.md
import { fork } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CrushScenario, smoothSeries } from '../src/physics/scenario.js';
import { UI_DEFAULTS, uiToParams } from '../src/sim/strategies.js';

// First-press candidates (UI units: mm, degrees). The can lies on its side
// unless tilt says otherwise; "across" means the tool's long side crosses
// the can's axis, "along" means it runs along the can.
export const CANDIDATES = [
  { key: 'plate-full', name: 'Full flat plate (single press, reference)', over: { tilt: 90, tool: 'plate', plateW: 100, plateL: 160, plateT: 20, rod: 18, gap: 8 }, single: true },
  { key: 'blade3-across', name: '3 mm plate, 50 mm wide, across the middle, no rod', over: { tilt: 90, tool: 'plate', plateW: 160, plateL: 50, plateT: 3, rod: 0, gap: 8 } },
  { key: 'plate20-across', name: '20 mm plate, 50 mm wide, across the middle, no rod', over: { tilt: 90, tool: 'plate', plateW: 160, plateL: 50, plateT: 20, rod: 0, gap: 8 } },
  { key: 'block40-across', name: '40 mm block, 50 mm wide, across the middle', over: { tilt: 90, tool: 'plate', plateW: 160, plateL: 50, plateT: 40, rod: 18, gap: 8 } },
  { key: 'block40-across-g20', name: '40 mm block, 50 mm wide, across, stop at 20 mm', over: { tilt: 90, tool: 'plate', plateW: 160, plateL: 50, plateT: 40, rod: 18, gap: 20 } },
  { key: 'blade20x30-across', name: '20 mm wide × 30 mm tall blade across the middle', over: { tilt: 90, tool: 'plate', plateW: 160, plateL: 20, plateT: 30, rod: 18, gap: 8 } },
  { key: 'bar20-across', name: 'Ø20 round bar across the middle', over: { tilt: 90, tool: 'bar', barD: 20, barL: 160, rod: 0, gap: 8 } },
  { key: 'bar10-across', name: 'Ø10 round bar across the middle', over: { tilt: 90, tool: 'bar', barD: 10, barL: 160, rod: 0, gap: 8 } },
  { key: 'bar30-across', name: 'Ø30 round bar across the middle', over: { tilt: 90, tool: 'bar', barD: 30, barL: 160, rod: 0, gap: 8 } },
  { key: 'bar20-across-g20', name: 'Ø20 round bar across the middle, stop at 20 mm', over: { tilt: 90, tool: 'bar', barD: 20, barL: 160, rod: 0, gap: 20 } },
  { key: 'bar40-across', name: 'Ø40 round bar across the middle', over: { tilt: 90, tool: 'bar', barD: 40, barL: 160, rod: 0, gap: 8 } },
  { key: 'bar20-along', name: 'Ø20 round bar along the can', over: { tilt: 90, tool: 'bar', barD: 20, barL: 160, yaw: 90, rod: 0, gap: 8 } },
  { key: 'plate30-along', name: '30 mm wide × 20 mm plate along the can', over: { tilt: 90, tool: 'plate', plateW: 30, plateL: 160, plateT: 20, rod: 0, gap: 8 } },
  { key: 'topdown-tilt15', name: 'Top-down, can tilted 15°, full plate to 25 mm', over: { tilt: 15, tool: 'plate', plateW: 100, plateL: 100, plateT: 20, rod: 18, gap: 25 } },
];

function paramsFor(c, res) {
  const p = uiToParams({ ...UI_DEFAULTS, res, ...c.over });
  if (!c.single) p.secondPress = { enabled: true, size: 0.16, finalGap: 0.006 };
  return p;
}

/** Platen force needed to bring it down to each height (from the stage-2 curve). */
function forceAtHeights(h, F, stage, stageIdx, heights) {
  const idx = [];
  for (let i = 0; i < stage.length; i++) if (stage[i] === stageIdx) idx.push(i);
  if (!idx.length) return {};
  const sm = smoothSeries(idx.map((i) => F[i]), 5);
  const out = {};
  for (const H of heights) {
    let maxF = 0, reached = false;
    for (let k = 0; k < idx.length; k++) {
      maxF = Math.max(maxF, sm[k]);
      if (h[idx[k]] * 1000 <= H) { reached = true; break; }
    }
    out[H] = reached ? maxF : null;
  }
  return out;
}

if (process.argv[2] === '--child') {
  process.on('message', ({ params }) => {
    const sc = new CrushScenario(params);
    while (!sc.advance(500)) { /* run */ }
    const h = sc.history;
    process.send({ summary: sc.summary(), hist: { d: h.d, F: h.F, h: h.h, stage: h.stage } });
    process.exit(0);
  });
} else {
  const res = process.argv[2] || 'coarse';
  const onlyArg = process.argv.find((a) => a.startsWith('only='));
  const only = onlyArg ? onlyArg.slice(5).split(',') : null;
  const jobsArg = process.argv.find((a) => a.startsWith('jobs='));
  const jobs = jobsArg ? +jobsArg.slice(5) : 4;
  const list = CANDIDATES.filter((c) => !only || only.includes(c.key));
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
      const s = r.summary;
      if (s) console.log(`${c.key.padEnd(20)} press1 peak ${s.stages[0].peakForce.toFixed(0)} N, pull ${s.stages[0].pullForce.toFixed(0)} N${s.stages[0].snagged ? ' SNAGGED' : ''}, final ${(s.finalHeight * 1000).toFixed(1)} mm  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
      else console.log(`${c.key}: ${r.error}`);
    }
  }));
  const rows = results.filter((r) => r.summary).map(({ c, summary: s, hist }) => {
    const p1 = s.stages[0], p2 = s.stages[1] || null;
    const at = p2 ? forceAtHeights(hist.h, hist.F, hist.stage, 1, [20, 15, 10]) : forceAtHeights(hist.h, hist.F, hist.stage, 0, [20, 15, 10]);
    return {
      key: c.key, name: c.name, single: !!c.single, res,
      press1: { start: p1.initialPeak, peak: p1.peakForce, work: p1.work, pullForce: p1.pullForce, snagged: p1.snagged, overTop: p1.overTop, heightAfter: p1.heightAfter * 1000 },
      press2: p2 ? { peak: p2.peakForce, work: p2.work, heightAfter: p2.heightAfter * 1000, stopReason: p2.stopReason } : null,
      flattenForce: at,
      finalHeight: s.finalHeight * 1000, volumeReduction: s.volumeReduction,
      totalWork: s.work, maxForce: s.peakForce,
    };
  });
  rows.sort((a, b) => CANDIDATES.findIndex((c) => c.key === a.key) - CANDIDATES.findIndex((c) => c.key === b.key));
  const outDir = new URL('../docs/', import.meta.url);
  mkdirSync(outDir, { recursive: true });
  const tag = only ? `-${res}-subset` : `-${res}`;
  writeFileSync(new URL(`two-stage-study${tag}.json`, outDir), JSON.stringify(rows, null, 1));
  const f = (v) => (v === null || v === undefined ? '—' : Math.round(v).toLocaleString('en-US'));
  let md = `| First press | Press 1 peak (N) | Pull-out on retract (N) | Metal on top of tool | Platen force to 20 / 15 / 10 mm (N) | Final height (mm) | Total energy (J) |\n|---|---|---|---|---|---|---|\n`;
  for (const r of rows) {
    const snag = r.press1.snagged ? `${f(r.press1.pullForce)} (stuck)` : f(r.press1.pullForce);
    md += `| ${r.name} | ${f(r.press1.peak)} | ${r.single ? '—' : snag} | ${r.single ? '—' : r.press1.overTop ? 'yes' : 'no'} | ${f(r.flattenForce[20])} / ${f(r.flattenForce[15])} / ${f(r.flattenForce[10])} | ${r.finalHeight.toFixed(1)} | ${r.totalWork.toFixed(0)} |\n`;
  }
  writeFileSync(new URL(`two-stage-study${tag}.md`, outDir), md);
  console.log('\n' + md);
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
