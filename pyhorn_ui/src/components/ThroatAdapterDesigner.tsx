import { useState, useCallback } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface ThroatAdapterDesignerProps {
  /** Called when user wants to insert ap1/lpt into the horn YAML */
  onInsertAdapter?: (ap1: number, lpt: number, profileType: string) => void;
}

interface AdapterResult {
  ap1_m2: number;
  lpt_m: number;
  minimum_length_m: number;
  profile_type: string;
  profile: {
    x: number[];
    area: number[];
    diam: number[];
    A0: number;
    Ap1: number;
  };
}

const PROFILE_TYPES = ["conical", "exponential", "parabolic", "cylindrical"];

export default function ThroatAdapterDesigner({ onInsertAdapter }: ThroatAdapterDesignerProps) {
  const [d1, setD1] = useState(50);
  const [d2, setD2] = useState(100);
  const [a1, setA1] = useState(30);
  const [a2, setA2] = useState(30);
  const [profileType, setProfileType] = useState("conical");
  const [lengthOverride, setLengthOverride] = useState("");
  const [useMinimumLength, setUseMinimumLength] = useState(true);
  const [result, setResult] = useState<AdapterResult | null>(null);
  const [yamlSnippet, setYamlSnippet] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const compute = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        D1_mm: d1,
        D2_mm: d2,
        A1_deg: a1,
        A2_deg: a2,
        profile_type: profileType,
      };
      if (useMinimumLength && result?.minimum_length_m != null) {
        body.length_mm = result.minimum_length_m * 1000; // m → mm
      } else if (lengthOverride !== "") {
        body.length_mm = Number(lengthOverride);
      }

      const [computeRes, exportRes] = await Promise.all([
        fetch("http://localhost:8765/throat-adapter/compute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        fetch(
          `http://localhost:8765/throat-adapter/export?D1_mm=${d1}&D2_mm=${d2}&A1_deg=${a1}&A2_deg=${a2}&profile_type=${profileType}${lengthOverride ? `&length_mm=${lengthOverride}` : ""}`
        ),
      ]);

      if (!computeRes.ok) {
        const err = await computeRes.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || `HTTP ${computeRes.status}`);
      }
      const computeData: AdapterResult = await computeRes.json();
      setResult(computeData);

      if (exportRes.ok) {
        const exportData = await exportRes.json();
        setYamlSnippet(exportData.yaml);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Computation failed");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [d1, d2, a1, a2, profileType, lengthOverride, useMinimumLength, result]);

  const copyYaml = useCallback(() => {
    if (!yamlSnippet) return;
    navigator.clipboard.writeText(yamlSnippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [yamlSnippet]);

  const insertIntoHorn = useCallback(() => {
    if (!result || !onInsertAdapter) return;
    onInsertAdapter(result.ap1_m2, result.lpt_m, result.profile_type);
  }, [result, onInsertAdapter]);

  // Build chart data from profile
  const chartData = result
    ? result.profile.x.map((xMm: number, i: number) => ({
        x: xMm,
        area: (result.profile.area[i] * 1e4), // m² → cm²
        diam: (result.profile.diam[i] * 1000), // m → mm
      }))
    : [];

  const d1Area = Math.PI * (d1 / 2) ** 2; // mm²
  const d2Area = Math.PI * (d2 / 2) ** 2; // mm²

  return (
    <div className="throat-adapter-designer">
      <div className="adapter-form">
        <h3>Throat Adapter Designer</h3>
        <p className="adapter-description">
          Compute the minimum-length throat adapter between the driver throat chamber and horn entry.
          Based on Hornresp page 87.
        </p>
        <div className="adapter-grid">
          <label>
            D1 — Throat chamber side (mm)
            <input
              type="number"
              value={d1}
              onChange={(e) => setD1(Number(e.target.value))}
              min={1}
            />
          </label>
          <label>
            D2 — Horn throat side (mm)
            <input
              type="number"
              value={d2}
              onChange={(e) => setD2(Number(e.target.value))}
              min={1}
            />
          </label>
          <label>
            A1 — Input flare angle (°)
            <input
              type="number"
              value={a1}
              onChange={(e) => setA1(Number(e.target.value))}
              min={1}
              max={89}
            />
          </label>
          <label>
            A2 — Output flare angle (°)
            <input
              type="number"
              value={a2}
              onChange={(e) => setA2(Number(e.target.value))}
              min={1}
              max={89}
            />
          </label>
          <label>
            Profile type
            <select value={profileType} onChange={(e) => setProfileType(e.target.value)}>
              {PROFILE_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={useMinimumLength}
              onChange={(e) => setUseMinimumLength(e.target.checked)}
            />
            Minimum length only
          </label>
          {!useMinimumLength && (
            <label>
              Length override (mm)
              <input
                type="number"
                value={lengthOverride}
                onChange={(e) => setLengthOverride(e.target.value)}
                placeholder="custom length"
                min={0}
              />
            </label>
          )}
        </div>

        <button onClick={compute} disabled={loading} className="btn-primary adapter-compute-btn">
          {loading ? "⏳ Computing…" : "🔧 Compute Adapter"}
        </button>

        {error && <div className="error-box">⚠ {error}</div>}

        {result && (
          <div className="adapter-results">
            <div className="adapter-summary">
              <h4>Adapter Summary</h4>
              <table className="adapter-summary-table">
                <tbody>
                  <tr>
                    <td>Throat chamber side</td>
                    <td>{d1.toFixed(1)} mm ({d1Area.toFixed(1)} mm²)</td>
                  </tr>
                  <tr>
                    <td>Horn throat side</td>
                    <td>{d2.toFixed(1)} mm ({d2Area.toFixed(1)} mm²)</td>
                  </tr>
                  <tr>
                    <td>Minimum length (Lpt)</td>
                    <td>{(result.minimum_length_m * 100).toFixed(2)} cm</td>
                  </tr>
                  <tr>
                    <td>Selected length (lpt)</td>
                    <td>{(result.lpt_m * 100).toFixed(2)} cm</td>
                  </tr>
                  <tr>
                    <td>Output area (ap1)</td>
                    <td>{(result.ap1_m2 * 1e4).toFixed(2)} cm²</td>
                  </tr>
                  <tr>
                    <td>Profile type</td>
                    <td>{result.profile_type}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {chartData.length > 0 && (
              <div className="adapter-profile-plot">
                <h4>Profile — Diameter (mm) vs Position</h4>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                    <XAxis
                      dataKey="x"
                      type="number"
                      tickFormatter={(v) => v.toFixed(0)}
                      stroke="#aaa"
                      fontSize={10}
                      label={{ value: "Position (mm)", position: "insideBottom", offset: -2, fill: "#aaa", fontSize: 10 }}
                    />
                    <YAxis
                      stroke="#aaa"
                      fontSize={10}
                      domain={["auto", "auto"]}
                      tickFormatter={(v) => v.toFixed(0)}
                    />
                    <Tooltip
                      formatter={(v: number) => [`${v.toFixed(2)} mm`, "Diameter"]}
                      contentStyle={{ background: "#1e1e1e", border: "1px solid #444" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="diam"
                      stroke="#00d4ff"
                      dot={false}
                      name="Diameter (mm)"
                      strokeWidth={1.5}
                    />
                  </LineChart>
                </ResponsiveContainer>
                <div className="adapter-profile-ref-lines">
                  <span className="ref-line">
                    <span className="ref-dot d1" /> D1 = {d1.toFixed(1)} mm
                  </span>
                  <span className="ref-line">
                    <span className="ref-dot d2" /> D2 = {d2.toFixed(1)} mm
                  </span>
                </div>
              </div>
            )}

            {yamlSnippet && (
              <div className="adapter-yaml-section">
                <div className="yaml-header">
                  <h4>YAML Snippet</h4>
                  <div className="yaml-actions">
                    <button onClick={copyYaml} className="btn-outline btn-sm">
                      {copied ? "✅ Copied!" : "📋 Copy"}
                    </button>
                    {onInsertAdapter && (
                      <button onClick={insertIntoHorn} className="btn-outline btn-sm">
                        ➕ Insert into Horn YAML
                      </button>
                    )}
                  </div>
                </div>
                <pre className="yaml-snippet">{yamlSnippet}</pre>
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        .throat-adapter-designer {
          padding: 0;
        }
        .adapter-form {
          padding: 12px 16px;
        }
        .adapter-form h3 {
          margin: 0 0 4px 0;
          font-size: 1em;
          color: #00d4ff;
        }
        .adapter-description {
          margin: 0 0 12px 0;
          font-size: 0.8em;
          color: #888;
        }
        .adapter-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          margin-bottom: 10px;
        }
        .adapter-grid label {
          display: flex;
          flex-direction: column;
          font-size: 0.75em;
          color: #ccc;
          gap: 2px;
        }
        .checkbox-label {
          flex-direction: row !important;
          align-items: center;
          gap: 6px !important;
          padding-top: 18px;
        }
        .checkbox-label input[type="checkbox"] {
          width: 14px;
          height: 14px;
          accent-color: #00d4ff;
        }
        .adapter-grid input,
        .adapter-grid select {
          padding: 4px 6px;
          background: #2a2a2a;
          border: 1px solid #444;
          border-radius: 4px;
          color: #eee;
          font-size: 0.9em;
        }
        .adapter-compute-btn {
          width: 100%;
          margin-bottom: 10px;
        }
        .adapter-results {
          border-top: 1px solid #333;
          padding-top: 10px;
        }
        .adapter-summary h4,
        .adapter-profile-plot h4,
        .adapter-yaml-section h4 {
          margin: 0 0 6px 0;
          font-size: 0.85em;
          color: #aaa;
        }
        .adapter-profile-plot {
          margin: 12px 0;
        }
        .adapter-profile-ref-lines {
          display: flex;
          gap: 16px;
          font-size: 0.75em;
          color: #888;
          margin-top: 4px;
        }
        .ref-line {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .ref-dot {
          display: inline-block;
          width: 10px;
          height: 2px;
          border-radius: 1px;
        }
        .ref-dot.d1 { background: #f59e0b; }
        .ref-dot.d2 { background: #ef4444; }
        .adapter-summary-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.8em;
        }
        .adapter-summary-table td {
          padding: 3px 6px;
          border-bottom: 1px solid #2a2a2a;
        }
        .adapter-summary-table td:first-child {
          color: #888;
        }
        .adapter-summary-table td:last-child {
          color: #eee;
          text-align: right;
          font-family: monospace;
        }
        .yaml-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;
        }
        .yaml-actions {
          display: flex;
          gap: 6px;
        }
        .btn-sm {
          padding: 2px 8px !important;
          font-size: 0.75em !important;
        }
        .yaml-snippet {
          background: #1a1a1a;
          border: 1px solid #333;
          border-radius: 4px;
          padding: 8px 10px;
          font-size: 0.75em;
          color: #86efac;
          overflow-x: auto;
          white-space: pre;
          margin: 0;
        }
        .adapter-yaml-section {
          margin-top: 10px;
        }
        .error-box {
          background: #2a1a1a;
          border: 1px solid #ef4444;
          border-radius: 4px;
          padding: 6px 10px;
          font-size: 0.8em;
          color: #ef4444;
          margin-bottom: 8px;
        }
      `}</style>
    </div>
  );
}
