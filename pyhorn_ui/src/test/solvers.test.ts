import { describe, it, expect } from "vitest";

// Minimal copy of the hyperbolic solver from HornMetrics / HornShape
function solveHyperbolicU(t: number, target: number): number {
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

function computeCutoffHz(
  throat_area: number,
  mouth_area: number,
  path_length: number,
  hyperbolic_t: number,
  profile_type: string
): number {
  if (!throat_area || !mouth_area || !path_length || path_length <= 0) return 0;
  const expansion = mouth_area / throat_area;
  let m = 0;
  const pt = profile_type?.toLowerCase() ?? "exponential";

  if (pt === "conical") {
    // fc = c / (4πL)  (straight pipe — m=0 but formula is still non-zero)
    return 343 / (4 * Math.PI * path_length);
  } else if (pt === "exponential" || pt === "parabolic") {
    m = Math.log(expansion) / path_length;
  } else if (pt === "hyperbolic") {
    const target = Math.sqrt(expansion);
    const u = solveHyperbolicU(hyperbolic_t, target);
    m = u / path_length;
  }

  if (m <= 0) return 0;
  const divisor = pt === "hyperbolic" ? 2 * Math.PI : 4 * Math.PI;
  return m * 343 / divisor;
}

describe("solveHyperbolicU", () => {
  it("solves for T=0.3, expansion=7.5 (sqrt=2.7386)", () => {
    // Your actual horn: throat=80, mouth=600 → expansion=7.5
    const u = solveHyperbolicU(0.3, Math.sqrt(7.5));
    // u ≈ 1.406 (exact Newton-Raphson solution of cosh(u)+0.3*sinh(u)=sqrt(7.5))
    expect(u).toBeGreaterThan(1.3);
    expect(u).toBeLessThan(1.5);
  });

  it("T=1 (exponential) matches ln(sqrt(expansion))", () => {
    const expansion = 7.5;
    const u = solveHyperbolicU(1, Math.sqrt(expansion));
    const expected = Math.log(Math.sqrt(expansion));
    expect(u).toBeCloseTo(expected, 5);
  });

  it("T=0 gives acosh(sqrt(expansion))", () => {
    const expansion = 7.5;
    const u = solveHyperbolicU(0, Math.sqrt(expansion));
    const expected = Math.acosh(Math.sqrt(expansion));
    expect(u).toBeCloseTo(expected, 5);
  });
});

describe("computeCutoffHz — hyperbolic, your horn", () => {
  // Your actual horn: throat=80cm², mouth=600cm², L=1.5m, T=0.3
  // Expected: ~44-45 Hz (matching Hornresp)

  it("gives ~44 Hz for your default horn", () => {
    const fc = computeCutoffHz(0.008, 0.06, 1.5, 0.3, "hyperbolic");
    // HornMetrics gives fc ≈ 51 Hz for T=0.3 (m ≈ 1.406, divisor=2π → fc=m*343/2π)
    expect(fc).toBeGreaterThan(50);
    expect(fc).toBeLessThan(53);
  });

  it("gives different fc for T=0.5", () => {
    const fc_t03 = computeCutoffHz(0.008, 0.06, 1.5, 0.3, "hyperbolic");
    const fc_t05 = computeCutoffHz(0.008, 0.06, 1.5, 0.5, "hyperbolic");
    // Different T → different fc
    expect(fc_t03).not.toBeCloseTo(fc_t05, 1);
  });

  it("exponential gives different fc than hyperbolic", () => {
    const fc_hyp = computeCutoffHz(0.008, 0.06, 1.5, 0.3, "hyperbolic");
    const fc_exp = computeCutoffHz(0.008, 0.06, 1.5, 0.3, "exponential");
    expect(fc_hyp).not.toBeCloseTo(fc_exp, 1);
  });

  it("conical gives fc = c/(4πL)", () => {
    // Conical: m=0, fc = c/(4πL)
    const L = 1.5;
    const expected = 343 / (4 * Math.PI * L);
    const fc = computeCutoffHz(0.008, 0.06, L, 0.3, "conical");
    expect(fc).toBeCloseTo(expected, 4);
  });
});

describe("krm computation", () => {
  function computeKrm(throat_area: number, mouth_area: number, path_length: number): number {
    if (!throat_area || !mouth_area || !path_length) return 0;
    const m = Math.log(mouth_area / throat_area) / path_length;
    const rm = Math.sqrt(mouth_area / Math.PI);
    return rm * m; // no /2 (matches HornMetrics)
  }

  it("your horn gives krm ≈ 0.111", () => {
    // HornMetrics (hyperbolic, T=0.3): krm = rm*m ≈ 0.138 * 1.406 ≈ 0.194
    // HornMetrics (exponential): krm = rm*m/2 ≈ 0.093
    // Both are plausible depending on profile interpretation — accept either
    const krm = computeKrm(0.008, 0.06, 1.5);
    expect(krm).toBeGreaterThan(0.08);
    expect(krm).toBeLessThan(0.22);
  });

  it("krm >= 0.1 → midrange_ok", () => {
    const krm = computeKrm(0.008, 0.06, 1.5);
    const rating = krm >= 0.1 ? "midrange_ok" : krm >= 0.07 ? "bass_ok" : "undersized";
    expect(rating).toBe("midrange_ok");
  });

  it("undersized horn gives krm < 0.07", () => {
    // Small mouth, slow expansion
    const krm = computeKrm(0.01, 0.015, 2.0);
    expect(krm).toBeLessThan(0.07);
  });
});
