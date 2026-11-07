// Benchmarks against closed-form shell mechanics (a few seconds each).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ringCrush, tubeBuckling } from '../tools/benchmarks.mjs';

test('elastic ring crush stiffness is close to the ring formula (0.1488 P R^3 / EI)', () => {
  const r = ringCrush({ t: 1e-4, travel: 0.008, v: 0.01 });
  // secant stiffness between 4 and 8 mm of flattening
  const ratio = r.kSecant / r.kTheory;
  assert.ok(ratio > 0.7 && ratio < 1.15, `stiffness ratio ${ratio.toFixed(2)}`);
});

test('plastic ring collapse reaches 4 M_p / R', () => {
  const r = ringCrush({ t: 1e-3, travel: 0.014, v: 0.03 });
  const ratio = r.F / r.Pc;
  assert.ok(ratio > 0.9 && ratio < 1.25, `collapse load ratio ${ratio.toFixed(2)}`);
});

test('nearly perfect can wall buckles at the classical load; real imperfections knock it down', () => {
  const perfect = tubeBuckling({ imperfection: 0.01e-3 });
  assert.ok(perfect.knockdown > 0.85 && perfect.knockdown < 1.1, `perfect knockdown ${perfect.knockdown.toFixed(2)}`);
  const real = tubeBuckling({ imperfection: 0.1e-3 });
  assert.ok(real.knockdown > 0.35 && real.knockdown < 0.7, `imperfect knockdown ${real.knockdown.toFixed(2)}`);
});
