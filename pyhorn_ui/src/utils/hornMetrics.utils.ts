// Pure parsing / math utilities extracted from HornMetrics.tsx for testability.
// These functions contain all the business logic; the component is a thin wrapper.

import yaml from "js-yaml";

export interface HornSection {
  name: string;
  profile_type: string;
  length: number;
  start_area: number;
  end_area: number;
  hyperbolic_t?: number;
}

/** Parse a numeric field from YAML text. Returns null if absent. */
export function parseField(yamlText: string, key: string): number | null {
  const regex = new RegExp(`^\\s*${key}\\s*:\\s*([\\d.e+-]+)`, "mi");
  const match = yamlText.match(regex);
  return match ? parseFloat(match[1]) : null;
}

/** Parse a string field from YAML text. Returns null if absent. */
export function parseStrField(yamlText: string, key: string): string | null {
  const regex = new RegExp(`^\\s*${key}\\s*:\\s*(.+)`, "mi");
  const match = yamlText.match(regex);
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
}

/**
 * Parse a `sections: [...]`-format YAML block using js-yaml for correctness.
 * Handles blank lines, comments, inline flow-style, and any field ordering.
 * Returns an array of HornSection objects, or null if no sections found.
 */
export function parseSections(text: string): HornSection[] | null {
  try {
    const doc = yaml.load(text) as Record<string, unknown>;
    const rawSections = doc?.sections;
    if (!Array.isArray(rawSections)) return null;

    const sections: HornSection[] = [];
    for (const item of rawSections) {
      if (typeof item !== "object" || item === null) continue;
      const sec = item as Record<string, unknown>;
      if (
        typeof sec.name === "string" &&
        typeof sec.length === "number" &&
        typeof sec.start_area === "number" &&
        typeof sec.end_area === "number"
      ) {
        sections.push({
          name: sec.name,
          profile_type: typeof sec.profile_type === "string" ? sec.profile_type : "exponential",
          length: sec.length,
          start_area: sec.start_area,
          end_area: sec.end_area,
          hyperbolic_t: typeof sec.hyperbolic_t === "number" ? sec.hyperbolic_t : undefined,
        });
      }
    }
    return sections.length > 0 ? sections : null;
  } catch {
    // Malformed YAML sections block — fall back gracefully
    return null;
  }
}

/**
 * Newton-Raphson solve of cosh(u) + t*sinh(u) = target for u.
 * Used to compute the hyperbolic horn expansion parameter m.
 */
export function solveHyperbolicU(t: number, target: number): number {
  if (target <= 0) return 0;
  if (t === 0) return Math.acosh(target);

  let u = Math.log(target); // initial guess
  for (let i = 0; i < 50; i++) {
    const ch = Math.cosh(u);
    const sh = Math.sinh(u);
    const f = ch + t * sh - target;
    const df = sh + t * ch;
    if (Math.abs(df) < 1e-15) break;
    const du = f / df;
    u -= du;
    if (Math.abs(du) < 1e-12) break;
  }
  return Math.max(0, u);
}
