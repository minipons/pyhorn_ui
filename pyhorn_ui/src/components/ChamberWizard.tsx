import { useState, useCallback, useMemo } from "react";

export interface ChamberWizardProps {
  driverYaml?: string;
  hornYaml?: string;
  onApplyToProject?: (yamlSnippet: string) => void;
}

// ── Parse existing horn chamber values from hornYaml ─────────────────────────
// Handles both flat keys (vrc, lrc, vtc, atc) and nested throat_adapter (ap1, lpt)
function parseHornChamberParams(hornYaml: string): Partial<{
  vrc_L: number; lrc_cm: number; vtc_cm3: number;
  atc_cm2: number; ap1_cm2: number; lpt_cm: number;
}> {
  if (!hornYaml) return {};
  const result: Partial<ReturnType<typeof parseHornChamberParams>> = {};
  const lines = hornYaml.split("\n");
  let inThroatAdapter = false;

  for (const line of lines) {
    const commentIdx = line.indexOf("#");
    const clean = commentIdx >= 0 ? line.slice(0, commentIdx) : line;

    // Track throat_adapter block
    if (clean.trim() === "throat_adapter:") { inThroatAdapter = true; continue; }
    // Exit throat_adapter block on any top-level key (non-indented line)
    if (!clean.startsWith(" ") && !clean.startsWith("\t") && clean.trim() !== "") {
      inThroatAdapter = false;
    }

    // Match any key at the right indentation level
    const m = clean.match(/^(\s*|)(\w+):\s*([\d.e+-]+)/);
    if (!m) continue;

    const indent = m[1];
    const key = m[2];
    const val = parseFloat(m[3]);
    const isNested = indent.length > 0;

    // Flat keys (vrc, lrc, vtc, atc) — also handles old nested rear_chamber/throat_chamber
    if (!isNested && !inThroatAdapter) {
      if (key === "vrc") result.vrc_L = val * 1000;
      else if (key === "lrc") result.lrc_cm = val * 100;
      else if (key === "vtc") result.vtc_cm3 = val * 1e6;
      else if (key === "atc") result.atc_cm2 = val * 1e4;
    }
    // Nested keys inside throat_adapter block
    if (inThroatAdapter && isNested) {
      if (key === "ap1") result.ap1_cm2 = val;    // stored as cm²
      else if (key === "lpt") result.lpt_cm = val / 10; // stored as mm → cm
    }
    // Also handle old nested rear_chamber.vrc, throat_chamber.vtc etc.
    if (isNested && !inThroatAdapter) {
      // e.g. "  vrc:" inside "rear_chamber:" block
      if (key === "vrc") result.vrc_L = val * 1000;
      else if (key === "lrc") result.lrc_cm = val * 100;
      else if (key === "vtc") result.vtc_cm3 = val * 1e6;
      else if (key === "atc") result.atc_cm2 = val * 1e4;
    }
  }

  return result;
}

// ── YAML parsing helpers ───────────────────────────────────────────────────────
function parseDriverParam(yaml: string, key: string): number | null {
  const m = yaml.match(new RegExp(`^\\s*${key}\\s*:\\s*([\\d.e+-]+)`, "mi"));
  return m ? parseFloat(m[1]) : null;
}

interface TSPParams {
  fs: number | null;
  qts: number | null;
  vas: number | null;
  sd: number | null;
  sd_cm2: number | null;
}

function parseTSP(yaml: string): TSPParams {
  const sd_m2 = parseDriverParam(yaml, "sd");
  const sd_cm2 = sd_m2 != null ? sd_m2 * 1e4 : null;
  return {
    fs: parseDriverParam(yaml, "fs"),
    qts: parseDriverParam(yaml, "qts"),
    vas: parseDriverParam(yaml, "vas"),
    sd: sd_m2,
    sd_cm2,
  };
}

