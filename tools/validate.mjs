// Print the validation table: solver vs closed-form shell mechanics.
//   npm run validate
import { ringCrush, tubeBuckling } from './benchmarks.mjs';

const rows = [];
const t0 = Date.now();
const ring = ringCrush({ t: 1e-4, travel: 0.008, v: 0.01 });
rows.push(['Elastic ring crush stiffness (t = 0.1 mm)', `${ring.kTheory.toFixed(0)} N/m`, `${ring.kSecant.toFixed(0)} N/m`, ring.kSecant / ring.kTheory]);
const ringP = ringCrush({ t: 1e-3, travel: 0.014, v: 0.03 });
rows.push(['Plastic ring collapse load 4 M_p L / R (t = 1 mm)', `${ringP.Pc.toFixed(0)} N`, `${ringP.F.toFixed(0)} N`, ringP.F / ringP.Pc]);
const perfect = tubeBuckling({ imperfection: 0.01e-3 });
rows.push(['Axial buckling of the can wall, near-perfect', `${perfect.classical.toFixed(0)} N`, `${perfect.peak.toFixed(0)} N`, perfect.knockdown]);
for (const imp of [0.05e-3, 0.1e-3]) {
  const r = tubeBuckling({ imperfection: imp });
  rows.push([`Axial buckling, ${imp * 1000} mm random imperfection`, `${r.classical.toFixed(0)} N`, `${r.peak.toFixed(0)} N`, r.knockdown]);
}
console.log('| Benchmark | Theory | Simulation | Ratio |\n|---|---|---|---|');
for (const [a, b, c, d] of rows) console.log(`| ${a} | ${b} | ${c} | ${d.toFixed(2)} |`);
console.log(`\n(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
