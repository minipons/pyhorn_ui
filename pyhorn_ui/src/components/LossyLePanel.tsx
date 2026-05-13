import { useState, useRef } from "react";
import InfoTooltip from "./InfoTooltip";

interface LossyLePanelProps {
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

function setYamlBool(text: string, key: string, value: boolean): string {
  const lines = text.split("\n");
  let found = false;
  const next = lines.map((line) => {
    const idx = line.indexOf("#");
    const clean = idx >= 0 ? line.slice(0, idx) : line;
    const re = new RegExp(`^(\\s*${key}:\\s*)(true|false)`);
    const m = clean.match(re);
    if (m) { found = true; return `${m[1]}${value}`; }
    return line;
  });
  if (!found) return text.trimEnd() + `\n${key}: ${value}`;
  return next.join("\n");
}

function removeYamlKey(text: string, key: string): string {
  const lines = text.split("\n");
  return lines
    .filter((line) => {
      const idx = line.indexOf("#");
      const clean = idx >= 0 ? line.slice(0, idx) : line;
      return !clean.match(new RegExp(`^\\s*${key}\\s*:`));
    })
    .join("\n");
}

export default function LossyLePanel({ driverYaml, onDriverYamlChange }: LossyLePanelProps) {
  const [editing, setEditing] = useState<"R_e_eddy" | "f_ref" | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const lossyLeEnabled = driverYaml.includes("lossy_le: true");
  const le_R_e_eddy = parseYamlFloat(driverYaml, "le_R_e_eddy");
  const le_f_ref = parseYamlFloat(driverYaml, "le_f_lossy_ref");

  const startEdit = (key: "R_e_eddy" | "f_ref") => {
    const val = key === "R_e_eddy" ? le_R_e_eddy : le_f_ref;
    setDraft(val != null ? String(val) : "");
    setEditing(key);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitR_e_eddy = () => {
    const val = parseFloat(draft);
    if (isNaN(val) || val < 0) { setEditing(null); return; }
    onDriverYamlChange(setYamlFloat(driverYaml, "le_R_e_eddy", val));
    setEditing(null);
  };

  const commitF_ref = () => {
    const val = parseFloat(draft);
    if (isNaN(val) || val <= 0) { setEditing(null); return; }
    onDriverYamlChange(setYamlFloat(driverYaml, "le_f_lossy_ref", val));
    setEditing(null);
  };

  const toggleLossyLe = () => {
    if (lossyLeEnabled) {
      // Disable: remove the flag and the params
      let y = removeYamlKey(driverYaml, "lossy_le");
      y = removeYamlKey(y, "le_R_e_eddy");
      y = removeYamlKey(y, "le_f_lossy_ref");
      onDriverYamlChange(y);
    } else {
      // Enable: add lossy_le: true + default params
      let y = setYamlBool(driverYaml, "lossy_le", true);
      y = setYamlFloat(y, "le_R_e_eddy", 0.5);
      y = setYamlFloat(y, "le_f_lossy_ref", 1000.0);
      onDriverYamlChange(y);
    }
  };

  const TOOLTIPS = {
    R_e_eddy:
      "Eddy-current resistance coefficient (Ω). Models the frequency-dependent loss in the voice coil due to eddy currents and proximity effects. Adds R_e_eddy × (f/f_ref)² to the voice coil resistance at high frequencies. Typically 0.1–2.0 Ω for mid-size drivers. Small for the FE166NV2.",
    f_ref:
      "Reference frequency (Hz) for the Lossy Le resistance scaling. At f = f_ref, the eddy-current resistance equals R_e_eddy. Hornresp page 77: f_ref typically 500–2000 Hz. Higher f_ref means eddy-current losses kick in at a higher frequency.",
  };

  return (
    <div style={{ padding: "8px 0" }}>
      {/* Enable/Disable toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "12px" }}>
          <input
            type="checkbox"
            checked={lossyLeEnabled}
            onChange={toggleLossyLe}
            style={{ accentColor: "var(--accent)" }}
          />
          <InfoTooltip content="Enable the Lossy Le model (frequency-dependent voice coil inductance). Adds eddy-current resistance R_e × (f/f_ref)² to the electrical impedance. More accurate for large motors at high frequencies. Hornresp page 77. LOW priority for FE166NV2.">
            <span style={{ fontWeight: 600, color: "var(--text)" }}>
              Lossy Le
            </span>
          </InfoTooltip>
        </label>
        {!lossyLeEnabled && (
          <span style={{ fontSize: "10px", color: "var(--text2)", fontStyle: "italic" }}>
            — disabled (Lossy Le model off; standard semi-inductance Le used)
          </span>
        )}
      </div>

      {lossyLeEnabled && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: "4px 16px", marginLeft: "4px" }}>
          {/* R_e_eddy */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "3px 0",
              borderBottom: "1px solid var(--border)",
              fontSize: "12px",
              cursor: editing === "R_e_eddy" ? "default" : "pointer",
            }}
            onClick={() => !editing && startEdit("R_e_eddy")}
          >
            <InfoTooltip content={TOOLTIPS.R_e_eddy}>
              <span style={{ color: "var(--text2)" }}>R_e_eddy (Ω)</span>
            </InfoTooltip>
            {editing === "R_e_eddy" ? (
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <input
                  ref={inputRef}
                  value={draft}
                  type="number"
                  step="0.1"
                  min="0"
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitR_e_eddy}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitR_e_eddy();
                    if (e.key === "Escape") setEditing(null);
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
                    width: "80px",
                    textAlign: "right",
                  }}
                />
              </div>
            ) : (
              <span style={{ color: "var(--accent)", fontFamily: "monospace", fontSize: "12px" }}>
                {le_R_e_eddy != null ? le_R_e_eddy.toFixed(2) : "—"}
              </span>
            )}
          </div>

          {/* f_ref */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "3px 0",
              borderBottom: "1px solid var(--border)",
              fontSize: "12px",
              cursor: editing === "f_ref" ? "default" : "pointer",
            }}
            onClick={() => !editing && startEdit("f_ref")}
          >
            <InfoTooltip content={TOOLTIPS.f_ref}>
              <span style={{ color: "var(--text2)" }}>f_ref (Hz)</span>
            </InfoTooltip>
            {editing === "f_ref" ? (
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <input
                  ref={inputRef}
                  value={draft}
                  type="number"
                  step="100"
                  min="1"
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitF_ref}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitF_ref();
                    if (e.key === "Escape") setEditing(null);
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
                    width: "80px",
                    textAlign: "right",
                  }}
                />
              </div>
            ) : (
              <span style={{ color: "var(--accent)", fontFamily: "monospace", fontSize: "12px" }}>
                {le_f_ref != null ? le_f_ref.toFixed(0) : "—"}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