interface ComputedChamberParams {
  vrc_L: number;
  lrc_m: number;
  vtc_m3: number;
  vtc_cm3: number;
  atc_m2: number;
  atc_cm2: number;
  ap1_m2: number;
  ap1_cm2: number;
  lpt_m: number;
  lpt_cm: number;
}

// ── Core computation ─────────────────────────────────────────────────────────
function computeChamberParams(tsp: TSPParams): ComputedChamberParams {
  // Vrc = Vas × (Qts² / Qts_target² - 1)  [m³], Vas is in m³
  const QTS_TARGET = 0.6;
  const vrc_m3 =
    tsp.vas != null && tsp.qts != null
      ? tsp.vas * (Math.pow(tsp.qts, 2) / Math.pow(QTS_TARGET, 2) - 1)
      : 0;

  // Lrc from Vrc and a default box cross-section 200mm × 200mm = 0.04 m²
  const BOX_AREA_M2 = 0.04;
  const lrc_m = vrc_m3 > 0 ? vrc_m3 / BOX_AREA_M2 : 0;

  // Vtc = small fixed volume ~0.0001 m³ (100 cm³)
  const VTC_M3 = 0.0001;

  // Atc ≈ Sd (throat chamber area should match driver piston area)
  const atc_m2 = tsp.sd ?? Math.PI * Math.pow(0.058, 2) / 4; // fallback: ~58mm dia

  // Ap1 = area of 50mm diameter hole
  const AP1_DIAM_M = 0.050;
  const ap1_m2 = Math.PI * Math.pow(AP1_DIAM_M / 2, 2);

  // Lpt = baffle thickness ~12mm
  const LPT_M = 0.012;

  return {
    vrc_L: vrc_m3 * 1000,
    lrc_m,
    vtc_m3: VTC_M3,
    vtc_cm3: VTC_M3 * 1e6,
    atc_m2,
    atc_cm2: atc_m2 * 1e4,
    ap1_m2,
    ap1_cm2: ap1_m2 * 1e4,
    lpt_m: LPT_M,
    lpt_cm: LPT_M * 100,
  };
}

// ── Validation ────────────────────────────────────────────────────────────────
interface Validation {
  vrc_warning: string | null;
  lrc_warning: string | null;
  vtc_warning: string | null;
  atc_warning: string | null;
  ap1_warning: string | null;
  lpt_warning: string | null;
}

function validateChamber(p: ComputedChamberParams, tsp: TSPParams): Validation {
  const warnings: Validation = {
    vrc_warning: null,
    lrc_warning: null,
    vtc_warning: null,
    atc_warning: null,
    ap1_warning: null,
    lpt_warning: null,
  };

  if (p.vrc_L < 0.5 || p.vrc_L > 30) {
    warnings.vrc_warning = p.vrc_L < 0.5
      ? "too small — system Q too high, peaky response"
      : "very large — may be unnecessary";
  }

  if (p.lrc_m * 100 < 3 || p.lrc_m * 100 > 80) {
    warnings.lrc_warning = "unrealistic for a box dimension";
  }

  if (p.vtc_cm3 < 5 || p.vtc_cm3 > 500) {
    warnings.vtc_warning = p.vtc_cm3 < 5
      ? "tiny — dust cap clearance only"
      : "unusually large for a throat chamber";
  }

  if (tsp.sd != null) {
    if (p.atc_cm2 > 2 * tsp.sd_cm2!) {
      warnings.atc_warning = "Atc > 2× Sd — weak coupling, reflections";
    } else if (p.atc_cm2 < 0.5 * tsp.sd_cm2!) {
      warnings.atc_warning = "Atc < 0.5× Sd — restricted airflow";
    }
  }

  if (tsp.sd != null && p.ap1_cm2 < 0.5 * tsp.sd_cm2!) {
    warnings.ap1_warning = "Ap1 < 0.5× Sd — restricted airflow";
  }

  if (p.lpt_cm < 3 || p.lpt_cm > 50) {
    warnings.lpt_warning = "unusual baffle thickness";
  }

  return warnings;
}

