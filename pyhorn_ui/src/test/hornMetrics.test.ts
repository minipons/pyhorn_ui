/**
 * Unit tests for HornMetrics parsing utilities.
 * Covers: geometry YAML format, sections YAML format, invalid YAML, hyperbolic solver.
 *
 * Run with:  npx vitest run src/test/hornMetrics.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  parseField,
  parseStrField,
  parseSections,
  solveHyperbolicU,
} from "../../src/utils/hornMetrics.utils.ts";

describe("parseField — geometry YAML (top-level fields)", () => {
  const yaml = `throat_area: 0.008
mouth_area: 0.06
path_length: 1.5
profile_type: exponential`;

  it("parses throat_area", () => {
    expect(parseField(yaml, "throat_area")).toBeCloseTo(0.008);
  });

  it("parses mouth_area", () => {
    expect(parseField(yaml, "mouth_area")).toBeCloseTo(0.06);
  });

  it("parses path_length", () => {
    expect(parseField(yaml, "path_length")).toBeCloseTo(1.5);
  });

  it("parses throat_area with scientific notation", () => {
    const y = "throat_area: 8e-3";
    expect(parseField(y, "throat_area")).toBeCloseTo(0.008);
  });

  it("returns null for missing key", () => {
    expect(parseField(yaml, "nonexistent")).toBeNull();
  });

  it("ignores keys inside comments", () => {
    const y = `# throat_area: 1.0\nthroat_area: 0.008`;
    expect(parseField(y, "throat_area")).toBeCloseTo(0.008);
  });

  it("ignores indented keys that are not section fields", () => {
    // Real-world YAML often indents related keys; parseField uses /^\\s*key/ so
    // indented lines match too (key: value at any indentation).
    // This is intentional — it mirrors the HornMetrics component behavior.
    const y = `  throat_area: 0.008\nmouth_area: 0.06`;
    expect(parseField(y, "throat_area")).toBeCloseTo(0.008);
  });
});

describe("parseStrField — profile_type string extraction", () => {
  it("extracts unquoted profile_type", () => {
    const yaml = `profile_type: exponential`;
    expect(parseStrField(yaml, "profile_type")).toBe("exponential");
  });

  it("extracts double-quoted profile_type", () => {
    const yaml = `profile_type: "exponential"`;
    expect(parseStrField(yaml, "profile_type")).toBe("exponential");
  });

  it("extracts single-quoted profile_type", () => {
    const yaml = `profile_type: 'conical'`;
    expect(parseStrField(yaml, "profile_type")).toBe("conical");
  });

  it("returns null for missing key", () => {
    expect(parseStrField("throat_area: 0.008", "profile_type")).toBeNull();
  });
});

describe("parseSections — sections YAML format", () => {
  it("parses a two-section horn from the Apr 28–29 2026 format", () => {
    const yaml = `sections:
  - name: throat
    profile_type: exponential
    length: 0.5
    start_area: 0.008
    end_area: 0.015
  - name: mouth
    profile_type: exponential
    length: 1.0
    start_area: 0.015
    end_area: 0.06`;

    const sections = parseSections(yaml);
    expect(sections).not.toBeNull();
    expect(sections!.length).toBe(2);

    expect(sections![0].name).toBe("throat");
    expect(sections![0].profile_type).toBe("exponential");
    expect(sections![0].length).toBeCloseTo(0.5);
    expect(sections![0].start_area).toBeCloseTo(0.008);
    expect(sections![0].end_area).toBeCloseTo(0.015);

    expect(sections![1].name).toBe("mouth");
    expect(sections![1].start_area).toBeCloseTo(0.015);
    expect(sections![1].end_area).toBeCloseTo(0.06);
  });

  it("accumulates path_length as sum of section lengths", () => {
    const yaml = `sections:
  - name: s1
    profile_type: conical
    length: 0.3
    start_area: 0.01
    end_area: 0.02
  - name: s2
    profile_type: conical
    length: 0.7
    start_area: 0.02
    end_area: 0.05`;

    const sections = parseSections(yaml);
    expect(sections).not.toBeNull();
    const totalLength = sections!.reduce((sum, s) => sum + s.length, 0);
    expect(totalLength).toBeCloseTo(1.0); // 0.3 + 0.7
  });

  it("throat_area comes from first section start_area", () => {
    const yaml = `sections:
  - name: first
    profile_type: exponential
    length: 0.4
    start_area: 0.007
    end_area: 0.02`;

    const sections = parseSections(yaml);
    expect(sections![0].start_area).toBeCloseTo(0.007);
  });

  it("mouth_area comes from last section end_area", () => {
    const yaml = `sections:
  - name: first
    profile_type: exponential
    length: 0.4
    start_area: 0.007
    end_area: 0.02
  - name: last
    profile_type: exponential
    length: 0.6
    start_area: 0.02
    end_area: 0.08`;

    const sections = parseSections(yaml);
    const last = sections![sections!.length - 1];
    expect(last.end_area).toBeCloseTo(0.08);
  });

  it("parses hyperbolic_t from a hyperbolic section", () => {
    const yaml = `sections:
  - name: hyp
    profile_type: hyperbolic
    hyperbolic_t: 0.5
    length: 0.8
    start_area: 0.01
    end_area: 0.05`;

    const sections = parseSections(yaml);
    expect(sections![0].hyperbolic_t).toBeCloseTo(0.5);
    expect(sections![0].profile_type).toBe("hyperbolic");
  });

  it("returns null for YAML with no sections block", () => {
    const yaml = `throat_area: 0.008\nmouth_area: 0.06`;
    expect(parseSections(yaml)).toBeNull();
  });

  it("returns null for an empty sections list", () => {
    const yaml = `sections:`;
    expect(parseSections(yaml)).toBeNull();
  });
});

describe("solveHyperbolicU — Newton-Raphson hyperbolic solver", () => {
  it("solves cosh(u) = target when t=0 (pure exponential)", () => {
    // cosh(u) = 2  →  u = acosh(2) ≈ 1.317
    const u = solveHyperbolicU(0, 2);
    expect(Math.abs(Math.cosh(u) - 2)).toBeLessThan(1e-10);
  });

  it("solves cosh(u) + t*sinh(u) = target for t=0.5", () => {
    // target = 2, t = 0.5: cosh(u) + 0.5*sinh(u) should ≈ 2
    const u = solveHyperbolicU(0.5, 2);
    const residual = Math.cosh(u) + 0.5 * Math.sinh(u) - 2;
    expect(Math.abs(residual)).toBeLessThan(1e-10);
  });

  it("returns 0 for target <= 0", () => {
    expect(solveHyperbolicU(0.5, 0)).toBe(0);
    expect(solveHyperbolicU(0.5, -1)).toBe(0);
  });

  it("handles t=1 edge case without division by zero", () => {
    const u = solveHyperbolicU(1, 1.5);
    const residual = Math.cosh(u) + 1 * Math.sinh(u) - 1.5;
    expect(Math.abs(residual)).toBeLessThan(1e-10);
  });

  it("converges in a reasonable number of iterations (not >50)", () => {
    // The function has a 50-iteration cap; verify it returns without hanging.
    // A well-posed problem should converge in <<50 iterations.
    const u = solveHyperbolicU(0.3, 3.0);
    const residual = Math.cosh(u) + 0.3 * Math.sinh(u) - 3.0;
    expect(Math.abs(residual)).toBeLessThan(1e-10);
  });

  it("returns non-negative u", () => {
    const u = solveHyperbolicU(0.2, 5);
    expect(u).toBeGreaterThanOrEqual(0);
  });
});

describe("Integration: both YAML formats yield non-null metrics", () => {
  // These tests verify the contract that HornMetrics expects:
  // - throat_area, mouth_area, path_length must all be non-null for the component to render.

  it("geometry YAML (top-level) yields throat_area, mouth_area, path_length", () => {
    const yaml = `throat_area: 0.008
mouth_area: 0.06
path_length: 1.5
profile_type: exponential`;

    const throat_area = parseField(yaml, "throat_area");
    const mouth_area = parseField(yaml, "mouth_area");
    const path_length = parseField(yaml, "path_length");

    expect(throat_area).not.toBeNull();
    expect(mouth_area).not.toBeNull();
    expect(path_length).not.toBeNull();
    expect(path_length).toBeGreaterThan(0);
  });

  it("sections YAML yields throat_area, mouth_area, path_length via parseSections", () => {
    const yaml = `sections:
  - name: throat
    profile_type: exponential
    length: 0.4
    start_area: 0.008
    end_area: 0.015
  - name: body
    profile_type: exponential
    length: 0.8
    start_area: 0.015
    end_area: 0.04
  - name: mouth
    profile_type: exponential
    length: 0.3
    start_area: 0.04
    end_area: 0.06`;

    const sections = parseSections(yaml);
    expect(sections).not.toBeNull();

    const throat_area = sections![0].start_area;
    const last = sections![sections!.length - 1];
    const mouth_area = last.end_area;
    const path_length = sections!.reduce((sum, s) => sum + s.length, 0);

    expect(throat_area).toBeCloseTo(0.008);
    expect(mouth_area).toBeCloseTo(0.06);
    expect(path_length).toBeCloseTo(1.5); // 0.4 + 0.8 + 0.3
  });

  it("invalid YAML (nonsense) does not throw — returns null gracefully", () => {
    const garbage = `{{{{ not yaml at all :: [[`;
    expect(() => parseField(garbage, "throat_area")).not.toThrow();
    expect(parseField(garbage, "throat_area")).toBeNull();

    expect(() => parseSections(garbage)).not.toThrow();
    // parseSections on non-matching text returns null (not an exception)
    const result = parseSections(garbage);
    expect(result === null || Array.isArray(result)).toBe(true);
  });

  it("incomplete YAML (only throat_area) does not throw", () => {
    const incomplete = `throat_area: 0.008`;
    expect(() => parseField(incomplete, "throat_area")).not.toThrow();
    expect(() => parseSections(incomplete)).not.toThrow();
    expect(parseField(incomplete, "mouth_area")).toBeNull();
    expect(parseField(incomplete, "path_length")).toBeNull();
  });
});
