import { useState, useRef } from "react";
import InfoTooltip from "./InfoTooltip";
import { QUANTITIES, fmt, toDisplay, parse, QuantityKey } from "../types/physical";

// ── Exact hyperbolic flare constant solver (same as HornMetrics) ─────────────────
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

interface EditableHornSummaryProps {
  hornYaml: string;
  driverYaml: string;
  onHornYamlChange: (yaml: string) => void;
}

// ── YAML helpers ─────────────────────────────────────────────────────────────
// Parses a float from the YAML, checking both flat keys and nested keys
// (e.g. "vrc" at top level OR inside "rear_chamber:" / "throat_chamber:")
function parseYamlFloat(text: string, key: string): number | null {
  const lines = text.split("\n");
  let inBlock: string | null = null;

  for (const line of lines) {
    const idx = line.indexOf("#");
    const clean = idx >= 0 ? line.slice(0, idx) : line;

    // Track which block we are inside
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

// Writes a flat key to YAML. Also strips any nested version of the same key
// to avoid duplicates when migrating from nested to flat format.
function setYamlFloat(text: string, key: string, value: number): string {
  const lines = text.split("\n");

  // Collect block context and find existing flat and nested occurrences
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

    // Skip the nested version of this key
    if (
      inBlock !== null &&
      !flatFound &&
      clean.match(new RegExp(`^\\s+${key}:\\s*[0-9eE.+\\-]+`))
    ) {
      continue; // drop nested occurrence
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

  // If we didn't find the key at all, append at the end
  if (!flatFound) return text.trimEnd() + `\n${key}: ${value}`;
  return result.join("\n");
}

// ── Horn editable field keys ─────────────────────────────────────────────────
// Map hyperbolic_t → effective profile label for display
function profileLabelFromT(t: number | null | undefined): string {
  if (t == null) return "Exponential";
  if (t <= 0.04) return "Conical";
  if (t <= 0.35) return "Hyperbolic (T-Low)";
  if (t <= 0.65) return "Hyperbolic (BLH)";
  if (t <= 0.95) return "Hyperbolic (T-High)";
  return "Exponential";
}

const PROFILE_LABELS: Record<string, string> = {
  exponential: "Exponential",
  conical: "Conical",
  hyperbolic: "Hyperbolic",
  parabolic: "Parabolic",
};

const ANG_OPTIONS = [
  { label: "0.5π", value: Math.PI * 0.5 },
  { label: "1π",   value: Math.PI * 1 },
  { label: "2π",   value: Math.PI * 2 },
  { label: "4π",   value: Math.PI * 4 },
];

const TOOLTIPS: Partial<Record<QuantityKey, string>> = {
  throat_area: "Cross-sectional area at the horn throat (m² → cm²). The narrowest point — where the driver couples to the horn. Determines the compression ratio and lower cutoff. Must be ≥ driver Sd for direct coupling, or smaller if a throat chamber is used.",
  mouth_area: "Cross-sectional area at the horn mouth (m² → cm²). The point where the horn flares out to the environment. Larger mouth = lower cutoff, but also affects timing and room interaction.",
  hyperbolic_t: "Hyperbolic T parameter — the horn flare constant. Controls the expansion shape for hyperbolic profiles. T=0 = catenoidal, T=1 = exponential, T→∞ = conical. Lower T = stronger low-frequency loading but steeper cutoff.",
  path_length: "Total acoustic path length of the horn (m → cm). Determines the lowest frequency the horn can load. Quarter-wave resonance: fc ≈ c/(4L). For a 1.5m path the theoretical limit is ~57 Hz. Practical limit is higher due to losses.",
  ang: "Solid radiation angle expressed as n×π (n = ang/π). Controls the acoustic load at the mouth. 2π = half-space (floor-standing), π = quarter-space (wall panel), 4π = free-field. Display/input: n (e.g. 2 for 2π).",
  vrc: "Rear chamber sealed box volume (m³ → L or cm³). The large enclosure behind the driver. Its compliance lowers the system resonance below the driver's free-air fs.",
  lrc: "Average acoustic path length of the rear chamber (m → cm). Determines the inertance (mass term) of the sealed rear chamber. Set to approximately the box depth for proper sealed-box tuning modeling.",
  vtc: "Throat chamber sealed volume (m³ → L or cm³). Small sealed volume between the driver dust cap and the horn throat. Models the air volume the driver loads into before the horn path.",
  atc: "Cross-sectional area of the throat chamber opening (m² → cm²). Typically ≈ driver Sd or the horn throat area.",
  n_segments: "Number of discretisation segments for the TMM cascade. Higher = more accurate at high frequencies but slower. 50–100 is usually sufficient.",
  profile_type: "Flare law describing how the horn cross-section expands along its length. Exponential: smooth cutoff, classic horn sound. Conical: no cutoff peak, wider bandwidth. Hyperbolic: stronger low-frequency loading, lower cutoff for a given size. Parabolic: compromise between exp and con.",
};

// Read-only display rows derived from hornYaml (no edit needed)
function HornDisplayRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between",
      padding: "3px 0", borderBottom: "1px solid var(--border)", fontSize: "12px",
    }}>
      <span style={{ color: "var(--text2)" }}>{label}</span>
      <span style={{ color: "var(--text)", fontFamily: "monospace" }}>{value}</span>
    </div>
  );
}

