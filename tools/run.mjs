// CLI: run one crush scenario headless and print the force-displacement curve.
// usage: node tools/run.mjs '{"tiltDeg":0,"resolution":"coarse"}' [--every 2] [--json out.json]
import { CrushScenario } from '../src/physics/scenario.js';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const params = args[0] && args[0].startsWith('{') ? JSON.parse(args[0]) : {};
const every = Number(args[args.indexOf('--every') + 1]) || 2; // mm between printed samples
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const sc = new CrushScenario(params);
const s = sc.solver;
console.log(`nodes ${s.N} tris ${s.T} hinges ${s.H} dt ${(s.dt * 1e6).toFixed(2)} us, mass x${(s.massScaled / s.massPhysical).toFixed(0)}, ~${sc.estimatedSteps()} steps, stroke ${(sc.stroke * 1000).toFixed(1)} mm`);
const t0 = performance.now();
let lastPrint = -1;
while (!sc.advance(200)) {
  const h = sc.history;
  const n = h.d.length;
  if (n && h.d[n - 1] * 1000 >= lastPrint + every) {
    lastPrint = Math.floor(h.d[n - 1] * 1000);
    console.log(`d ${(h.d[n - 1] * 1000).toFixed(1).padStart(6)} mm  F ${h.F[n - 1].toFixed(1).padStart(8)} N  W ${h.W[n - 1].toFixed(2).padStart(6)} J  v ${sc.vCur.toFixed(3)}  pairs ${s.nPairs}  KE ${(h.ke[n-1]*1000).toFixed(3)} mJ  t ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }
}
const sum = sc.summary();
console.log(JSON.stringify(sum, (k, v) => (typeof v === 'number' ? Number(v.toPrecision(5)) : v), 1));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ params: sc.params, summary: sum, history: sc.history }));
