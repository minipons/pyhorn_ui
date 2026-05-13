import { useState, useRef } from "react";
import InfoTooltip from "./InfoTooltip";
import { QUANTITIES, fmt, toDisplay, parse, QuantityKey } from "../types/physical";

interface EditableDriverSummaryProps {
  driverYaml: string;
  onDriverYamlChange: (yaml: string) => void;
}

// ── YAML helpers ─────────────────────────────────────────────────────────────
function parseYamlFloat(text: string, key: string): number | null {
  const lines = text.split("\n");
  for (const line of lines) {
    const idx = line.indexOf("#");
    const clean = idx >= 0 ? line.slice(0, idx) : line;
    const m = clean.match(new RegExp(`^\\s*${key}:\\s*([0-9eE.+\\-]+)`));
    if (m) return parseFloat(m[1]);
  }
  return null;
}

function setYamlFloat(text: string, key: string, value: number): string {
  const lines = text.split("\n");
  let found = false;
  const next = lines.map((line) => {
    const idx = line.indexOf("#");
    const clean = idx >= 0 ? line.slice(0, idx) : line;
    const re = new RegExp(`^(\\s*${key}:\\s*)([0-9eE.+\\-]+)`);
    const m = clean.match(re);
    if (m) { found = true; return `${m[1]}${value}`; }
    return line;
  });
  if (!found) return text.trimEnd() + `\n${key}: ${value}`;
  return next.join("\n");
}

// ── Driver field keys (subset of QUANTITIES) ─────────────────────────────────
const DRIVER_KEYS: QuantityKey[] = ["fs", "qts", "qes", "qms", "vas", "re", "bl", "mms", "sd", "le", "xmax", "voltage"];

const LABELS: Record<QuantityKey, string> = {
  fs: "fs (Hz)",
  qts: "Qts",
  qes: "Qes",
  qms: "Qms",
  vas: "Vas (L)",
  re: "Re (Ω)",
  bl: "Bl (N/A)",
  mms: "Mms (g)",
  sd: "Sd (cm²)",
  le: "Le (mH)",
  xmax: "Xmax (mm)",
  voltage: "Voltage (V)",
  // horn params not shown in driver panel
  throat_area: "Throat area (cm²)",
  mouth_area: "Mouth area (cm²)",
  path_length: "Path length (cm)",
  hyperbolic_t: "T (flare)",
  vrc: "Rear chamber (L)",
  vtc: "Throat chamber (L)",
  lrc: "Rear len (cm)",
  atc: "Throat atc (cm²)",
  ang: "Radiation angle (π)",
  n_segments: "Segments",
  profile_type: "Profile",
};

const TOOLTIPS: Partial<Record<QuantityKey, string>> = {
  fs: "Free-air resonance frequency (Hz). The frequency where the driver's suspension resonates in free air. Set by the mass and compliance (T-S parameters). Determines the lowest in-room frequency a horn can realistically load.",
  qts: "Total Q factor — combination of electrical (Qes) and mechanical (Qms) damping. Determines how peaked the bass response is. Qts > 0.4 = overdamped (lazy bass), Qts < 0.27 = underdamped (aggressive, boomy bass). For horn loading, aim for 0.2–0.4.",
  qes: "Electrical Q — damping from the voice coil's resistance loading the motor. Lower Re relative to Bl² means more electrical damping. Qes alone doesn't determine system behavior without Qms.",
  qms: "Mechanical Q — damping from the driver's suspension losses (spider, surround). High Qms = lossy suspension = less control of the cone. Typically 5–10 for a well-designed midbass driver.",
  vas: "Equivalent compliance volume (litres). The volume of air that has the same stiffness as the driver's suspension. Determines how the driver couples to different enclosure sizes. Inversely related to driver stiffness.",
  re: "DC resistance of the voice coil (Ω). Always lower than the nominal impedance. Used to compute efficiency and to model the electrical circuit. Should be measured, not assumed from spec sheets.",
  bl: "Force factor (N/A). Magnetic motor strength — Newtons of force per ampere of current. Higher Bl = stronger control of the cone, higher efficiency. Computed from magnet strength, gap geometry, and coil winding.",
  mms: "Moving mass (grams). Total mass of the cone, coil, former, and radiation load. Higher mms = lower sensitivity, deeper bass. The mass-spring system (mms + cms) sets the free-air resonance.",
  sd: "Piston radiation area (cm²). Effective surface area of the driver that couples to the air. Usually slightly less than the baffle cutout. Used for sensitivity and displacement calculations.",
  le: "Voice coil inductance at 1kHz (mH). Causes rising impedance and delayed high-frequency response. For horn loading the Le at the throat is critical — it forms a resonant with the throat chamber volume.",
  xmax: "One-way linear excursion limit (mm). Maximum peak excursion before the voice coil leaves the gap and distortion rises dramatically. Determines maximum SPL and low-frequency extension.",
  voltage: "Reference voltage (V) used for SPL calculation. Sets the input power level for sensitivity spec. 2.83V ≈ 1W into 8Ω, 1.0V ≈ 0.5W into 4Ω.",
};

export default function EditableDriverSummary({
  driverYaml,
  onDriverYamlChange,
}: EditableDriverSummaryProps) {
  const [editing, setEditing] = useState<QuantityKey | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const current = (key: QuantityKey) => parseYamlFloat(driverYaml, key);

  const startEdit = (key: QuantityKey) => {
    const val = current(key);
    // toDisplay converts SI YAML value → user-friendly input value
    const display = val != null ? toDisplay(key, val) : null;
    setDraft(display != null ? String(display) : "");
    setEditing(key);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = () => {
    if (!editing) return;
    try {
      // parse converts user input → SI YAML value
      const si = parse(editing, parseFloat(draft));
      onDriverYamlChange(setYamlFloat(driverYaml, editing, si));
    } catch { /* ignore bad parses */ }
    setEditing(null);
  };

  const cancel = () => setEditing(null);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: "4px 16px" }}>
      {DRIVER_KEYS.map((key) => {
        const val = current(key);
        const isActive = editing === key;

        if (isActive) {
          return (
            <div
              key={key}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "3px 0",
                borderBottom: "1px solid var(--border)",
                fontSize: "12px",
              }}
            >
              <InfoTooltip content={TOOLTIPS[key] ?? ""}>
                <span style={{ color: "var(--text2)" }}>{LABELS[key]}</span>
              </InfoTooltip>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <input
                  ref={inputRef}
                  value={draft}
                  type="number"
                  step="any"
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit();
                    if (e.key === "Escape") cancel();
                  }}
                  autoFocus
                  style={{
                    background: "var(--bg)",
                    border: "1px solid var(--accent)",
                    borderRadius: "4px",
                    color: "var(--text)",
                    padding: "1px 4px",
                    fontSize: "12px",
                    fontFamily: "monospace",
                    width: "100px",
                    textAlign: "right",
                  }}
                />
                <span style={{ color: "var(--text2)", fontSize: "11px", fontFamily: "monospace" }}>
                  {QUANTITIES[key].unit}
                </span>
              </div>
            </div>
          );
        }

        return (
          <div
            key={key}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "3px 0",
              borderBottom: "1px solid var(--border)",
              fontSize: "12px",
              cursor: "pointer",
            }}
            onClick={() => startEdit(key)}
          >
            <InfoTooltip content={TOOLTIPS[key] ?? ""}>
              <span style={{ color: "var(--text2)" }}>{LABELS[key]}</span>
            </InfoTooltip>
            <span style={{ color: "var(--accent)", fontFamily: "monospace" }}>
              {val != null ? fmt(key, val) : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
