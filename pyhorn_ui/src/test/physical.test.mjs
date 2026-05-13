// @ts-check
/** Unit tests for physical.ts unit conversions — Node.js native test runner */

import { test } from 'node:test';
import assert from 'node:assert';

// ── Inline QUANTITIES (identical logic to physical.ts) ───────────────────────
const QUANTITIES = Object.create(null);
QUANTITIES.fs          = { si: "Hz",  unit: "Hz",  toDisplay: v => v,         parse: v => v,         fmt: v => `${v.toFixed(1)} Hz` };
// Round to N significant figures to eliminate floating-point noise from display-unit conversion
const roundToSigFigs = (v, n) => {
  if (v === 0) return 0;
  const d = Math.ceil(Math.log10(Math.abs(v)));
  return parseFloat(v.toPrecision(n + Math.max(0, d)));
};
QUANTITIES.vas         = { si: "m³",  unit: "L",   toDisplay: v => roundToSigFigs(v * 1000, 12), parse: v => roundToSigFigs(v / 1000, 12), fmt: v => `${(v * 1000).toFixed(1)} L` };
QUANTITIES.sd          = { si: "m²",  unit: "cm²", toDisplay: v => roundToSigFigs(v * 1e4, 12), parse: v => roundToSigFigs(v / 1e4, 12), fmt: v => `${(v * 1e4).toFixed(2)} cm²` };
QUANTITIES.mms         = { si: "kg",  unit: "g",   toDisplay: v => v * 1000, parse: v => v / 1000, fmt: v => `${(v * 1000).toFixed(2)} g` };
QUANTITIES.le          = { si: "H",   unit: "mH",  toDisplay: v => v * 1000, parse: v => v / 1000, fmt: v => `${(v * 1000).toFixed(2)} mH` };
QUANTITIES.xmax        = { si: "m",   unit: "mm",  toDisplay: v => v * 1000, parse: v => v / 1000, fmt: v => `${(v * 1000).toFixed(1)} mm` };
QUANTITIES.throat_area = { si: "m²",  unit: "cm²", toDisplay: v => v * 1e4, parse: v => v / 1e4, fmt: v => `${(v * 1e4).toFixed(2)} cm²` };
QUANTITIES.mouth_area  = { si: "m²",  unit: "cm²", toDisplay: v => v * 1e4, parse: v => v / 1e4, fmt: v => `${(v * 1e4).toFixed(0)} cm²` };
QUANTITIES.path_length = { si: "m",   unit: "cm",  toDisplay: v => v * 100,  parse: v => v / 100,  fmt: v => `${(v * 100).toFixed(1)} cm` };
QUANTITIES.vrc         = { si: "m³",  unit: "L",   toDisplay: v => v * 1e6,  parse: v => v / 1e6,  fmt: v => { const cm3 = v * 1e6; return cm3 >= 1000 ? `${(cm3/1000).toFixed(2)} L` : `${cm3.toFixed(1)} cm³`; } };
// Strip trailing zeros from a decimal string (e.g. "0.50" → "0.5", "2.00" → "2")
const normalizeDecimal = (s) => s.replace(/\.?0+$/, '') || '0';
QUANTITIES.ang         = { si: "rad", unit: "π",   toDisplay: v => v / Math.PI, parse: v => v * Math.PI, fmt: v => { const n = v / Math.PI; if (Math.abs(n - Math.round(n)) < 0.001) return `${Math.round(n)}π`; return `${normalizeDecimal(n.toFixed(4))}π`; } };
QUANTITIES.hyperbolic_t = { si: "—", unit: "—", toDisplay: v => v, parse: v => v, fmt: v => `${v.toFixed(4)}` };
QUANTITIES.qts         = { si: "—", unit: "—", toDisplay: v => v, parse: v => v, fmt: v => `${v.toFixed(3)}` };
QUANTITIES.re          = { si: "Ω",  unit: "Ω",  toDisplay: v => v, parse: v => v, fmt: v => `${v.toFixed(2)} Ω` };
QUANTITIES.bl          = { si: "N/A", unit: "N/A", toDisplay: v => v, parse: v => v, fmt: v => `${v.toFixed(2)} N/A` };
QUANTITIES.n_segments   = { si: "—", unit: "—", toDisplay: v => v, parse: v => v, fmt: v => `${v}` };

