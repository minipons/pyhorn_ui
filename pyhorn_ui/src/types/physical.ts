/**
 * Physical units schema for pyhorn-ui.
 *
 * All internal/saved values are in SI units (m, m², m³, kg, H, Pa...).
 * All display values use user-friendly units (cm, cm², L, g, mH...).
 *
 * The YAML files store SI values. The UI shows and edits display units.
 * Conversion: display ← toDisplay(SI) | SI ← parse(display)
 */

// ── Unit tags ────────────────────────────────────────────────────────────────
export type UnitTag =
  | "Hz" | "Q" | "Ω" | "N/A" | "mH"
  | "cm" | "mm" | "m2" | "cm2" | "L" | "cm3"
  | "g"  | "V"  | "dimless"   // dimless = dimensionless scalar (hyperbolic_t, n_segments)
  | "pi";                    // π — radiation angle stored as radians, displayed as nπ

// ── Conversion functions ─────────────────────────────────────────────────────
type ToDisplay = (v: number) => number;
type Parse = (v: number) => number;
type Format = (v: number) => string;

// ── Schema entry ─────────────────────────────────────────────────────────────
export interface UnitEntry {
  /** Internal SI unit label */
  si: string;
  /** User-facing short unit label (for display next to input) */
  unit: string;
  /** Convert SI → display for input field and readout */
  toDisplay: ToDisplay;
  /** Convert display → SI for saving back to YAML */
  parse: Parse;
  /** Full string format for display (e.g. "36.7 L") */
  fmt: Format;
}

