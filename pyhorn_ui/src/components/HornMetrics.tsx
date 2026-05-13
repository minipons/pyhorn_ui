import { useMemo } from "react";
import yaml from "js-yaml";

interface HornMetricsProps {
  hornYaml: string;
}

// ── Section type (mirrors HornShape.tsx) ──────────────────────────────────────
interface HornSection {
  name: string;
  profile_type: string;
  length: number;
  start_area: number;
  end_area: number;
  hyperbolic_t?: number;
}

// Parse a simple YAML key: value line (top-level scalar fields only)
function parseField(yamlText: string, key: string): number | null {
  const regex = new RegExp(`^\\s*${key}\\s*:\\s*([\\d.e+-]+)`, "mi");
  const match = yamlText.match(regex);
  return match ? parseFloat(match[1]) : null;
}

function parseStrField(yamlText: string, key: string): string | null {
  const regex = new RegExp(`^\\s*${key}\\s*:\\s*(.+)`, "mi");
  const match = yamlText.match(regex);
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
}

// ── sections format parser (chained profile sections — Apr 28–29 2026) ───────
// Replaced hand-rolled YAML line parser with js-yaml for correctness.
// Handles blank lines, comments, inline flow-style, and any field ordering.
function parseSections(text: string): HornSection[] | null {
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
    // If YAML parsing fails (malformed sections block), fall back gracefully
    return null;
  }
}

// Solve cosh(u) + t*sinh(u) = target using Newton-Raphson
function solveHyperbolicU(t: number, target: number): number {
  // Handle edge cases
  if (target <= 0) return 0;
  if (t === 0) return Math.acosh(target);

  // For t > 0, this is always solvable
  // Using f(u) = cosh(u) + t*sinh(u) - target
  // f'(u) = sinh(u) + t*cosh(u)
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

export default function HornMetrics({ hornYaml }: HornMetricsProps) {
  const metrics = useMemo(() => {
    // Guard against null/undefined hornYaml — without this, parseField throws
    if (!hornYaml) return null;

    // Prefer top-level fields (legacy coordinates format)
    let throat_area = parseField(hornYaml, "throat_area");
    let mouth_area = parseField(hornYaml, "mouth_area");
    let path_length = parseField(hornYaml, "path_length");
    let profile_type = parseStrField(hornYaml, "profile_type");
    let hyperbolic_t = parseField(hornYaml, "hyperbolic_t") ?? 0;

    // Fall back to sections format (chained profile sections — Apr 28–29 2026)
    if (throat_area == null || mouth_area == null || path_length == null) {
      const sections = parseSections(hornYaml);
      if (sections && sections.length > 0) {
        throat_area = sections[0].start_area;
        mouth_area = sections[sections.length - 1].end_area;
        path_length = sections.reduce((sum, s) => sum + s.length, 0);
        // Use the first section's profile type as the dominant type for metrics;
        // for mixed-section horns this is the throat section which sets loading behavior.
        profile_type = profile_type ?? (sections[0].profile_type ?? "exponential");
        // If hyperbolic_t wasn't at top level, check the first hyperbolic section.
        if (hyperbolic_t === 0) {
          const firstHyp = sections.find((s) => s.profile_type === "hyperbolic");
          hyperbolic_t = firstHyp?.hyperbolic_t ?? 0;
        }
      }
    }

    if (throat_area == null || mouth_area == null || path_length == null || path_length === 0) {
      return null;
    }

    const PI = Math.PI;
    const rt = Math.sqrt(throat_area / PI);
    const rm = Math.sqrt(mouth_area / PI);
    const expansion = mouth_area / throat_area;

    let m = 0;
    const pt = (profile_type || "exponential").toLowerCase();

    if (pt === "conical") {
      m = 0;
    } else if (pt === "exponential" || pt === "parabolic") {
      m = (1 / path_length) * Math.log(expansion);
    } else if (pt === "hyperbolic") {
      const target = Math.sqrt(expansion);
      const u = solveHyperbolicU(hyperbolic_t, target);
      m = u / path_length;
    }

    // Cutoff frequency
    let fc = 0;
    if (pt === "hyperbolic") {
      fc = m > 0 ? (m * 343) / (2 * PI) : 0;
    } else if (pt === "conical") {
      // Conical (straight pipe): fc = c / (4πL)  [m = 0 in the exponential formula]
      fc = path_length > 0 ? 343 / (4 * PI * path_length) : 0;
    } else {
      // Exponential / parabolic
      fc = m > 0 ? (m * 343) / (4 * PI) : 0;
    }

    // Mouth parameter krm
    let krm = 0;
    if (pt === "hyperbolic") {
      krm = rm * m;
    } else {
      krm = m > 0 ? (rm * m) / 2 : 0;
    }

    // Rating — thresholds based on krm = rm*m (Miki/Keele 1990)
    // krm ≥ 0.1 → midrange_ok (smooth directivity control)
    // krm ≥ 0.07 → bass_ok    (adequate for bass horns, Keele optimum)
    // krm < 0.07 → undersized (avoid; mouth diffraction losses significant)
    let rating: "midrange_ok" | "bass_ok" | "undersized";
    if (krm >= 0.1) rating = "midrange_ok";
    else if (krm >= 0.07) rating = "bass_ok";
    else rating = "undersized";

    const mouth_ko = 2 * rm;
    const mouth_diameter_cm = mouth_ko * 100;

    return {
      rt,
      rm,
      expansion,
      m,
      fc,
      krm,
      rating,
      mouth_ko,
      mouth_diameter_cm,
      profile_type: pt,
    };
  }, [hornYaml]);

  if (!metrics) return null;

  const { fc, krm, rating, mouth_diameter_cm, expansion, m } = metrics;

  const ratingColor =
    rating === "midrange_ok" ? "var(--green)" :
    rating === "bass_ok"    ? "#e3b341" :  // amber
    "var(--red)";

  const badges: { label: string; value: string; dotColor: string; badgeColor: string }[] = [
    { label: "fc", value: `${Math.round(fc)} Hz`, dotColor: "#e3b341", badgeColor: "rgba(227,179,65,0.1)" },
    { label: "krm", value: krm.toFixed(3), dotColor: "#00d4ff", badgeColor: "rgba(0,212,255,0.1)" },
    { label: "rating", value: rating.replace("_", " "), dotColor: ratingColor, badgeColor: `${ratingColor}22` },
    { label: "Ø mouth", value: `${mouth_diameter_cm.toFixed(1)} cm`, dotColor: "var(--accent)", badgeColor: "rgba(0,212,255,0.1)" },
    { label: "expansion", value: expansion.toFixed(2), dotColor: "var(--purple)", badgeColor: "rgba(168,85,247,0.1)" },
    { label: "m", value: m.toFixed(4), dotColor: "#8b949e", badgeColor: "rgba(139,148,158,0.1)" },
  ];

  return (
    <div className="horn-metrics-strip">
      {badges.map((b) => (
        <span
          key={b.label}
          className="horn-metric-badge"
          style={{ borderColor: `${b.dotColor}44`, background: b.badgeColor }}
        >
          <span className="horn-metric-dot" style={{ background: b.dotColor }} />
          <span className="horn-metric-label">{b.label}</span>
          <span className="horn-metric-value" style={{ color: b.dotColor }}>{b.value}</span>
        </span>
      ))}
    </div>
  );
}