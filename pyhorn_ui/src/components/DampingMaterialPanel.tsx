import { useState, useRef } from "react";
import InfoTooltip from "./InfoTooltip";

interface DampingMaterialPanelProps {
  hornYaml: string;
  onHornYamlChange: (yaml: string) => void;
}

// ── YAML section helpers ─────────────────────────────────────────────────────

/** Parse all sections from the horn YAML, returning array of raw objects. */
export function parseSections(yaml: string): Record<string, unknown>[] {
  const lines = yaml.split("\n");
  const sections: Record<string, unknown>[] = [];
  let current: Record<string, unknown> | null = null;
  let indent = 0;
  let inSections = false;

  for (const rawLine of lines) {
    const line = rawLine;
    const stripped = line.replace(/^(\s*).*/, "$1");
    const content = line.trim();
    if (content === "" || content.startsWith("#")) continue;

    const level = stripped.length;

    if (/^sections?:\s*$/.test(content)) {
      inSections = true;
      current = null;
      indent = level;
      continue;
    }

    if (inSections) {
      if (/^\w/.test(content) && !content.startsWith("  ") && level <= indent) {
        inSections = false;
      }
    }

    if (!inSections) {
      if (/^sections?:\s*$/.test(content)) {
        inSections = true;
        indent = level;
        current = null;
      }
      // Handle YAML list items (`- name: ...`) that appear before the next
      // top-level key — needed because the `continue` below would skip them.
      if (inSections && /^-\s+\w/.test(content)) {
        if (current) sections.push(current);
        current = {};
      }
      continue;
    }

    // Inside sections block — handle both "key: value" and "- name: value" (YAML list items)
    const isNewSection =
      (/^\w/.test(content) && level <= indent + 2) ||
      (/^-\s+\w/.test(content) && inSections);
    if (isNewSection) {
      if (current) sections.push(current);
      current = {};
    }

    if (current && content.includes(":")) {
      // Strip YAML list marker `- ` prefix before extracting key-value
      const kvContent = content.startsWith("- ")
        ? content.slice(2).trimStart()
        : content;
      const idx = kvContent.indexOf(":");
      const key = kvContent.slice(0, idx).trim();
      const val = kvContent.slice(idx + 1).trim();
      if (key === "name") current.name = val.replace(/^["']|["']$/g, "");
      else if (key === "profile_type") current.profile_type = val.replace(/^["']|["']$/g, "");
      else if (key === "length") current.length = parseFloat(val);
      else if (key === "start_area") current.start_area = parseFloat(val);
      else if (key === "end_area") current.end_area = parseFloat(val);
      else if (key === "hyperbolic_t") current.hyperbolic_t = parseFloat(val);
      else if (key === "fr1") current.fr1 = parseFloat(val);
      else if (key === "tal1") current.tal1 = parseFloat(val);
    }
  }
  if (current) sections.push(current);
  return sections;
}

/** Serialize sections back into YAML string, replacing the old sections block. */
export function serializeSections(sections: Record<string, unknown>[], yaml: string): string {
  const lines = yaml.split("\n");
  const out: string[] = [];
  let i = 0;
  let sectionsStart = -1;

  // Copy lines BEFORE the sections: line (if any)
  while (i < lines.length) {
    if (/^sections?:\s*$/.test(lines[i].trim())) {
      sectionsStart = i;
      break;
    }
    out.push(lines[i]);
    i++;
  }

  // Append sections: line
  if (sectionsStart !== -1) {
    out.push(lines[sectionsStart]);
  } else {
    out.push("sections:");
  }

  // Skip the old sections block (everything from sectionsStart+1 until non-section content)
  if (sectionsStart !== -1) {
    i = sectionsStart + 1;
    const sectionsIndent = lines[sectionsStart].replace(/^(\s*).*/, "$1").length;
    while (i < lines.length) {
      const line = lines[i];
      const stripped = line.replace(/^(\s*).*/, "$1");
      const content = line.trim();
      if (content === "") { i++; continue; }
      if (content.startsWith("#")) { i++; continue; }
      // Stop at a top-level key (less indented than or equal to sections: line)
      if (stripped.length <= sectionsIndent && /^\w/.test(content)) break;
      i++;
    }
  }

  // Append the new sections block
  for (const sec of sections) {
    out.push(`  - name: ${sec.name}`);
    out.push(`    profile_type: ${sec.profile_type ?? "exponential"}`);
    out.push(`    length: ${sec.length}`);
    out.push(`    start_area: ${sec.start_area}`);
    out.push(`    end_area: ${sec.end_area}`);
    if (sec.hyperbolic_t != null) out.push(`    hyperbolic_t: ${sec.hyperbolic_t}`);
    if ((sec.fr1 as number) > 0) out.push(`    fr1: ${sec.fr1}`);
    if ((sec.tal1 as number) > 0) out.push(`    tal1: ${sec.tal1}`);
    out.push("");
  }

  // Append remaining lines (from after the old sections block)
  while (i < lines.length) {
    out.push(lines[i]);
    i++;
  }

  return out.join("\n");
}

// ── Helpers to update a single section's fr1/tal1 ───────────────────────────

function updateSectionFr1(sections: Record<string, unknown>[], idx: number, fr1: number): void {
  sections[idx] = { ...sections[idx], fr1 };
}

function updateSectionTal1(sections: Record<string, unknown>[], idx: number, tal1: number): void {
  sections[idx] = { ...sections[idx], tal1 };
}

// ── Material presets (Miki 1990 table) ──────────────────────────────────────
const MATERIAL_PRESETS: { label: string; fr1: number }[] = [
  { label: "None (air)", fr1: 0 },
  { label: "Felt (thin)", fr1: 1500 },
  { label: "Wool fibre", fr1: 1000 },
  { label: "Mineral wool", fr1: 10000 },
  { label: "Open-cell foam", fr1: 5000 },
];

// ── Component ────────────────────────────────────────────────────────────────

export default function DampingMaterialPanel({ hornYaml, onHornYamlChange }: DampingMaterialPanelProps) {
  const sections = parseSections(hornYaml);
  const n = sections.length;

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [editingKey, setEditingKey] = useState<"fr1" | "tal1" | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const sec = sections[selectedIdx] || {};
  const fr1 = (sec.fr1 as number) ?? 0;
  const tal1 = (sec.tal1 as number) ?? 0;
  const hasDamping = fr1 > 0;

  // Polyfill density — typical polyester fibre (Hornresp pg 74), varies 20–30 kg/m³
  const DENSITY_KG_M3 = 25;

  // Per-segment mass for the selected segment (displayed below controls)
  const segLen = (sec.length as number) ?? 0;
  const segStartArea = (sec.start_area as number) ?? 0;
  const segEndArea = (sec.end_area as number) ?? 0;
  const segAvgArea = (segStartArea + segEndArea) / 2; // m²
  const segVolume = segLen * segAvgArea; // m³
  const segPolyfillMassKg =
    fr1 > 0 && fr1 < 1000 && segLen > 0 && segStartArea > 0 && segEndArea > 0
      ? segVolume * tal1 * DENSITY_KG_M3
      : null;

  // Total polyfill mass across ALL segments with fr1 < 1000 and tal1 > 0
  const totalPolyfillMassKg = sections.reduce((total, s) => {
    const sFr1 = (s.fr1 as number) ?? 0;
    const sTal1 = (s.tal1 as number) ?? 0;
    const sLen = (s.length as number) ?? 0;
    const sStart = (s.start_area as number) ?? 0;
    const sEnd = (s.end_area as number) ?? 0;
    if (sFr1 <= 0 || sFr1 > 1000 || sTal1 <= 0 || sLen <= 0 || sStart <= 0 || sEnd <= 0) return total;
    const sAvg = (sStart + sEnd) / 2;
    return total + sLen * sAvg * sTal1 * DENSITY_KG_M3;
  }, 0);

  const commit = (key: "fr1" | "tal1", value: number) => {
    const updated = [...sections];
    if (key === "fr1") updateSectionFr1(updated, selectedIdx, value);
    else updateSectionTal1(updated, selectedIdx, value);
    onHornYamlChange(serializeSections(updated, hornYaml));
  };

  const startEdit = (key: "fr1" | "tal1") => {
    setDraft(String(key === "fr1" ? fr1 : tal1));
    setEditingKey(key);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitEdit = () => {
    if (editingKey === null) return;
    const val = parseFloat(draft);
    if (!isNaN(val) && val >= 0) commit(editingKey, val);
    setEditingKey(null);
  };

  const applyPreset = (fr1Val: number) => {
    const updated = [...sections];
    updateSectionFr1(updated, selectedIdx, fr1Val);
    onHornYamlChange(serializeSections(updated, hornYaml));
  };

  const setTal1 = (v: number) => {
    const updated = [...sections];
    updateSectionTal1(updated, selectedIdx, v);
    onHornYamlChange(serializeSections(updated, hornYaml));
  };

  if (n === 0) {
    return (
      <div style={{ padding: "8px 0", fontSize: "12px", color: "var(--text2)" }}>
        No sections found in Horn YAML. Add a <code>sections:</code> block first.
      </div>
    );
  }

  const sectionLabel = (i: number) => {
    const s = sections[i];
    return s?.name
      ? `${i + 1}. ${s.name}`
      : `Segment ${i + 1}`;
  };

  return (
    <div style={{ padding: "8px 0" }}>
      {/* Segment selector */}
      <div style={{ marginBottom: "10px" }}>
        <label style={{ fontSize: "11px", color: "var(--text2)", display: "block", marginBottom: "4px" }}>
          <InfoTooltip content="Which horn segment to apply damping material to. Select a segment by its index in the sections list.">
            <span>Segment</span>
          </InfoTooltip>
        </label>
        <select
          value={selectedIdx}
          onChange={(e) => setSelectedIdx(Number(e.target.value))}
          style={{
            width: "100%",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            color: "var(--text)",
            fontSize: "12px",
            padding: "4px 6px",
            cursor: "pointer",
          }}
        >
          {sections.map((_, i) => (
            <option key={i} value={i}>{sectionLabel(i)}</option>
          ))}
        </select>
      </div>

      {/* Fr1 — Flow resistivity */}
      <div style={{ marginBottom: "8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2px" }}>
          <InfoTooltip content="Fr1 = airflow resistivity of the damping fill material (Rayls/m = Pa·s/m²). Determines how lossy the Miki (1990) absorption model is for this segment. Higher = more absorption. Wool fibre ≈ 1 000 Rayls/m, mineral wool ≈ 10 000 Rayls/m.">
            <span>Fr1 (Rayls/m)</span>
          </InfoTooltip>
          {editingKey === "fr1" ? (
            <input
              ref={inputRef}
              value={draft}
              type="number"
              step="100"
              min="0"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit();
                if (e.key === "Escape") setEditingKey(null);
              }}
              autoFocus
              style={{
                background: "var(--bg)",
                border: "1px solid var(--accent)",
                borderRadius: "4px",
                color: "var(--text)",
                padding: "1px 6px",
                fontSize: "12px",
                fontFamily: "monospace",
                width: "90px",
                textAlign: "right",
              }}
            />
          ) : (
            <span
              onClick={() => startEdit("fr1")}
              style={{ fontSize: "12px", fontFamily: "monospace", color: hasDamping ? "var(--accent)" : "var(--text2)", cursor: "pointer" }}
            >
              {fr1.toFixed(0)}
            </span>
          )}
        </div>

        {/* Slider */}
        <input
          type="range"
          min="0"
          max="20000"
          step="100"
          value={fr1}
          onChange={(e) => commit("fr1", parseFloat(e.target.value))}
          style={{ width: "100%", accentColor: "var(--accent)", cursor: "pointer" }}
        />

        {/* Material presets */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" }}>
          {MATERIAL_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => applyPreset(p.fr1)}
              style={{
                fontSize: "10px",
                padding: "2px 7px",
                borderRadius: "10px",
                border: fr1 === p.fr1 ? "1px solid var(--accent)" : "1px solid var(--border)",
                background: fr1 === p.fr1 ? "rgba(0,212,255,0.12)" : "transparent",
                color: fr1 === p.fr1 ? "var(--accent)" : "var(--text2)",
                cursor: "pointer",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tal1 — Fill fraction */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2px" }}>
          <InfoTooltip content="Tal1 = fraction of the segment cross-section that is filled with damping material (0.0 = none, 1.0 = fully packed). Hornresp pages 73-74: the Miki model applies absorption proportional to the fill fraction. For a partially-filled surroud use e.g. 0.5.">
            <span style={{ fontSize: "11px", color: "var(--text2)" }}>Tal1 (fill fraction)</span>
          </InfoTooltip>
          <span style={{ fontSize: "12px", fontFamily: "monospace", color: hasDamping ? "var(--accent)" : "var(--text2)" }}>
            {tal1.toFixed(2)}
          </span>
        </div>

        {/* Slider */}
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={tal1}
          onChange={(e) => setTal1(parseFloat(e.target.value))}
          style={{ width: "100%", accentColor: "var(--accent)", cursor: "pointer" }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--text2)" }}>
          <span>0% (none)</span>
          <span>{Math.round(tal1 * 100)}%</span>
          <span>100% (full)</span>
        </div>
      </div>

      {/* Per-segment polyfill mass estimate — only shown for soft materials (Fr < 1000 Rayls/m) */}
      {segPolyfillMassKg !== null && (
        <div
          style={{
            marginTop: "10px",
            padding: "7px 10px",
            background: "rgba(0,212,255,0.07)",
            border: "1px solid rgba(0,212,255,0.2)",
            borderRadius: "8px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <InfoTooltip content={`Approximate polyfill mass for ${sectionLabel(selectedIdx)}. Computed as: volume × fill_fraction × density, where volume = length × avg(cross-section area). Assumes felt/wool density ≈ ${DENSITY_KG_M3} kg/m³ — actual density varies by material and compression (typically 5–20 kg/m³ for fibre fills).`}>
              <span style={{ fontSize: "11px", color: "var(--accent)", fontWeight: 600 }}>
                Est. polyfill mass
              </span>
            </InfoTooltip>
            <span style={{ fontSize: "13px", fontFamily: "monospace", color: "var(--accent)", fontWeight: 700 }}>
              {segPolyfillMassKg < 0.001 ? "< 0.001" : segPolyfillMassKg.toFixed(3)} kg
            </span>
          </div>
          <div style={{ fontSize: "10px", color: "var(--text2)", marginTop: "3px" }}>
            {segLen.toFixed(3)} m × avg {segAvgArea.toFixed(6)} m² × {tal1.toFixed(2)} fill × {DENSITY_KG_M3} kg/m³
          </div>
        </div>
      )}

      {/* Total polyfill mass — shown when any segment has fr1 < 1000 and tal1 > 0 (Hornresp pg 74) */}
      {totalPolyfillMassKg > 0 && (
        <div
          style={{
            marginTop: "8px",
            padding: "8px 10px",
            background: "rgba(0,212,255,0.10)",
            border: "1px solid rgba(0,212,255,0.35)",
            borderRadius: "8px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <InfoTooltip content={`Total polyfill mass across all horn segments with Fr1 < 1000 Rayls/m. Hornresp page 74. Sum of (volume × fill_fraction × density) per segment. Assumes polyester fibre density = ${DENSITY_KG_M3} kg/m³ (typical range 20–30 kg/m³).`}>
              <span style={{ fontSize: "11px", color: "var(--accent)", fontWeight: 700 }}>
                Total polyfill mass
              </span>
            </InfoTooltip>
            <span style={{ fontSize: "15px", fontFamily: "monospace", color: "var(--accent)", fontWeight: 800 }}>
              {totalPolyfillMassKg < 0.001 ? "< 0.001" : totalPolyfillMassKg.toFixed(2)} kg
            </span>
          </div>
          <div style={{ fontSize: "10px", color: "var(--text2)", marginTop: "3px" }}>
            Across {sections.filter((s) => { const f=(s.fr1 as number)??0,t=(s.tal1 as number)??0; return f>0&&f<1000&&t>0; }).length} segment(s) × {DENSITY_KG_M3} kg/m³
          </div>
        </div>
      )}

      {/* Summary line */}
      {hasDamping && (
        <p style={{ fontSize: "10px", color: "var(--text2)", marginTop: "6px", fontStyle: "italic" }}>
          {sectionLabel(selectedIdx)} → {MATERIAL_PRESETS.find((p) => p.fr1 === fr1)?.label ?? `Fr1=${fr1.toFixed(0)}`}, {Math.round(tal1 * 100)}% fill
        </p>
      )}
    </div>
  );
}