// ── YAML generation ──────────────────────────────────────────────────────────
// Outputs flat keys matching the HornParameters API schema and EditableHornSummary
// All geometry values are stored in SI units (m, m², m³) for consistency
function buildYamlSnippet(p: ComputedChamberParams): string {
  return `vrc: ${(p.vrc_L * 1e-3).toFixed(5)}  # liters → m³
lrc: ${p.lrc_m.toFixed(4)}  # meters
vtc: ${p.vtc_m3.toFixed(6)}
atc: ${p.atc_cm2.toFixed(4)}
throat_adapter:
  ap1: ${p.ap1_cm2.toFixed(4)}
  lpt: ${(p.lpt_m * 1000).toFixed(2)}  # meters → mm`;
}

// ── Signal Chain SVG ──────────────────────────────────────────────────────────
function SignalChainDiagram() {
  const nodes = [
    { label: "Driver\nCone", icon: "🔊" },
    { label: "Rear Chamber\n(Vrc / Lrc)", icon: "📦" },
    { label: "Throat Chamber\n(Vtc / Atc)", icon: "🔶" },
    { label: "Baffle Hole\n(Ap1 / Lpt)", icon: "⚪" },
    { label: "Horn\nThroat", icon: "🐚" },
  ];

  const svgW = 480;
  const nodeW = 72;
  const nodeH = 48;
  const gap = 18;
  const totalW = nodes.length * nodeW + (nodes.length - 1) * gap;
  const startX = (svgW - totalW) / 2;
  const cy = 36;

  return (
    <svg
      viewBox={`0 0 ${svgW} 72`}
      width="100%"
      style={{ maxWidth: "100%", display: "block", margin: "0 auto" }}
      aria-label="Acoustic signal chain diagram"
    >
      {nodes.map((node, i) => {
        const x = startX + i * (nodeW + gap);
        const isLast = i === nodes.length - 1;
        const nextX = isLast ? x + nodeW : startX + (i + 1) * (nodeW + gap);

        return (
          <g key={i}>
            {/* Arrow line */}
            {!isLast && (
              <>
                <line
                  x1={x + nodeW}
                  y1={cy}
                  x2={nextX}
                  y2={cy}
                  stroke="#00d4ff"
                  strokeWidth={1.5}
                  opacity={0.7}
                />
                <polygon
                  points={`${nextX - 5},${cy - 4} ${nextX},${cy} ${nextX - 5},${cy + 4}`}
                  fill="#00d4ff"
                  opacity={0.7}
                />
              </>
            )}

            {/* Node box */}
            <rect
              x={x}
              y={cy - nodeH / 2}
              width={nodeW}
              height={nodeH}
              rx={6}
              fill="#1e2a3a"
              stroke="#00d4ff"
              strokeWidth={1}
              opacity={0.9}
            />

            {/* Node label */}
            <text
              x={x + nodeW / 2}
              y={cy - 4}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#eee"
              fontSize={8}
              fontFamily="monospace"
            >
              {node.label.split("\n").map((line, li) => (
                <tspan key={li} x={x + nodeW / 2} dy={li === 0 ? "-0.5em" : "1.1em"}>
                  {line}
                </tspan>
              ))}
            </text>

            {/* Icon */}
            <text
              x={x + nodeW / 2}
              y={cy + 14}
              textAnchor="middle"
              fontSize={12}
            >
              {node.icon}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Individual editable param state ───────────────────────────────────────────
interface EditableParams {
  vrc_L: number;
  lrc_cm: number;
  vtc_cm3: number;
  atc_cm2: number;
  ap1_cm2: number;
  lpt_cm: number;
}

// ── Slider component ──────────────────────────────────────────────────────────
interface ParamSliderProps {
  name: string;
  desc: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  warning: string | null;
  onChange: (v: number) => void;
  decimals?: number;
}

function ParamSlider({
  name,
  desc,
  value,
  unit,
  min,
  max,
  step,
  warning,
  onChange,
  decimals = 2,
}: ParamSliderProps) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

  return (
    <div className={`cw-param-row ${warning ? "cw-param-row--warn" : ""}`}>
      <div className="cw-param-label">
        <span className="cw-param-name">{name}</span>
        <span className="cw-param-desc">{desc}</span>
      </div>
      <div className="cw-param-slider-group">
        <span className={`cw-param-value ${warning ? "cw-param-value--warn" : ""}`}>
          {value.toFixed(decimals)} {unit}
        </span>
        {warning && <span className="cw-error">{warning}</span>}
        <div className="cw-slider-track">
          <div className="cw-slider-fill" style={{ width: `${pct}%` }} />
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="cw-slider"
          />
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ChamberWizard({ driverYaml, hornYaml, onApplyToProject }: ChamberWizardProps) {
  const [tsp] = useState(() => parseTSP(driverYaml ?? ""));
  const existing = useMemo(() => parseHornChamberParams(hornYaml ?? ""), [hornYaml]);

  const defaultParams = useCallback((): EditableParams => {
    const p = computeChamberParams(tsp);
    return {
      // Prefer values from hornYaml if they exist, otherwise compute from TSP
      vrc_L: existing.vrc_L ?? p.vrc_L,
      lrc_cm: existing.lrc_cm ?? p.lrc_m * 100,
      vtc_cm3: existing.vtc_cm3 ?? p.vtc_cm3,
      atc_cm2: existing.atc_cm2 ?? p.atc_cm2,
      ap1_cm2: existing.ap1_cm2 ?? p.ap1_cm2,
      lpt_cm: existing.lpt_cm ?? p.lpt_cm,
    };
  }, [tsp, existing]);

  const [params, setParams] = useState<EditableParams>(defaultParams);

  const warnings = useMemo(
    () => {
      const p: ComputedChamberParams = {
        vrc_L: params.vrc_L,
        lrc_m: params.lrc_cm / 100,
        vtc_m3: params.vtc_cm3 / 1e6,
        vtc_cm3: params.vtc_cm3,
        atc_m2: params.atc_cm2 / 1e4,
        atc_cm2: params.atc_cm2,
        ap1_m2: params.ap1_cm2 / 1e4,
        ap1_cm2: params.ap1_cm2,
        lpt_m: params.lpt_cm / 100,
        lpt_cm: params.lpt_cm,
      };
      return validateChamber(p, tsp);
    },
    [params, tsp]
  );

  const yamlSnippet = useMemo(
    () =>
      buildYamlSnippet({
        vrc_L: params.vrc_L,
        lrc_m: params.lrc_cm / 100,
        vtc_m3: params.vtc_cm3 / 1e6,
        vtc_cm3: params.vtc_cm3,
        atc_m2: params.atc_cm2 / 1e4,
        atc_cm2: params.atc_cm2,
        ap1_m2: params.ap1_cm2 / 1e4,
        ap1_cm2: params.ap1_cm2,
        lpt_m: params.lpt_cm / 100,
        lpt_cm: params.lpt_cm,
      }),
    [params]
  );

  const [copied, setCopied] = useState(false);
  const [applied, setApplied] = useState(false);
  const [designed, setDesigned] = useState(false);
  const [parseError, setParseError] = useState<string | null>(
    tsp.fs == null ? "Could not parse driver YAML — enter values manually" : null
  );
  const [apiLoading, setApiLoading] = useState(false);
  const [apiWarnings, setApiWarnings] = useState<string[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);

  const designForMe = useCallback(async () => {
    if (!driverYaml) {
      setParseError("No driver YAML provided — pass driverYaml prop");
      return;
    }
    const fresh = parseTSP(driverYaml);
    if (fresh.fs == null) {
      setParseError("Could not parse driver YAML — enter values manually");
      return;
    }
    if (fresh.vas == null || fresh.qts == null || fresh.sd == null) {
      setParseError("Driver YAML is missing vas, qts, or sd — can't compute");
      return;
    }

    setApiLoading(true);
    setApiError(null);
    setApiWarnings([]);
    setParseError(null);

    try {
      // vas in YAML is in m³ (e.g. 0.0369), sd in YAML is in m²
      const response = await fetch("http://localhost:8765/chamber-wizard/compute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vas_m3: fresh.vas,   // already in m³
          qts: fresh.qts,
          sd_m2: fresh.sd,    // already in m²
          qts_target: 0.6,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail ?? `HTTP ${response.status}`);
      }

      const data = await response.json();

      setParams((p) => ({
        ...p,
        vrc_L: data.vrc_l,
        lrc_cm: data.lrc_cm,
        vtc_cm3: data.vtc_cm3,
        atc_cm2: data.atc_cm2,
        // ap1_cm2 and lpt_cm are not returned by the API — keep current values
      }));

      setApiWarnings(data.warnings ?? []);
      setApplied(false);
      setDesigned(true);
      setTimeout(() => setDesigned(false), 5000);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "API call failed");
    } finally {
      setApiLoading(false);
    }
  }, [driverYaml]);

  const copyYaml = useCallback(() => {
    navigator.clipboard.writeText(yamlSnippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [yamlSnippet]);

  const applyToProject = useCallback(() => {
    if (!onApplyToProject) return;
    onApplyToProject(yamlSnippet);
    setApplied(true);
    setTimeout(() => setApplied(false), 2000);
  }, [yamlSnippet, onApplyToProject]);

  // Slider handlers — Vrc and Lrc are linked via box area
  const BOX_AREA_M2 = 0.04;

  const handleVrcChange = (v: number) => {
    const lrc = (v / 1000) / BOX_AREA_M2 * 100; // Vrc(L) → Lrc(cm)
    setParams((p) => ({ ...p, vrc_L: v, lrc_cm: lrc }));
  };

  const handleLrcChange = (v: number) => {
    // Changing Lrc independently: recalculate what box area would give this Lrc
    // but keep Vrc as user-set value — they control both independently
    setParams((p) => ({ ...p, lrc_cm: v }));
  };

  const handleVtcChange = (v: number) => setParams((p) => ({ ...p, vtc_cm3: v }));
  const handleAtcChange = (v: number) => setParams((p) => ({ ...p, atc_cm2: v }));
  const handleAp1Change = (v: number) => setParams((p) => ({ ...p, ap1_cm2: v }));
  const handleLptChange = (v: number) => setParams((p) => ({ ...p, lpt_cm: v }));

  return (
    <div className="chamber-wizard">
      <div className="cw-header">
        <h3>🎛 Chamber Design Wizard</h3>
        <p className="cw-subtitle">
          Estimate Vrc, Lrc, Vtc, Atc, Ap1, Lpt from driver T-S parameters
        </p>
      </div>

      {/* Signal Chain Diagram */}
      <div className="cw-signal-chain">
        <SignalChainDiagram />
      </div>

      <div className="cw-divider" />

      {/* Design-for-me section */}
      <div className="cw-design-section">
        {parseError ? (
          <div className="cw-parse-error">⚠ {parseError}</div>
        ) : (
          <div className="cw-tsp-summary">
            <span>T-S: fs={tsp.fs?.toFixed(1)} Hz · Qts={tsp.qts?.toFixed(2)} · Vas={tsp.vas != null ? (tsp.vas * 1e6).toFixed(1) : "?"} L · Sd={tsp.sd_cm2?.toFixed(1)} cm²</span>
          </div>
        )}
        {apiError && (
          <div className="cw-parse-error">⚠ API error: {apiError}</div>
        )}
        {apiWarnings.length > 0 && (
          <div className="cw-warnings">
            {apiWarnings.map((w, i) => (
              <div key={i} className="cw-warning-item">⚠ {w}</div>
            ))}
          </div>
        )}
        <button
          onClick={designForMe}
          className="btn-primary cw-design-btn"
          disabled={apiLoading || !!parseError}
        >
          {apiLoading ? "⏳ Computing…" : "🪄 Design for me"}
        </button>
        {designed && (
          <div className="cw-toast">✅ Design computed from driver T-S params — adjust sliders to fine-tune</div>
        )}
        <p className="cw-estimate-note">
          ⚠ This is an <em>estimate</em> — computed from a simplified model.
          Use simulation to validate.
        </p>
      </div>

      <div className="cw-divider" />

      {/* Parameter sliders */}
      <div className="cw-params">
        <p className="cw-slider-hint">Adjust values or click "Design for me" to recompute from T-S params.</p>

        <ParamSlider
          name="Vrc"
          desc="Rear chamber volume — too small = peaky, too large = no loading"
          value={params.vrc_L}
          unit="L"
          min={0.5}
          max={30}
          step={0.1}
          warning={warnings.vrc_warning}
          onChange={handleVrcChange}
        />

        <ParamSlider
          name="Lrc"
          desc="Rear chamber path length — derived from Vrc & 200×200mm box"
          value={params.lrc_cm}
          unit="cm"
          min={3}
          max={80}
          step={0.5}
          warning={warnings.lrc_warning}
          onChange={handleLrcChange}
        />

        <ParamSlider
          name="Vtc"
          desc="Throat chamber volume — dust cap clearance & acoustic coupling"
          value={params.vtc_cm3}
          unit="cm³"
          min={5}
          max={500}
          step={1}
          warning={warnings.vtc_warning}
          onChange={handleVtcChange}
          decimals={1}
        />

        <ParamSlider
          name="Atc"
          desc="Throat chamber area — should be ≈ Sd for good coupling"
          value={params.atc_cm2}
          unit="cm²"
          min={5}
          max={100}
          step={0.5}
          warning={warnings.atc_warning}
          onChange={handleAtcChange}
        />

        <ParamSlider
          name="Ap1"
          desc="Baffle hole area — controls coupling to horn throat"
          value={params.ap1_cm2}
          unit="cm²"
          min={1}
          max={80}
          step={0.5}
          warning={warnings.ap1_warning}
          onChange={handleAp1Change}
        />

        <ParamSlider
          name="Lpt"
          desc="Baffle / neck thickness — affects throat resonance"
          value={params.lpt_cm}
          unit="cm"
          min={3}
          max={50}
          step={0.5}
          warning={warnings.lpt_warning}
          onChange={handleLptChange}
        />
      </div>

      <div className="cw-divider" />

      {/* YAML output */}
      <div className="cw-yaml-section">
        <div className="cw-yaml-header">
          <h4>YAML Snippet</h4>
          <div className="cw-yaml-actions">
            <button onClick={copyYaml} className="btn-outline btn-sm">
              {copied ? "✅ Copied!" : "📋 Copy"}
            </button>
            {onApplyToProject && (
              <button onClick={applyToProject} className="btn-outline btn-sm">
                {applied ? "✅ Applied!" : "➕ Apply to Project"}
              </button>
            )}
          </div>
        </div>
        <pre className="cw-yaml-snippet">{yamlSnippet}</pre>
      </div>

      <style>{`
        .chamber-wizard {
          padding: 0;
        }
        .cw-header {
          padding: 12px 16px 8px;
        }
        .cw-header h3 {
          margin: 0 0 2px 0;
          font-size: 1em;
          color: #00d4ff;
        }
        .cw-subtitle {
          margin: 0;
          font-size: 0.75em;
          color: #888;
        }
        .cw-signal-chain {
          padding: 8px 12px;
          background: #16162a;
          border-radius: 6px;
          margin: 0 12px 8px;
        }
        .cw-divider {
          height: 1px;
          background: #2a2a3a;
          margin: 8px 0;
        }
        .cw-design-section {
          padding: 8px 16px 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .cw-tsp-summary {
          font-size: 0.72em;
          color: #888;
          font-family: monospace;
          background: #1a1a2e;
          border: 1px solid #2a2a3a;
          border-radius: 4px;
          padding: 4px 8px;
          overflow-x: auto;
          white-space: nowrap;
        }
        .cw-parse-error {
          font-size: 0.78em;
          color: #f59e0b;
          background: #2a1f00;
          border: 1px solid #f59e0b44;
          border-radius: 4px;
          padding: 4px 8px;
        }
        .cw-design-btn {
          width: 100%;
        }
        .cw-estimate-note {
          margin: 0;
          font-size: 0.72em;
          color: #666;
          font-style: italic;
        }
        .cw-estimate-note em {
          color: #f59e0b;
          font-style: normal;
        }
        .cw-warnings {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .cw-warning-item {
          font-size: 0.72em;
          color: #f59e0b;
          background: #2a1f00;
          border: 1px solid #f59e0b44;
          border-radius: 4px;
          padding: 3px 8px;
        }
        .cw-toast {
          font-size: 0.75em;
          color: #86efac;
          background: #0f2a1a;
          border: 1px solid #86efac66;
          border-radius: 4px;
          padding: 5px 10px;
          animation: cw-toast-in 0.2s ease-out;
        }
        @keyframes cw-toast-in {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .cw-params {
          padding: 0 16px 8px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .cw-param-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 5px 8px;
          border-radius: 4px;
          background: #1a1a2e;
          border: 1px solid #2a2a3a;
          gap: 8px;
        }
        .cw-param-label {
          display: flex;
          flex-direction: column;
          gap: 1px;
          flex: 1;
          min-width: 0;
        }
        .cw-param-name {
          font-family: monospace;
          font-size: 0.82em;
          color: #00d4ff;
          font-weight: 600;
        }
        .cw-param-desc {
          font-size: 0.68em;
          color: #777;
        }
        .cw-param-value-group {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 2px;
          flex-shrink: 0;
        }
        .cw-param-value {
          font-family: monospace;
          font-size: 0.82em;
          color: #eee;
          font-weight: 500;
          flex-shrink: 0;
        }
        .cw-param-value--warn {
          color: #f87171;
        }
        .cw-warning {
          font-size: 0.65em;
          color: #f59e0b;
        }
        .cw-error {
          font-size: 0.65em;
          color: #f87171;
          font-weight: 500;
        }
        .cw-slider-hint {
          margin: 0 0 6px 0;
          font-size: 0.7em;
          color: #666;
          font-style: italic;
        }
        .cw-param-slider-group {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 3px;
          flex-shrink: 0;
          min-width: 130px;
        }
        .cw-slider-track {
          position: relative;
          width: 120px;
          height: 4px;
          background: #2a2a3a;
          border-radius: 2px;
        }
        .cw-slider-fill {
          position: absolute;
          left: 0;
          top: 0;
          height: 100%;
          background: #00d4ff;
          border-radius: 2px;
          pointer-events: none;
        }
        .cw-slider {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          left: 0;
          width: 100%;
          margin: 0;
          opacity: 0;
          cursor: pointer;
          height: 16px;
        }
        .cw-param-row--warn {
          border-color: #f8717144;
          background: #2a1010;
        }
        .cw-param-row--warn .cw-param-name {
          color: #f87171;
        }
        .cw-yaml-section {
          padding: 0 16px 12px;
        }
        .cw-yaml-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;
        }
        .cw-yaml-header h4 {
          margin: 0;
          font-size: 0.82em;
          color: #aaa;
        }
        .cw-yaml-actions {
          display: flex;
          gap: 6px;
        }
        .cw-yaml-snippet {
          background: #1a1a1a;
          border: 1px solid #333;
          border-radius: 4px;
          padding: 8px 10px;
          font-size: 0.73em;
          color: #86efac;
          overflow-x: auto;
          white-space: pre;
          margin: 0;
          max-height: 160px;
          overflow-y: auto;
        }
        .btn-sm {
          padding: 2px 8px !important;
          font-size: 0.75em !important;
        }
      `}</style>
    </div>
  );
}