export default function EditableHornSummary({
  hornYaml,
  driverYaml,
  onHornYamlChange,
}: EditableHornSummaryProps) {
  const [editing, setEditing] = useState<QuantityKey | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Parse current values ─────────────────────────────────────────────────
  const throat_area = parseYamlFloat(hornYaml, "throat_area");
  const mouth_area = parseYamlFloat(hornYaml, "mouth_area");
  const path_length = parseYamlFloat(hornYaml, "path_length");
  const vrc = parseYamlFloat(hornYaml, "vrc");
  const vtc = parseYamlFloat(hornYaml, "vtc");
  const atc = parseYamlFloat(hornYaml, "atc");
  const ang = parseYamlFloat(hornYaml, "ang");
  const hyperbolic_t = parseYamlFloat(hornYaml, "hyperbolic_t");
  const sd = parseYamlFloat(driverYaml, "sd");
  const n_segments = parseYamlFloat(hornYaml, "n_segments");

  const profile_type = (() => {
    const lines = hornYaml.split("\n");
    for (const line of lines) {
      const idx = line.indexOf("#"); const clean = idx >= 0 ? line.slice(0, idx) : line;
      const m = clean.match(/^\s*profile_type:\s*"?([^"\n]+)"?/);
      if (m) return m[1].trim();
    }
    return "—";
  })();

  // Parse throat_adapter block values (nested in YAML)
  const throat_adapter_ap1 = (() => {
    const lines = hornYaml.split("\n");
    let inBlock = false;
    for (const line of lines) {
      const clean = line.slice(0, line.indexOf("#") >= 0 ? line.indexOf("#") : line.length).trim();
      if (clean === "throat_adapter:") { inBlock = true; continue; }
      if (inBlock && clean.match(/^\S/)) inBlock = false; // new top-level key
      if (inBlock) {
        const m = clean.match(/^ap1:\s*([0-9eE.+\-]+)/);
        if (m) return parseFloat(m[1]);
      }
    }
    return null;
  })();

  const throat_adapter_lpt = (() => {
    const lines = hornYaml.split("\n");
    let inBlock = false;
    for (const line of lines) {
      const clean = line.slice(0, line.indexOf("#") >= 0 ? line.indexOf("#") : line.length).trim();
      if (clean === "throat_adapter:") { inBlock = true; continue; }
      if (inBlock && clean.match(/^\S/)) inBlock = false;
      if (inBlock) {
        const m = clean.match(/^lpt:\s*([0-9eE.+\-]+)/);
        if (m) return parseFloat(m[1]);
      }
    }
    return null;
  })();

  const expansion = (throat_area && mouth_area) ? (mouth_area / throat_area).toFixed(1) : "—";

  // Compute fc from path_length and expansion ratio (matches HornMetrics)
  // Compute fc — matches HornMetrics exactly
  const fq = (() => {
    if (!throat_area || !mouth_area || !path_length || path_length <= 0) return "—";
    const expansion = mouth_area / throat_area;
    let m = 0;
    const pt = profile_type?.toLowerCase() ?? "exponential";

    if (pt === "conical") {
      m = 0;
    } else if (pt === "exponential" || pt === "parabolic") {
      m = Math.log(expansion) / path_length;
    } else if (pt === "hyperbolic") {
      const target = Math.sqrt(expansion);
      const u = solveHyperbolicU(hyperbolic_t ?? 1, target);
      m = u / path_length;
    }

    if (m <= 0) return "—";
    // Hyperbolic uses 2π divisor, all others use 4π
    const divisor = pt === "hyperbolic" ? 2 * Math.PI : 4 * Math.PI;
    return (m * 343 / divisor).toFixed(1);
  })();

  // ── Edit handlers ────────────────────────────────────────────────────────
  const startEdit = (key: QuantityKey) => {
    if (key === "profile_type") {
      const lines = hornYaml.split("\n");
      for (const line of lines) {
        const idx = line.indexOf("#"); const clean = idx >= 0 ? line.slice(0, idx) : line;
        const m = clean.match(/^\s*profile_type:\s*"?([^"\n]+)"?/);
        if (m) { setDraft(m[1].trim()); break; }
      }
    } else {
      const raw = parseYamlFloat(hornYaml, key);
      if (raw != null) {
        setDraft(String(toDisplay(key, raw)));
      } else {
        setDraft("");
      }
    }
    setEditing(key);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = () => {
    if (!editing) return;
    try {
      if (editing === "profile_type") {
        const lines = hornYaml.split("\n");
        let found = false;
        const next = lines.map((line) => {
          const idx = line.indexOf("#"); const clean = idx >= 0 ? line.slice(0, idx) : line;
          const re = /^\s*profile_type:\s*"?([^"\n]*)"?/;
          if (re.test(clean)) { found = true; return line.replace(re, `profile_type: "${draft.trim()}"`); }
          return line;
        });
        onHornYamlChange(found ? next.join("\n") : (hornYaml.trimEnd() + `\nprofile_type: "${draft.trim()}"`));
      } else {
        const si = parse(editing, parseFloat(draft));
        onHornYamlChange(setYamlFloat(hornYaml, editing, si));
      }
    } catch { /* ignore bad parses */ }
    setEditing(null);
  };

  const cancel = () => setEditing(null);
  const isActive = (key: QuantityKey) => editing === key;

  // ── Row renderer ─────────────────────────────────────────────────────────
  // profile_type is controlled by T(flare) — read-only chip
  // ang is a segmented chip selector [0.5π, 1π, 2π, 4π]
  function Row({ label, value, hornKey }: {
    label: string; value: string; hornKey: QuantityKey;
  }) {
    const active = isActive(hornKey);

    if (hornKey === "profile_type") {
      // Read-only chip — not clickable (controlled by T)
      return (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", borderBottom: "1px solid var(--border)", fontSize: "12px" }}>
          <InfoTooltip content={`Profile type is derived from T (flare) below — not directly editable.`}>
            <span style={{ color: "var(--text2)" }}>{label}</span>
          </InfoTooltip>
          <InfoTooltip content={TOOLTIPS[hornKey] ?? ""}>
            <span style={{
              padding: "1px 8px",
              borderRadius: "999px",
              border: "1px solid var(--accent)",
              background: "rgba(0,212,255,0.08)",
              color: "var(--accent)",
              fontSize: "11px",
              fontFamily: "monospace",
              cursor: "default",
            }}>
              {PROFILE_LABELS[profile_type] ?? profile_type ?? "—"}
            </span>
          </InfoTooltip>
        </div>
      );
    }

    if (hornKey === "ang") {
      // Segmented chip — clicking an option directly sets and exits edit mode
      const handleAngClick = (radValue: number) => {
        onHornYamlChange(setYamlFloat(hornYaml, "ang", radValue));
        setEditing(null);
      };
      return (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", borderBottom: "1px solid var(--border)", fontSize: "12px" }}>
          <InfoTooltip content={TOOLTIPS[hornKey] ?? ""}>
            <span style={{ color: "var(--text2)" }}>{label}</span>
          </InfoTooltip>
          <div style={{ display: "flex", gap: "3px" }}>
            {ANG_OPTIONS.map((opt) => {
              const isActive = ang != null && Math.abs(ang - opt.value) < 0.01;
              return (
                <button
                  key={opt.label}
                  onClick={() => handleAngClick(opt.value)}
                  style={{
                    padding: "1px 7px",
                    borderRadius: "5px",
                    border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
                    background: isActive ? "rgba(0,212,255,0.12)" : "transparent",
                    color: isActive ? "var(--accent)" : "var(--text2)",
                    fontSize: "11px",
                    fontFamily: "monospace",
                    cursor: "pointer",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    if (active) {
      return (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", borderBottom: "1px solid var(--border)", fontSize: "12px" }}>
          <InfoTooltip content={TOOLTIPS[hornKey] ?? ""}>
            <span style={{ color: "var(--text2)" }}>{label}</span>
          </InfoTooltip>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <input
              ref={inputRef}
              value={draft}
              type="number"
              step="any"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
              autoFocus
              style={{ background: "var(--bg)", border: "1px solid var(--accent)", borderRadius: "4px", color: "var(--text)", padding: "1px 4px", fontSize: "12px", fontFamily: "monospace", width: "100px", textAlign: "right" }}
            />
            <span style={{ color: "var(--text2)", fontSize: "11px", fontFamily: "monospace" }}>
              {QUANTITIES[hornKey]?.unit ?? ""}
            </span>
          </div>
        </div>
      );
    }

    return (
      <div
        style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid var(--border)", fontSize: "12px", cursor: "pointer" }}
        onClick={() => startEdit(hornKey)}
      >
        <InfoTooltip content={TOOLTIPS[hornKey] ?? ""}>
          <span style={{ color: "var(--text2)" }}>{label}</span>
        </InfoTooltip>
        <span style={{ color: "var(--accent)", fontFamily: "monospace" }}>{value}</span>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: "4px 16px" }}>
      <Row label="Profile" value={profileLabelFromT(hyperbolic_t)} hornKey="profile_type" />
      <HornDisplayRow label="Driver Sd" value={sd != null ? fmt("sd", sd) : "—"} />
      <Row label="Throat area" value={throat_area != null ? fmt("throat_area", throat_area) : "—"} hornKey="throat_area" />
      <Row label="Mouth area" value={mouth_area != null ? fmt("mouth_area", mouth_area) : "—"} hornKey="mouth_area" />
      <HornDisplayRow label="Expansion" value={expansion !== "—" ? `${expansion}:1` : "—"} />
      <Row label="Path length" value={path_length != null ? fmt("path_length", path_length) : "—"} hornKey="path_length" />
      <Row label="T (flare)" value={hyperbolic_t != null ? hyperbolic_t.toFixed(2) : "—"} hornKey="hyperbolic_t" />
      <HornDisplayRow label="fc cutoff" value={fq !== "—" ? `${fq} Hz` : "—"} />
      <Row label="Radiation angle" value={ang != null ? fmt("ang", ang) : "—"} hornKey="ang" />
      <Row label="Rear chamber" value={vrc != null ? fmt("vrc", vrc) : "—"} hornKey="vrc" />
      <Row label="Throat chamber" value={vtc != null ? fmt("vtc", vtc) : "—"} hornKey="vtc" />
      <Row label="Throat atc" value={atc != null ? fmt("atc", atc) : "—"} hornKey="atc" />
      <Row label="Rear len lrc" value={parseYamlFloat(hornYaml, "lrc") != null ? fmt("lrc", parseYamlFloat(hornYaml, "lrc")!) : "—"} hornKey="lrc" />
      {throat_adapter_ap1 != null && (
        <>
          <div style={{ gridColumn: "1 / -1", paddingTop: "8px", fontSize: "10px", color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Throat Adapter (baffle hole)
          </div>
          <HornDisplayRow label="Baffle hole ap1" value={`${throat_adapter_ap1.toFixed(2)} cm²`} />
          <HornDisplayRow label="Baffle length lpt" value={`${(throat_adapter_lpt != null ? throat_adapter_lpt : 0).toFixed(1)} mm`} />
        </>
      )}
      <Row label="Segments" value={n_segments != null ? fmt("n_segments", n_segments) : "—"} hornKey="n_segments" />
    </div>
  );
}