const fmt = (key, v) => {
  const entry = QUANTITIES[key];
  if (!entry) return String(v);
  return entry.fmt(v);
};
const toDisplay = (key, v) => {
  const entry = QUANTITIES[key];
  if (!entry) return v;
  return entry.toDisplay(v);
};
const parse = (key, v) => {
  const entry = QUANTITIES[key];
  if (!entry) return v;
  return entry.parse(v);
};

// ── Tests ───────────────────────────────────────────────────────────────────

test('vas: fmt 0.0369 m³ → "36.9 L"', () => {
  assert.strictEqual(fmt('vas', 0.0369), '36.9 L');
});
test('vas: toDisplay 0.0369 → 36.9', () => {
  assert.strictEqual(toDisplay('vas', 0.0369), 36.9);
});
test('vas: parse 36.9 → 0.0369 m³', () => {
  assert.strictEqual(parse('vas', 36.9), 0.0369);
});

test('sd: fmt 0.01327 m² → "132.70 cm²"', () => {
  assert.strictEqual(fmt('sd', 0.01327), '132.70 cm²');
});
test('sd: roundtrip 0.01327 → 132.7 → 0.01327', () => {
  const d = toDisplay('sd', 0.01327);
  assert.strictEqual(parse('sd', d), 0.01327);
});

test('throat_area: fmt 0.008 m² → "80.00 cm²"', () => {
  assert.strictEqual(fmt('throat_area', 0.008), '80.00 cm²');
});

test('mouth_area: fmt 0.06 m² → "600 cm²"', () => {
  assert.strictEqual(fmt('mouth_area', 0.06), '600 cm²');
});

test('path_length: fmt 1.5 m → "150.0 cm"', () => {
  assert.strictEqual(fmt('path_length', 1.5), '150.0 cm');
});
test('path_length: roundtrip 1.5 → 150 → 1.5', () => {
  const d = toDisplay('path_length', 1.5);
  assert.strictEqual(parse('path_length', d), 1.5);
});

test('vrc: fmt 0.0045 m³ (4.5L) → "4.50 L"', () => {
  assert.strictEqual(fmt('vrc', 0.0045), '4.50 L');
});
test('vrc: fmt 0.0001 m³ (100cm³) → "100.0 cm³"', () => {
  assert.strictEqual(fmt('vrc', 0.0001), '100.0 cm³');
});

test('ang: fmt 2π → "2π"', () => {
  assert.strictEqual(fmt('ang', 2 * Math.PI), '2π');
});
test('ang: fmt π/2 → "0.5π"', () => {
  assert.strictEqual(fmt('ang', Math.PI / 2), '0.5π');
});
test('ang: fmt π → "1π"', () => {
  assert.strictEqual(fmt('ang', Math.PI), '1π');
});
test('ang: toDisplay 2π → 2', () => {
  assert.strictEqual(toDisplay('ang', 2 * Math.PI), 2);
});
test('ang: parse 2 → 2π', () => {
  assert.strictEqual(parse('ang', 2), 2 * Math.PI);
});

test('fs: fmt stays Hz', () => {
  assert.strictEqual(fmt('fs', 49.6), '49.6 Hz');
  assert.strictEqual(toDisplay('fs', 49.6), 49.6);
});
test('re: fmt stays Ω', () => {
  assert.strictEqual(fmt('re', 7.8), '7.80 Ω');
});
test('qts: fmt stays dimensionless', () => {
  assert.strictEqual(fmt('qts', 0.27), '0.270');
});
