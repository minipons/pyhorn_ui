import { useState, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";

interface ResizeWizardPanelProps {
  /** Optional: pre-populate the geometry YAML (e.g. from the current App state) */
  initialGeometryYaml?: string;
  /** Optional: pre-populate the driver YAML */
  initialDriverYaml?: string;
  /** Called when the user wants to load the resized YAML into the main horn/driver editors */
  onLoadResized?: (geometryYaml: string, driverYaml: string) => void;
}

interface ResizeResult {
  geometry_yaml: string;
  driver_yaml: string;
  factor: number;
}

export default function ResizeWizardPanel({
  initialGeometryYaml = "",
  initialDriverYaml = "",
  onLoadResized,
}: ResizeWizardPanelProps) {
  const [geometryYaml, setGeometryYaml] = useState(initialGeometryYaml);
  const [driverYaml, setDriverYaml] = useState(initialDriverYaml);
  const [resizeFactor, setResizeFactor] = useState(1.0);
  const [adjustSd, setAdjustSd] = useState(true);
  const [adjustRe, setAdjustRe] = useState(false);
  const [result, setResult] = useState<ResizeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedGeo, setCopiedGeo] = useState(false);
  const [copiedDriver, setCopiedDriver] = useState(false);
  const [activeTab, setActiveTab] = useState<"geometry" | "driver">("geometry");

  const pickFile = useCallback(
    async (target: "geometry" | "driver") => {
      try {
        const selected = await open({
          multiple: false,
          filters: [{ name: "YAML", extensions: ["yaml", "yml"] }],
        });
        if (selected && typeof selected === "string") {
          const res = await fetch(
            `http://localhost:8765/fs/read?path=${encodeURIComponent(selected)}`
          );
          if (!res.ok) throw new Error(`Failed to read file: ${res.status}`);
          const { content } = await res.json();
          if (target === "geometry") {
            setGeometryYaml(content);
          } else {
            setDriverYaml(content);
          }
        }
      } catch (e) {
        console.error("File picker error:", e);
      }
    },
    []
  );

  const compute = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("http://localhost:8765/resize/compute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          geometry_yaml: geometryYaml,
          driver_yaml: driverYaml,
          resize_factor: resizeFactor,
          adjust_sd: adjustSd,
          adjust_re: adjustRe,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data: ResizeResult = await res.json();
      setResult(data);
      setActiveTab("geometry");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Resize failed");
    } finally {
      setLoading(false);
    }
  }, [geometryYaml, driverYaml, resizeFactor, adjustSd, adjustRe]);

  const copyYaml = useCallback(
    (which: "geometry" | "driver") => {
      if (!result) return;
      const text = which === "geometry" ? result.geometry_yaml : result.driver_yaml;
      navigator.clipboard.writeText(text).then(() => {
        if (which === "geometry") {
          setCopiedGeo(true);
          setTimeout(() => setCopiedGeo(false), 1500);
        } else {
          setCopiedDriver(true);
          setTimeout(() => setCopiedDriver(false), 1500);
        }
      });
    },
    [result]
  );

  const downloadYaml = useCallback(
    (which: "geometry" | "driver") => {
      if (!result) return;
      const text = which === "geometry" ? result.geometry_yaml : result.driver_yaml;
      const filename =
        which === "geometry"
          ? `resized_geometry_x${resizeFactor.toFixed(2)}.yaml`
          : `resized_driver_x${resizeFactor.toFixed(2)}.yaml`;
      const blob = new Blob([text], { type: "text/yaml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    [result, resizeFactor]
  );

  const handleLoadResized = useCallback(() => {
    if (!result || !onLoadResized) return;
    onLoadResized(result.geometry_yaml, result.driver_yaml);
  }, [result, onLoadResized]);

  // Parse a simple scalar from YAML for display in the summary
  const parseScalar = (yaml: string, key: string): string => {
    const m = yaml.match(new RegExp(`^\\s*${key}\\s*:\\s*([\\d.e+-]+)`, "mi"));
    return m ? parseFloat(m[1]).toFixed(4) : "—";
  };

  const scaleLabel =
    resizeFactor > 1
      ? `↑ Larger (×${resizeFactor})`
      : resizeFactor < 1
      ? `↓ Smaller (×${resizeFactor})`
      : "×1 (no change)";

  return (
    <div className="resize-wizard">
      {/* ── Input Section ── */}
      <div className="rw-section">
        <p className="rw-description">
          Scale horn geometry and driver Sd proportionally. Shifts the response in
          frequency while preserving curve shape. Based on Hornresp page 68.
        </p>

        {/* Resize Factor */}
        <div className="rw-factor-row">
          <label className="rw-factor-label">
            Resize factor
            <input
              type="number"
              className="rw-factor-input"
              value={resizeFactor}
              onChange={(e) => setResizeFactor(Number(e.target.value))}
              min={0.01}
              max={10}
              step={0.05}
            />
          </label>
          <span className="rw-scale-badge">{scaleLabel}</span>
        </div>

        {/* Toggles */}
        <div className="rw-toggles">
          <label className="rw-toggle-label">
            <input
              type="checkbox"
              checked={adjustSd}
              onChange={(e) => setAdjustSd(e.target.checked)}
            />
            Scale driver Sd (×factor²)
          </label>
          <label className="rw-toggle-label">
            <input
              type="checkbox"
              checked={adjustRe}
              onChange={(e) => setAdjustRe(e.target.checked)}
            />
            Scale driver Re (×factor²)
          </label>
        </div>

        {/* Geometry YAML */}
        <label className="rw-yaml-label">Horn Geometry YAML</label>
        <div className="rw-yaml-header">
          <button
            onClick={() => pickFile("geometry")}
            className="btn-outline"
            style={{ fontSize: "11px", padding: "3px 10px" }}
          >
            📂 Load file
          </button>
        </div>
        <textarea
          className="rw-textarea"
          value={geometryYaml}
          onChange={(e) => setGeometryYaml(e.target.value)}
          placeholder="# Paste or load a horn geometry YAML&#10;throat_area: 0.01327&#10;mouth_area: 0.3&#10;path_length: 2.5&#10;..."
          spellCheck={false}
        />

        {/* Driver YAML */}
        <label className="rw-yaml-label" style={{ marginTop: "10px" }}>
          Driver YAML
        </label>
        <div className="rw-yaml-header">
          <button
            onClick={() => pickFile("driver")}
            className="btn-outline"
            style={{ fontSize: "11px", padding: "3px 10px" }}
          >
            📂 Load file
          </button>
        </div>
        <textarea
          className="rw-textarea"
          value={driverYaml}
          onChange={(e) => setDriverYaml(e.target.value)}
          placeholder="# Paste or load a driver YAML&#10;fs: 49.6&#10;qts: 0.27&#10;..."
          spellCheck={false}
        />

        <button
          onClick={compute}
          disabled={loading || !geometryYaml.trim() || !driverYaml.trim()}
          className="btn-primary rw-compute-btn"
        >
          {loading ? "⏳ Computing…" : "🔧 Compute Resize"}
        </button>

        {error && <div className="error-box">⚠ {error}</div>}
      </div>

      {/* ── Results Section ── */}
      {result && (
        <div className="rw-results">
          <div className="rw-results-header">
            <h4>Resized Output — ×{result.factor.toFixed(2)}</h4>
            <div className="rw-results-actions">
              <button
                onClick={handleLoadResized}
                className="btn-outline btn-sm"
                title="Load into main editor"
              >
                ⬆ Load into editor
              </button>
            </div>
          </div>

          {/* Quick summary */}
          <div className="rw-summary">
            <div className="rw-summary-grid">
              <div className="rw-summary-item">
                <span className="rw-summary-key">Throat area</span>
                <span className="rw-summary-val">
                  {parseScalar(result.geometry_yaml, "throat_area")} m²
                </span>
              </div>
              <div className="rw-summary-item">
                <span className="rw-summary-key">Mouth area</span>
                <span className="rw-summary-val">
                  {parseScalar(result.geometry_yaml, "mouth_area")} m²
                </span>
              </div>
              <div className="rw-summary-item">
                <span className="rw-summary-key">Path length</span>
                <span className="rw-summary-val">
                  {parseScalar(result.geometry_yaml, "path_length")} m
                </span>
              </div>
              {adjustSd && (
                <div className="rw-summary-item">
                  <span className="rw-summary-key">Driver Sd</span>
                  <span className="rw-summary-val">
                    {parseScalar(result.driver_yaml, "sd")} m²
                  </span>
                </div>
              )}
              {adjustRe && (
                <div className="rw-summary-item">
                  <span className="rw-summary-key">Driver Re</span>
                  <span className="rw-summary-val">
                    {parseScalar(result.driver_yaml, "re")} Ω
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Tab bar */}
          <div className="rw-tabs">
            <button
              className={`rw-tab ${activeTab === "geometry" ? "rw-tab-active" : ""}`}
              onClick={() => setActiveTab("geometry")}
            >
              Geometry YAML
            </button>
            <button
              className={`rw-tab ${activeTab === "driver" ? "rw-tab-active" : ""}`}
              onClick={() => setActiveTab("driver")}
            >
              Driver YAML
            </button>
          </div>

          {/* YAML display */}
          <div className="rw-yaml-display">
            <div className="rw-yaml-actions">
              <button
                onClick={() => copyYaml(activeTab)}
                className="btn-outline btn-sm"
              >
                {copiedGeo && activeTab === "geometry"
                  ? "✅ Copied!"
                  : copiedDriver && activeTab === "driver"
                  ? "✅ Copied!"
                  : "📋 Copy YAML"}
              </button>
              <button
                onClick={() => downloadYaml(activeTab)}
                className="btn-outline btn-sm"
              >
                📥 Download YAML
              </button>
            </div>
            <pre className="rw-yaml-pre">
              {activeTab === "geometry"
                ? result.geometry_yaml
                : result.driver_yaml}
            </pre>
          </div>
        </div>
      )}

      <style>{`
        .resize-wizard {
          padding: 0;
        }
        .rw-section {
          padding: 12px 16px;
        }
        .rw-description {
          margin: 0 0 12px 0;
          font-size: 0.8em;
          color: #888;
          line-height: 1.4;
        }
        .rw-factor-row {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 10px;
        }
        .rw-factor-label {
          display: flex;
          flex-direction: column;
          font-size: 0.8em;
          color: #ccc;
          gap: 4px;
        }
        .rw-factor-input {
          width: 100px;
          padding: 5px 8px;
          background: #2a2a2a;
          border: 1px solid #444;
          border-radius: 4px;
          color: #eee;
          font-size: 1em;
        }
        .rw-scale-badge {
          font-size: 0.8em;
          padding: 3px 10px;
          border-radius: 20px;
          background: rgba(0, 212, 255, 0.12);
          color: #00d4ff;
          border: 1px solid rgba(0, 212, 255, 0.25);
          white-space: nowrap;
        }
        .rw-toggles {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 10px;
        }
        .rw-toggle-label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.8em;
          color: #ccc;
          cursor: pointer;
        }
        .rw-toggle-label input[type="checkbox"] {
          width: 14px;
          height: 14px;
          accent-color: #00d4ff;
        }
        .rw-yaml-label {
          display: block;
          font-size: 0.8em;
          color: #aaa;
          margin-bottom: 4px;
        }
        .rw-yaml-header {
          display: flex;
          gap: 8px;
          margin-bottom: 4px;
        }
        .rw-textarea {
          width: 100%;
          min-height: 80px;
          max-height: 180px;
          resize: vertical;
          background: #1a1a1a;
          border: 1px solid #444;
          border-radius: 4px;
          color: #86efac;
          font-family: "SF Mono", "Fira Code", monospace;
          font-size: 0.75em;
          padding: 8px;
          line-height: 1.5;
          box-sizing: border-box;
        }
        .rw-textarea:focus {
          outline: none;
          border-color: #00d4ff;
        }
        .rw-compute-btn {
          width: 100%;
          margin-top: 10px;
        }
        .rw-results {
          border-top: 1px solid #333;
          padding: 12px 16px;
        }
        .rw-results-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }
        .rw-results-header h4 {
          margin: 0;
          font-size: 0.9em;
          color: #00d4ff;
        }
        .rw-results-actions {
          display: flex;
          gap: 6px;
        }
        .rw-summary {
          background: #1a1a1a;
          border: 1px solid #2a2a2a;
          border-radius: 6px;
          padding: 8px 10px;
          margin-bottom: 10px;
        }
        .rw-summary-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px 16px;
        }
        .rw-summary-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.78em;
        }
        .rw-summary-key {
          color: #888;
        }
        .rw-summary-val {
          color: #eee;
          font-family: monospace;
        }
        .rw-tabs {
          display: flex;
          gap: 2px;
          margin-bottom: 6px;
        }
        .rw-tab {
          flex: 1;
          padding: 4px 8px;
          font-size: 0.75em;
          background: #2a2a2a;
          border: 1px solid #444;
          border-radius: 4px 4px 0 0;
          color: #888;
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
        }
        .rw-tab-active {
          background: #1a1a1a;
          color: #eee;
          border-bottom-color: #1a1a1a;
        }
        .rw-yaml-display {
          background: #1a1a1a;
          border: 1px solid #333;
          border-radius: 0 0 6px 6px;
        }
        .rw-yaml-actions {
          display: flex;
          gap: 6px;
          padding: 6px 8px;
          border-bottom: 1px solid #2a2a2a;
        }
        .rw-yaml-pre {
          margin: 0;
          padding: 10px 12px;
          font-size: 0.75em;
          color: #86efac;
          font-family: "SF Mono", "Fira Code", monospace;
          overflow-x: auto;
          white-space: pre;
          max-height: 300px;
          overflow-y: auto;
          line-height: 1.5;
        }
        .btn-sm {
          padding: 2px 8px !important;
          font-size: 0.75em !important;
        }
        .error-box {
          background: #2a1a1a;
          border: 1px solid #ef4444;
          border-radius: 4px;
          padding: 6px 10px;
          font-size: 0.8em;
          color: #ef4444;
          margin-top: 8px;
        }
      `}</style>
    </div>
  );
}
