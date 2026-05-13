import { describe, it, expect } from "vitest";
import yaml from "js-yaml";

// Copy of the validateYaml function from App.tsx
function validateYaml(yamlText: string): string | null {
  if (!yamlText.trim()) return null; // empty is fine
  try {
    yaml.load(yamlText);
    return null;
  } catch (e: unknown) {
    return e instanceof Error ? e.message : "Invalid YAML";
  }
}

describe("validateYaml — valid YAML", () => {
  it("parses a valid driver YAML", () => {
    const valid = `fs: 49.6
qts: 0.27
qes: 0.28
qms: 7.88
vas: 0.0369
re: 7.8`;
    expect(validateYaml(valid)).toBeNull();
  });

  it("parses a valid horn YAML", () => {
    const valid = `ang: 1.5707963267948966
vrc: 0.0045
lrc: 0.1
profile_type: "hyperbolic"
n_segments: 50
throat_area: 0.008
mouth_area: 0.06
path_length: 1.5
hyperbolic_t: 0.3`;
    expect(validateYaml(valid)).toBeNull();
  });

  it("parses a minimal but valid YAML", () => {
    expect(validateYaml("key: value")).toBeNull();
    expect(validateYaml("a: 1\nb: 2")).toBeNull();
  });
});

describe("validateYaml — invalid YAML", () => {
  it("detects duplicate keys", () => {
    const dup = `fs: 49.6
fs: 50.0`;
    const result = validateYaml(dup);
    expect(result).not.toBeNull();
    expect(typeof result).toBe("string");
  });

  it("detects malformed YAML (bad indentation)", () => {
    const bad = `key:
  nested: value
 bad_indent: whoops`;
    const result = validateYaml(bad);
    expect(result).not.toBeNull();
  });

  it("detects unclosed strings", () => {
    const bad = `profile_type: "hyperbolic
path_length: 1.5`;
    const result = validateYaml(bad);
    expect(result).not.toBeNull();
  });

  it("detects a tab character used for indentation (invalid in YAML 1.2)", () => {
    const bad = `key:\n\tvalue: 1`;
    const result = validateYaml(bad);
    expect(result).not.toBeNull();
  });

  it("returns a string error message (not an Error object)", () => {
    const bad = `fs: [1, 2`;
    const result = validateYaml(bad);
    expect(result).not.toBeNull();
    expect(typeof result).toBe("string");
    expect(result!.length).toBeGreaterThan(0);
  });
});

describe("validateYaml — empty YAML", () => {
  it("returns null for empty string", () => {
    expect(validateYaml("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(validateYaml("   \n\n  ")).toBeNull();
  });

  it("returns null for newline-only string", () => {
    expect(validateYaml("\n\n")).toBeNull();
  });
});