// ── Complete schema ──────────────────────────────────────────────────────────
export const QUANTITIES: Record<string, UnitEntry> = {
  // ── Driver parameters ──────────────────────────────────────────────────
  fs: {
    si: "Hz", unit: "Hz",
    toDisplay: (v) => v,
    parse: (v) => v,
    fmt: (v) => `${v.toFixed(1)} Hz`,
  },
  qts: {
    si: "—", unit: "—",
    toDisplay: (v) => v,
    parse: (v) => v,
    fmt: (v) => `${v.toFixed(3)}`,
  },
  qes: {
    si: "—", unit: "—",
    toDisplay: (v) => v,
    parse: (v) => v,
    fmt: (v) => `${v.toFixed(3)}`,
  },
  qms: {
    si: "—", unit: "—",
    toDisplay: (v) => v,
    parse: (v) => v,
    fmt: (v) => `${v.toFixed(3)}`,
  },
  // Vas: stored as m³, displayed as L
  vas: {
    si: "m³", unit: "L",
    toDisplay: (v) => v * 1000,
    parse: (v) => v / 1000,
    fmt: (v) => `${(v * 1000).toFixed(1)} L`,
  },
  re: {
    si: "Ω", unit: "Ω",
    toDisplay: (v) => v,
    parse: (v) => v,
    fmt: (v) => `${v.toFixed(2)} Ω`,
  },
  bl: {
    si: "N/A", unit: "N/A",
    toDisplay: (v) => v,
    parse: (v) => v,
    fmt: (v) => `${v.toFixed(2)} N/A`,
  },
  // Mms: stored as kg, displayed as g
  mms: {
    si: "kg", unit: "g",
    toDisplay: (v) => v * 1000,
    parse: (v) => v / 1000,
    fmt: (v) => `${(v * 1000).toFixed(2)} g`,
  },
  // Sd: stored as m², displayed as cm²
  sd: {
    si: "m²", unit: "cm²",
    toDisplay: (v) => v * 1e4,
    parse: (v) => v / 1e4,
    fmt: (v) => `${(v * 1e4).toFixed(2)} cm²`,
  },
  // Le: stored as H, displayed as mH
  le: {
    si: "H", unit: "mH",
    toDisplay: (v) => v * 1000,
    parse: (v) => v / 1000,
    fmt: (v) => `${(v * 1000).toFixed(2)} mH`,
  },
  // Xmax: stored as m, displayed as mm
  xmax: {
    si: "m", unit: "mm",
    toDisplay: (v) => v * 1000,
    parse: (v) => v / 1000,
    fmt: (v) => `${(v * 1000).toFixed(1)} mm`,
  },
  voltage: {
    si: "V", unit: "V",
    toDisplay: (v) => v,
    parse: (v) => v,
    fmt: (v) => `${v.toFixed(2)} V`,
  },

  // ── Horn parameters ─────────────────────────────────────────────────────
  throat_area: {
    si: "m²", unit: "cm²",
    toDisplay: (v) => v * 1e4,
    parse: (v) => v / 1e4,
    fmt: (v) => `${(v * 1e4).toFixed(2)} cm²`,
  },
  mouth_area: {
    si: "m²", unit: "cm²",
    toDisplay: (v) => v * 1e4,
    parse: (v) => v / 1e4,
    fmt: (v) => `${(v * 1e4).toFixed(0)} cm²`,
  },
  path_length: {
    si: "m", unit: "cm",
    toDisplay: (v) => v * 100,
    parse: (v) => v / 100,
    fmt: (v) => `${(v * 100).toFixed(1)} cm`,
  },
  hyperbolic_t: {
    si: "—", unit: "—",
    toDisplay: (v) => v,
    parse: (v) => v,
    fmt: (v) => `${v.toFixed(4)}`,
  },
  // Vrc: stored as m³, displayed as cm³
  vrc: {
    si: "m³", unit: "cm³",
    toDisplay: (v) => v * 1e6,
    parse: (v) => v / 1e6,
    fmt: (v) => { const cm3 = v * 1e6; return cm3 >= 1000 ? `${(cm3/1000).toFixed(2)} L` : `${cm3.toFixed(1)} cm³`; },
  },
  // Vtc: stored as m³, displayed as cm³
  vtc: {
    si: "m³", unit: "cm³",
    toDisplay: (v) => v * 1e6,
    parse: (v) => v / 1e6,
    fmt: (v) => `${Math.round(v * 1e6)} cm³`,
  },
  // Lrc: stored as m, displayed as cm
  lrc: {
    si: "m", unit: "cm",
    toDisplay: (v) => v * 100,
    parse: (v) => v / 100,
    fmt: (v) => `${Math.round(v * 100)} cm`,
  },
  // Atc: stored as m², displayed as cm²
  atc: {
    si: "m²", unit: "cm²",
    toDisplay: (v) => v * 1e4,
    parse: (v) => v / 1e4,
    fmt: (v) => `${Math.round(v * 1e4)} cm²`,
  },
  // Ang: stored as radians, displayed as n×π (e.g. "2" for 2π)
  ang: {
    si: "rad", unit: "π",
    toDisplay: (v) => v / Math.PI,
    parse: (v) => v * Math.PI,
    fmt: (v) => {
      const n = v / Math.PI;
      if (Math.abs(n - Math.round(n)) < 0.001) return `${Math.round(n)}π`;
      // Strip trailing zeros so "0.50π" → "0.5π", "1.20π" → "1.2π"
      const s = n.toFixed(4);
      return `${s.replace(/\.?0+$/, '') || '0'}π`;
    },
  },
  n_segments: {
    si: "—", unit: "—",
    toDisplay: (v) => v,
    parse: (v) => v,
    fmt: (v) => `${v}`,
  },
  profile_type: {
    si: "—", unit: "—",
    toDisplay: (v) => v,
    parse: (v) => v,
    fmt: (v) => String(v),
  },
} as const;

// ── Convenience helpers ─────────────────────────────────────────────────────
export type QuantityKey = keyof typeof QUANTITIES;

export function fmt(key: QuantityKey, value: number): string {
  return QUANTITIES[key]?.fmt(value) ?? String(value);
}

export function toDisplay(key: QuantityKey, value: number): number {
  return QUANTITIES[key]?.toDisplay(value) ?? value;
}

export function parse(key: QuantityKey, displayValue: number): number {
  return QUANTITIES[key]?.parse(displayValue) ?? displayValue;
}
