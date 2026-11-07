// Per-stroke force of a two-station (progressive) press: the crease bar works a
// fresh can while the flat platen flattens the previously creased can, both on
// the same crosshead. Runs the bar -> platen sequence once and adds the two
// force curves at equal crosshead position. Writes docs/progressive-forces.json
//   node tools/progressive-forces.mjs [resolution]
import { writeFileSync } from 'node:fs';
import { CrushScenario } from '../src/physics/scenario.js';
import { UI_DEFAULTS, uiToParams } from '../src/sim/strategies.js';

const res = process.argv[2] || 'standard';
const p = uiToParams({ ...UI_DEFAULTS, res, tilt: 90, tool: 'bar', barD: 20, barL: 160, rod: 0, gap: 8 });
p.secondPress = { enabled: true, size: 0.16, finalGap: 0.008, shape: 'flat' };
const sc = new CrushScenario(p);
while (!sc.advance(500)) { /* run */ }
const h = sc.history;
const curve = (k) => {
  const out = [];
  for (let i = 0; i < h.d.length; i++) if (h.stage[i] === k) out.push([h.h[i] * 1000, h.F[i], h.canH[i] * 1000]);
  return out;
};
const bar = curve(0), platen = curve(1);
// force at a given tool-face height (mm above the base plate top), each curve
const at = (c, z) => {
  let best = null;
  for (const [hz, F] of c) if (best === null || Math.abs(hz - z) < Math.abs(best[0] - z)) best = [hz, F];
  return best && Math.abs(best[0] - z) < 0.6 ? Math.max(0, best[1]) : 0;
};
const zs = [];
for (let z = 90; z >= 8; z -= 0.5) zs.push(+z.toFixed(1));
const combined = zs.map((z) => ({ z, bar: at(bar, z), platen: at(platen, z), total: at(bar, z) + at(platen, z) }));
const s = sc.summary();
writeFileSync(new URL('../docs/progressive-forces.json', import.meta.url), JSON.stringify({ res, combined, creasedHeight: s.stages[0].heightAfter * 1000, finalThickness: s.finalHeight * 1000 }, null, 0));
let peak = combined.reduce((m, r) => (r.total > m.total ? r : m), combined[0]);
console.log(`creased can height ${(s.stages[0].heightAfter * 1000).toFixed(1)} mm, final ${(s.finalHeight * 1000).toFixed(1)} mm, peak combined ${peak.total.toFixed(0)} N at z=${peak.z} mm`);
for (const z of [60, 40, 30, 25, 20, 16, 12, 10, 8]) { const r = combined.find((q) => q.z === z); if (r) console.log(`z ${z}: bar ${r.bar.toFixed(0)} + platen ${r.platen.toFixed(0)} = ${r.total.toFixed(0)} N`); }
