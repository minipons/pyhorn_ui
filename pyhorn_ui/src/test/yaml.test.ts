import { describe, it, expect } from "vitest";

// Copy of parseYamlFloat from EditableHornSummary (flat + nested key support)
function parseYamlFloat(text: string, key: string): number | null {
  const lines = text.split("\n");
  let inBlock: string | null = null;

  for (const line of lines) {
    const idx = line.indexOf("#");
    const clean = idx >= 0 ? line.slice(0, idx) : line;

    // Track nested blocks
    if (clean.match(/^\s*rear_chamber\s*:/)) inBlock = "rear_chamber";
    else if (clean.match(/^\s*throat_chamber\s*:/)) inBlock = "throat_chamber";
    else if (clean.match(/^\s*throat_adapter\s*:/)) inBlock = "throat_adapter";
    else if (clean.match(/^\s*[^ ]/)) inBlock = null; // top-level key resets block

    // Flat key match (takes priority)
    const flatMatch = clean.match(new RegExp(`^\\s*${key}:\\s*([0-9eE.+\\-]+)`));
    if (flatMatch) return parseFloat(flatMatch[1]);

    // Nested key match: rear_chamber.vrc, throat_chamber.vtc, etc.
    if (inBlock !== null) {
      const nestedMatch = clean.match(new RegExp(`^\\s+${key}:\\s*([0-9eE.+\\-]+)`));
      if (nestedMatch) return parseFloat(nestedMatch[1]);
    }
  }
  return null;
}

// Copy of setYamlFloat from EditableHornSummary (strips nested, writes flat)
function setYamlFloat(text: string, key: string, value: number): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let inBlock: string | null = null;
  let flatFound = false;

  for (const line of lines) {
    const idx = line.indexOf("#");
    const clean = idx >= 0 ? line.slice(0, idx) : line;

    if (clean.match(/^\s*rear_chamber\s*:/)) inBlock = "rear_chamber";
    else if (clean.match(/^\s*throat_chamber\s*:/)) inBlock = "throat_chamber";
    else if (clean.match(/^\s*throat_adapter\s*:/)) inBlock = "throat_adapter";
    else if (clean.match(/^\s*[^ ]/)) inBlock = null;

    // Skip nested occurrence of this key
    if (inBlock !== null && !flatFound && clean.match(new RegExp(`^\\s+${key}:\\s*[0-9eE.+\\-]+`))) {
      continue; // drop
    }

    // Replace flat occurrence
    const flatRe = new RegExp(`^(\\s*${key}:\\s*)([0-9eE.+\\-]+)`);
    const flatMatch = clean.match(flatRe);
    if (flatMatch) {
      result.push(line.replace(flatRe, `${flatMatch[1]}${value}`));
      flatFound = true;
      continue;
    }

    result.push(line);
  }

  if (!flatFound) return text.trimEnd() + `\n${key}: ${value}`;
  return result.join("\n");
}

describe("parseYamlFloat — flat keys", () => {
  const yaml = `throat_area: 0.008
mouth_area: 0.06
path_length: 1.5
vrc: 0.0045
ang: 1.5707963267948966`;

  it("parses throat_area", () => {
    expect(parseYamlFloat(yaml, "throat_area")).toBeCloseTo(0.008);
  });
  it("parses mouth_area", () => {
    expect(parseYamlFloat(yaml, "mouth_area")).toBeCloseTo(0.06);
  });
  it("parses path_length", () => {
    expect(parseYamlFloat(yaml, "path_length")).toBeCloseTo(1.5);
  });
  it("parses vrc", () => {
    expect(parseYamlFloat(yaml, "vrc")).toBeCloseTo(0.0045);
  });
  it("ignores comments", () => {
    const yamlWithComment = `throat_area: 0.008 # this is the throat`;
    expect(parseYamlFloat(yamlWithComment, "throat_area")).toBeCloseTo(0.008);
  });
  it("returns null for missing key", () => {
    expect(parseYamlFloat(yaml, "nonexistent")).toBeNull();
  });
});

describe("parseYamlFloat — nested keys (old format)", () => {
  const yaml = `rear_chamber:
  vrc: 0.0045
  lrc: 0.1
throat_chamber:
  vtc: 0.00016
  atc: 0.008
throat_adapter:
  ap1: 12.5
  lpt: 25.0`;

  it("parses rear_chamber.vrc", () => {
    expect(parseYamlFloat(yaml, "vrc")).toBeCloseTo(0.0045);
  });
  it("parses rear_chamber.lrc", () => {
    expect(parseYamlFloat(yaml, "lrc")).toBeCloseTo(0.1);
  });
  it("parses throat_chamber.vtc", () => {
    expect(parseYamlFloat(yaml, "vtc")).toBeCloseTo(0.00016);
  });
  it("parses throat_chamber.atc", () => {
    expect(parseYamlFloat(yaml, "atc")).toBeCloseTo(0.008);
  });
  it("parses throat_adapter.ap1", () => {
    expect(parseYamlFloat(yaml, "ap1")).toBeCloseTo(12.5);
  });
  it("parses throat_adapter.lpt", () => {
    expect(parseYamlFloat(yaml, "lpt")).toBeCloseTo(25.0);
  });
});

describe("parseYamlFloat — flat takes priority over nested", () => {
  const yaml = `throat_area: 0.008
vrc: 0.1
rear_chamber:
  vrc: 0.0045`;

  it("prefers flat key over nested", () => {
    expect(parseYamlFloat(yaml, "vrc")).toBeCloseTo(0.1); // flat wins
  });
});

describe("setYamlFloat — writes flat, strips nested", () => {
  it("updates existing flat key", () => {
    const yaml = `throat_area: 0.008\nvrc: 0.0045`;
    const result = setYamlFloat(yaml, "vrc", 0.005);
    expect(result).toContain("vrc: 0.005");
    expect(result).not.toContain("vrc: 0.0045");
  });

  it("adds key when not present", () => {
    const yaml = `throat_area: 0.008`;
    const result = setYamlFloat(yaml, "vrc", 0.005);
    expect(result).toContain("vrc: 0.005");
  });

  it("strips nested occurrence when writing flat", () => {
    const yaml = `rear_chamber:\n  vrc: 0.0045`;
    const result = setYamlFloat(yaml, "vrc", 0.005);
    expect(result).toContain("vrc: 0.005");
    expect(result).not.toContain("0.0045");
  });
});

describe("roundtrip: setYamlFloat(parseYamlFloat)", () => {
  it("roundtrips vrc correctly", () => {
    const original = `throat_area: 0.008\nvrc: 0.0045\nlrc: 0.1`;
    const parsed = parseYamlFloat(original, "vrc");
    expect(parsed).toBeCloseTo(0.0045);
    const output = setYamlFloat(original, "vrc", parsed!);
    expect(parseYamlFloat(output, "vrc")).toBeCloseTo(0.0045);
  });

  it("roundtrips throat_adapter.ap1 correctly", () => {
    const original = `throat_adapter:\n  ap1: 12.5\n  lpt: 25.0`;
    const parsed = parseYamlFloat(original, "ap1");
    expect(parsed).toBeCloseTo(12.5);
    const output = setYamlFloat(original, "ap1", parsed!);
    expect(parseYamlFloat(output, "ap1")).toBeCloseTo(12.5);
  });
});
