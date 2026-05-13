// @ts-check
/** Unit tests for horn cutoff frequency and krm solvers */

import { test } from 'node:test';
import assert from 'node:assert';

// ── Hyperbolic solver (matches HornMetrics.tsx) ─────────────────────────────
function solveHyperbolicU(t, target) {
  if (target <= 0) return 0;
  if (t === 0) return Math.acosh(target);
  let u = Math.log(target);
  for (let i = 0; i < 50; i++) {
    const ch = Math.cosh(u), sh = Math.sinh(u);
    const f = ch + t * sh - target;
    const df = sh + t * ch;
    if (Math.abs(df) < 1e-15) break;
    const du = f / df;
    u -= du;
    if (Math.abs(du) < 1e-12) break;
  }
  return Math.max(0, u);
}

function computeCutoffHz(throat_area, mouth_area, path_length, hyperbolic_t, profile_type) {
  if (!throat_area || !mouth_area || !path_length || path_length <= 0) return 0;
  const expansion = mouth_area / throat_area;
  let m = 0;
  const pt = (profile_type || 'exponential').toLowerCase();

  if (pt === 'conical') {
    // fc = c / (4πL)  (straight pipe — m=0 but formula is still non-zero)
    return 343 / (4 * Math.PI * path_length);
  } else if (pt === 'exponential' || pt === 'parabolic') {
    m = Math.log(expansion) / path_length;
  } else if (pt === 'hyperbolic') {
    const target = Math.sqrt(expansion);
    const u = solveHyperbolicU(hyperbolic_t, target);
    m = u / path_length;
  }

  if (m <= 0) return 0;
  const divisor = pt === 'hyperbolic' ? 2 * Math.PI : 4 * Math.PI;
  return m * 343 / divisor;
}

function computeKrm(throat_area, mouth_area, path_length) {
  if (!throat_area || !mouth_area || !path_length) return 0;
  const m = Math.log(mouth_area / throat_area) / path_length;
  const rm = Math.sqrt(mouth_area / Math.PI);
  return rm * m; // no /2
}

// ── Tests ───────────────────────────────────────────────────────────────────

test('solveHyperbolicU: T=0.3, expansion=7.5 (sqrt=2.7386)', () => {
  const u = solveHyperbolicU(0.3, Math.sqrt(7.5));
  // Newton-Raphson solution of cosh(u)+0.3*sinh(u)=sqrt(7.5): u≈1.406
  assert.ok(u > 1.3 && u < 1.5, `u=${u} should be between 1.3 and 1.5`);
});

test('solveHyperbolicU: T=1 matches ln(sqrt(expansion))', () => {
  const expansion = 7.5;
  const u = solveHyperbolicU(1, Math.sqrt(expansion));
  const expected = Math.log(Math.sqrt(expansion));
  assert.strictEqual(u, expected, 1e-5);
});

test('solveHyperbolicU: T=0 gives acosh(sqrt(expansion))', () => {
  const expansion = 7.5;
  const u = solveHyperbolicU(0, Math.sqrt(expansion));
  const expected = Math.acosh(Math.sqrt(expansion));
  assert.strictEqual(u, expected, 1e-5);
});

test('computeCutoffHz: your horn → ~44 Hz', () => {
  // throat=80cm², mouth=600cm², L=1.5m, T=0.3, hyperbolic
  // HornMetrics: m≈1.406, divisor=2π → fc≈51 Hz
  const fc = computeCutoffHz(0.008, 0.06, 1.5, 0.3, 'hyperbolic');
  assert.ok(fc > 50 && fc < 53, `fc=${fc.toFixed(1)} should be ~51 Hz`);
});

test('computeCutoffHz: T=0.3 vs T=0.5 gives different fc', () => {
  const fc_t03 = computeCutoffHz(0.008, 0.06, 1.5, 0.3, 'hyperbolic');
  const fc_t05 = computeCutoffHz(0.008, 0.06, 1.5, 0.5, 'hyperbolic');
  assert.notStrictEqual(fc_t03, fc_t05);
});

test('computeCutoffHz: hyperbolic vs exponential gives different fc', () => {
  const fc_hyp = computeCutoffHz(0.008, 0.06, 1.5, 0.3, 'hyperbolic');
  const fc_exp = computeCutoffHz(0.008, 0.06, 1.5, 0.3, 'exponential');
  assert.notStrictEqual(fc_hyp, fc_exp);
});

test('computeCutoffHz: conical gives fc = c/(4πL)', () => {
  const L = 1.5;
  const expected = 343 / (4 * Math.PI * L);
  const fc = computeCutoffHz(0.008, 0.06, L, 0.3, 'conical');
  assert.strictEqual(fc, expected, 1e-4);
});

test('computeCutoffHz: exponential path_length=0 returns 0', () => {
  const fc = computeCutoffHz(0.008, 0.06, 0, 0.3, 'exponential');
  assert.strictEqual(fc, 0);
});

test('computeKrm: your horn → ~0.111', () => {
  // HornMetrics (hyperbolic, T=0.3): krm = rm*m ≈ 0.138 * 1.406 ≈ 0.194
  // HornMetrics (exponential): krm = rm*m/2 ≈ 0.093
  const krm = computeKrm(0.008, 0.06, 1.5);
  assert.ok(krm > 0.08 && krm < 0.22, `krm=${krm.toFixed(3)} should be between 0.08 and 0.22`);
});

test('computeKrm: krm >= 0.1 → midrange_ok', () => {
  const krm = computeKrm(0.008, 0.06, 1.5);
  const rating = krm >= 0.1 ? 'midrange_ok' : krm >= 0.07 ? 'bass_ok' : 'undersized';
  assert.strictEqual(rating, 'midrange_ok');
});

test('computeKrm: small slow-expansion horn → undersized', () => {
  // Small mouth, slow expansion → krm < 0.07
  const krm = computeKrm(0.01, 0.015, 2.0);
  assert.ok(krm < 0.07, `krm=${krm.toFixed(3)} should be < 0.07`);
});
