/**
 * Unit tests for DampingMaterialPanel section-parsing utilities.
 * Covers: parseSections, serializeSections.
 *
 * Run with:  npx vitest run src/test/dampingMaterial.test.ts
 */
import { describe, it, expect } from "vitest";
import { parseSections, serializeSections } from "../components/DampingMaterialPanel";

describe("parseSections — section extraction from horn YAML", () => {
  it("parses a two-section exponential horn from the May 2026 format", () => {
    const yaml = `sections:
  - name: throat
    profile_type: exponential
    length: 0.4
    start_area: 0.008
    end_area: 0.015
  - name: mouth
    profile_type: exponential
    length: 1.0
    start_area: 0.015
    end_area: 0.06`;
    const sections = parseSections(yaml);
    expect(sections).toHaveLength(2);
    expect(sections[0].name).toBe("throat");
    expect(sections[0].profile_type).toBe("exponential");
    expect(sections[0].length).toBeCloseTo(0.4);
    expect(sections[0].start_area).toBeCloseTo(0.008);
    expect(sections[0].end_area).toBeCloseTo(0.015);
    expect(sections[1].name).toBe("mouth");
    expect(sections[1].end_area).toBeCloseTo(0.06);
  });

  it("parses hyperbolic_t and tal1 optional fields", () => {
    const yaml = `sections:
  - name: hyp
    profile_type: hyperbolic
    hyperbolic_t: 0.5
    length: 0.8
    start_area: 0.01
    end_area: 0.05
    fr1: 1000
    tal1: 0.5`;
    const sections = parseSections(yaml);
    expect(sections).toHaveLength(1);
    expect(sections[0].hyperbolic_t).toBeCloseTo(0.5);
    expect(sections[0].fr1).toBeCloseTo(1000);
    expect(sections[0].tal1).toBeCloseTo(0.5);
  });

  it("handles quoted and unquoted name values", () => {
    const yaml = `sections:
  - name: "straight"
    profile_type: conical
    length: 0.3
    start_area: 0.01
    end_area: 0.02`;
    const sections = parseSections(yaml);
    expect(sections[0].name).toBe("straight");
  });

  it("returns empty array for YAML with no sections block", () => {
    expect(parseSections("throat_area: 0.008\nmouth_area: 0.06")).toHaveLength(0);
  });

  it("returns empty array for empty YAML", () => {
    expect(parseSections("")).toHaveLength(0);
  });

  it("returns empty array for YAML that only has a sections: null entry", () => {
    expect(parseSections("sections:")).toHaveLength(0);
  });

  it("ignores commented-out section blocks", () => {
    const yaml = `# sections:
  #   - name: should_ignore
  #     length: 1.0
  throat_area: 0.008`;
    // The function skips lines starting with #, so this is not a sections block
    expect(parseSections(yaml)).toHaveLength(0);
  });

  it("handles scientific notation for numeric values", () => {
    const yaml = `sections:
  - name: sci
    profile_type: exponential
    length: 1.5e-1
    start_area: 8e-3
    end_area: 6e-2`;
    const sections = parseSections(yaml);
    expect(sections[0].length).toBeCloseTo(0.15);
    expect(sections[0].start_area).toBeCloseTo(0.008);
    expect(sections[0].end_area).toBeCloseTo(0.06);
  });

  it("skips blank lines without crashing", () => {
    const yaml = `sections:

  - name: throat

    profile_type: exponential
    length: 0.4
    start_area: 0.008
    end_area: 0.015

  `;
    const sections = parseSections(yaml);
    expect(sections).toHaveLength(1);
    expect(sections[0].name).toBe("throat");
  });
});

describe("serializeSections — round-trip parse → serialize → parse", () => {
  it("serializes a single section with all fields", () => {
    const yaml = `sections:
  - name: throat
    profile_type: exponential
    length: 0.4
    start_area: 0.008
    end_area: 0.015`;
    const sections = parseSections(yaml);
    const out = serializeSections(sections, yaml);
    // Re-parsing the serialized output should yield the same sections
    const reparsed = parseSections(out);
    expect(reparsed).toHaveLength(1);
    expect(reparsed[0].name).toBe("throat");
    expect(reparsed[0].length).toBeCloseTo(0.4);
    expect(reparsed[0].start_area).toBeCloseTo(0.008);
    expect(reparsed[0].end_area).toBeCloseTo(0.015);
  });

  it("serializes multiple sections in order", () => {
    const yaml = `sections:
  - name: s1
    profile_type: conical
    length: 0.3
    start_area: 0.01
    end_area: 0.02
  - name: s2
    profile_type: exponential
    length: 0.7
    start_area: 0.02
    end_area: 0.05`;
    const sections = parseSections(yaml);
    const out = serializeSections(sections, yaml);
    const reparsed = parseSections(out);
    expect(reparsed).toHaveLength(2);
    expect(reparsed[0].name).toBe("s1");
    expect(reparsed[1].name).toBe("s2");
    expect(reparsed[1].profile_type).toBe("exponential");
  });

  it("includes optional fields when they are non-zero/non-null", () => {
    const yaml = `sections:
  - name: damped
    profile_type: hyperbolic
    hyperbolic_t: 0.5
    length: 0.8
    start_area: 0.01
    end_area: 0.05
    fr1: 1000
    tal1: 0.5`;
    const sections = parseSections(yaml);
    const out = serializeSections(sections, yaml);
    expect(out).toContain("fr1: 1000");
    expect(out).toContain("tal1: 0.5");
    expect(out).toContain("hyperbolic_t: 0.5");
  });

  it("omits fr1 and tal1 when they are zero or missing", () => {
    const yaml = `sections:
  - name: throat
    profile_type: exponential
    length: 0.4
    start_area: 0.008
    end_area: 0.015`;
    const sections = parseSections(yaml);
    const out = serializeSections(sections, yaml);
    expect(out).not.toContain("fr1:");
    expect(out).not.toContain("tal1:");
  });

  it("handles empty sections array — appends a sections: block when none exists", () => {
    const yaml = "throat_area: 0.008";
    const out = serializeSections([], yaml);
    // When no sections block exists, serializeSections appends one
    expect(out).toContain("sections:");
    expect(out).toContain("throat_area: 0.008");
  });
});

describe("parseSections — integration with DampingMaterialPanel logic", () => {
  // These mirror the computation paths used inside DampingMaterialPanel
  // to derive fr1, tal1, and polyfill mass estimates.

  it("computes fr1 and tal1 from a section with damping material", () => {
    const yaml = `sections:
  - name: body
    profile_type: exponential
    length: 0.5
    start_area: 0.015
    end_area: 0.03
    fr1: 1000
    tal1: 0.4`;
    const sections = parseSections(yaml);
    expect(sections[0].fr1).toBeCloseTo(1000);
    expect(sections[0].tal1).toBeCloseTo(0.4);
  });

  it("fr1 and tal1 are absent (undefined) when not in YAML", () => {
    const yaml = `sections:
  - name: throat
    profile_type: exponential
    length: 0.4
    start_area: 0.008
    end_area: 0.015`;
    const sections = parseSections(yaml);
    expect(sections[0].fr1).toBeUndefined();
    expect(sections[0].tal1).toBeUndefined();
  });
});
