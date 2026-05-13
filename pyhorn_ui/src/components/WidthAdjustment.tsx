import { useState, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";

interface WidthAdjustmentProps {
  /** Pre-populate with current horn geometry YAML */
  initialGeometryYaml?: string;
  /** Called when user wants to load the adjusted YAML into the main horn editor */
  onLoadAdjusted?: (geometryYaml: string) => void;
}

interface WidthAdjustmentResult {
  geometry_yaml: string;
  width_factor: number;
}

export default function WidthAdjustment({
  initialGeometryYaml = "",
  onLoadAdjusted,
}: WidthAdjustmentProps) {
  const [geometryYaml, setGeometryYaml] = useState(initialGeometryYaml);
  const [widthFactor, setWidthFactor] = useState(1.0); // multiplier, 1.0 = no change
  const [result, setResult] = useState<WidthAdjustmentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Parsed rectangular segment info for preview
  const [segmentCount, setSegmentCount] = useState<number>(0);
  const [originalWidths, setOriginalWidths] = useState<number[]>([]);
  const [originalAreas, setOriginalAreas] = useState<number[]>([]);

  const pickFile = useCallback(async () => {
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
        setGeometryYaml(content);
        // Also parse rectangular segments from the YAML for preview
        parseRectangularSegmentsPreview(content);
      }
    } catch (e) {
      console.error("File picker error:", e);
    }
  }, []);

  const parseRectangularSegmentsPreview = (yaml: string) => {
    try {
      const lines = yaml.split("\n");
      let inRect = false;
      let collecting = false;
      const segLines: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "rectangular_segments:" || trimmed === "rectangular_segments") {
          inRect = true;
          collecting = true;
          continue;
        }
        if (collecting) {
          if (line.match(/^\S/) && !line.startsWith(" ") && !line.startsWith("\t")) {
            // New top-level key, stop collecting
            break;
          }
          if ((line.match(/^\s+-\s+\[/) || line.match(/^\s+-\s+\[/)) && inRect) {
            segLines.push(line.trim());
          } else if (trimmed === "" || trimmed.startsWith("#")) {
            // skip blank/comment
          } else if (inRect && segLines.length > 0 && !trimmed.startsWith("-") && !trimmed.startsWith("[")) {
            // we've moved past the segments list
            break;
          }
        }
      }

      const widths: number[] = [];
      const heights: number[] = [];
      const areas: number[] = [];

      for (const segLine of segLines) {
        // Extract the list items: "[w1, h1, w2, h2, L, ...]"
        const match = segLine.match(/\[([^\]]+)\]/);
        if (!match) continue;
        const parts = match[1].split(",").map((p) => parseFloat(p.trim()));
        if (parts.length >= 4) {
          const w1 = parts[0], h1 = parts[1], w2 = parts[2], h2 = parts[3];
          widths.push(w1, w2);
          heights.push(h1, h2);
          areas.push(w1 * h1, w2 * h2);
        }
      }

      setSegmentCount(segLines.length);
      setOriginalWidths(widths);
      setOriginalAreas(areas);
    } catch {
      setSegmentCount(0);
      setOriginalWidths([]);
      setOriginalAreas([]);
    }
  };

  const compute = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("http://localhost:8765/width-adjustment/compute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          geometry_yaml: geometryYaml,
          width_factor: widthFactor,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data: WidthAdjustmentResult = await res.json();
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Width adjustment failed");
    } finally {
      setLoading(false);
    }
  }, [geometryYaml, widthFactor]);

  const copyYaml = useCallback(() => {
    if (!result) return;
    navigator.clipboard.writeText(result.geometry_yaml).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [result]);

  const downloadYaml = useCallback(() => {
    if (!result) return;
    const blob = new Blob([result.geometry_yaml], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `horn_width_x${widthFactor.toFixed(2)}.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [result, widthFactor]);

  const handleLoadAdjusted = useCallback(() => {
    if (!result || !onLoadAdjusted) return;
    onLoadAdjusted(result.geometry_yaml);
  }, [result, onLoadAdjusted]);

  // Auto-parse on geometryYaml change
  const handleYamlChange = useCallback((yaml: string) => {
    setGeometryYaml(yaml);
    parseRectangularSegmentsPreview(yaml);
  }, []);

  // Unique mouth area values (start and end of last segment)
  const originalMouthArea =
    originalAreas.length >= 2
      ? originalAreas[originalAreas.length - 1]
      : null;
  const previewMouthArea =
    originalMouthArea != null ? originalMouthArea * widthFactor : null;

  const widthPct = Math.round((widthFactor - 1) * 100);
  const widthLabel =
    widthFactor > 1
      ? `+${widthPct}% wider`
      : widthFactor < 1
      ? `${widthPct}% narrower`
      : "×1 (no change)";

  return (
    <div className="width-adjustment">
      <div className="wa-section">
        <p className="wa-description">
          Vary the width of a rectangular horn from its initial value while keeping
          the height constant. Based on Hornresp page 77. Useful for optimising
          rectangular cross-section horns.
        </p>

        {/* Width Factor */}
        <div className="wa-factor-row">
          <label className="wa-factor-label">
            Width factor
            <input
              type="number"
              className="wa-factor-input"
              value={widthFactor}
              onChange={(e) => setWidthFactor(Math.max(0.01, Math.min(10, Number(e.target.value))))}
              min={0.01}
              max={10}
              step={0.05}
            />
          </label>
          <div className="wa-factor-badges">
            <span className="wa-scale-badge">{widthLabel}</span>
            {segmentCount > 0 && (
              <span className="wa-seg-badge">{segmentCount} segments</span>
            )}
          </div>
        </div>

        {/* Quick presets */}
        <div className="wa-presets">
          {[0.5, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5].map((v) => (
            <button
              key={v}
              className={`wa-preset-btn ${widthFactor === v ? "wa-preset-active" : ""}`}
              onClick={() => setWidthFactor(v)}
            >
              {v < 1 ? `${Math.round(v * 100)}%` : v === 1 ? "×1" : `×${v}`}
            </button>
          ))}
        </div>

        {/* Slider */}
        <div className="wa-slider-row">
          <span className="wa-slider-label">50%</span>
          <input
            type="range"
            className="wa-slider"
            min={0.5}
            max={1.5}
            step={0.01}
            value={Math.min(Math.max(widthFactor, 0.5), 1.5)}
            onChange={(e) => setWidthFactor(Number(e.target.value))}
          />
          <span className="wa-slider-label">150%</span>
        </div>

        {/* Dimensions Preview */}
        {originalWidths.length > 0 && (
          <div className="wa-preview">
            <div className="wa-preview-grid">
              {originalAreas.length >= 2 && (
                <>
                  <div className="wa-preview-item">
                    <span className="wa-preview-key">Throat area</span>
                    <span className="wa-preview-val">
                      {originalAreas[0] < 0.001
                        ? `${(originalAreas[0] * 1e6).toFixed(1)} cm²`
                        : `${(originalAreas[0] * 1e4).toFixed(2)} cm²`}
                    </span>
                  </div>
                  <div className="wa-preview-item">
                    <span className="wa-preview-key">Mouth area</span>
                    <span className="wa-preview-val">
                      {originalMouthArea != null
                        ? originalMouthArea < 0.001
                          ? `${(originalMouthArea * 1e6).toFixed(1)} cm²`
                          : `${(originalMouthArea * 1e4).toFixed(2)} cm²`
                        : "—"}
                    </span>
                  </div>
                  <div className="wa-preview-item">
                    <span className="wa-preview-key">→ Mouth area</span>
                    <span className="wa-preview-val wa-preview-new">
                      {previewMouthArea != null
                        ? previewMouthArea < 0.001
                          ? `${(previewMouthArea * 1e6).toFixed(1)} cm²`
                          : `${(previewMouthArea * 1e4).toFixed(2)} cm²`
                        : "—"}
                    </span>
                  </div>
                  <div className="wa-preview-item">
                    <span className="wa-preview-key">Area change</span>
                    <span
                      className={`wa-preview-val ${
                        widthFactor > 1 ? "wa-preview-up" : widthFactor < 1 ? "wa-preview-down" : ""
                      }`}
                    >
                      {widthFactor > 1 ? "+" : ""}
                      {Math.round((widthFactor - 1) * 100)}%
                    </span>
                  </div>
                </>
              )}
            </div>
            <p className="wa-preview-note">
              Heights unchanged · Mouth width ×{widthFactor.toFixed(2)}
            </p>
          </div>
        )}

        {/* Geometry YAML */}
        <label className="wa-yaml-label">Horn Geometry YAML</label>
        <div className="wa-yaml-header">
          <button
            onClick={pickFile}
            className="btn-outline"
            style={{ fontSize: "11px", padding: "3px 10px" }}
          >
            📂 Load file
          </button>
        </div>
        <textarea
          className="wa-textarea"
          value={geometryYaml}
          onChange={(e) => handleYamlChange(e.target.value)}
          placeholder="# Paste or load a horn geometry YAML&#10;rectangular_segments:&#10;  - [0.10, 0.15, 0.15, 0.15, 0.05]&#10;..."
          spellCheck={false}
        />

        <button
          onClick={compute}
          disabled={loading || !geometryYaml.trim()}
          className="btn-primary wa-compute-btn"
        >
          {loading ? "⏳ Computing…" : "🔧 Apply Width Adjustment"}
        </button>

        {error && <div className="error-box">⚠ {error}</div>}
      </div>

      {/* Results */}
      {result && (
        <div className="wa-results">
          <div className="wa-results-header">
            <h4>Adjusted Output — ×{result.width_factor.toFixed(2)} width</h4>
            <div className="wa-results-actions">
              <button
                onClick={handleLoadAdjusted}
                className="btn-outline btn-sm"
                title="Load into main editor"
              >
                ⬆ Load into editor
              </button>
            </div>
          </div>

          <div className="wa-yaml-display">
            <div className="wa-yaml-actions">
              <button onClick={copyYaml} className="btn-outline btn-sm">
                {copied ? "✅ Copied!" : "📋 Copy YAML"}
              </button>
              <button onClick={downloadYaml} className="btn-outline btn-sm">
                📥 Download YAML
              </button>
            </div>
            <pre className="wa-yaml-pre">{result.geometry_yaml}</pre>
          </div>
        </div>
      )}

      <style>{`
        .width-adjustment {
          padding: 0;
        }
        .wa-section {
          padding: 12px 16px;
        }
        .wa-description {
          margin: 0 0 12px 0;
          font-size: 0.8em;
          color: #888;
          line-height: 1.4;
        }
        .wa-factor-row {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 8px;
        }
        .wa-factor-label {
          display: flex;
          flex-direction: column;
          font-size: 0.8em;
          color: #ccc;
          gap: 4px;
        }
        .wa-factor-input {
          width: 100px;
          padding: 5px 8px;
          background: #2a2a2a;
          border: 1px solid #444;
          border-radius: 4px;
          color: #eee;
          font-size: 1em;
        }
        .wa-factor-badges {
          display: flex;
          flex-direction: column;
          gap: 4px;
          align-items: flex-start;
          padding-top: 2px;
        }
        .wa-scale-badge {
          font-size: 0.8em;
          padding: 3px 10px;
          border-radius: 20px;
          background: rgba(0, 212, 255, 0.12);
          color: #00d4ff;
          border: 1px solid rgba(0, 212, 255, 0.25);
          white-space: nowrap;
        }
        .wa-seg-badge {
          font-size: 0.75em;
          padding: 2px 8px;
          border-radius: 20px;
          background: rgba(168, 85, 247, 0.12);
          color: #a855f7;
          border: 1px solid rgba(168, 85, 247, 0.25);
          white-space: nowrap;
        }
        .wa-presets {
          display: flex;
          gap: 4px;
          margin-bottom: 8px;
          flex-wrap: wrap;
        }
        .wa-preset-btn {
          padding: 3px 10px;
          font-size: 0.75em;
          background: #2a2a2a;
          border: 1px solid #444;
          border-radius: 4px;
          color: #aaa;
          cursor: pointer;
          transition: background 0.15s, color 0.15s, border-color 0.15s;
        }
        .wa-preset-btn:hover {
          background: #333;
          color: #eee;
        }
        .wa-preset-active {
          background: rgba(0, 212, 255, 0.15);
          border-color: #00d4ff;
          color: #00d4ff;
        }
        .wa-slider-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 10px;
        }
        .wa-slider-label {
          font-size: 0.72em;
          color: #666;
          min-width: 28px;
        }
        .wa-slider {
          flex: 1;
          accent-color: #00d4ff;
          cursor: pointer;
        }
        .wa-preview {
          background: #1a1a1a;
          border: 1px solid #2a2a2a;
          border-radius: 6px;
          padding: 8px 10px;
          margin-bottom: 10px;
        }
        .wa-preview-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px 16px;
        }
        .wa-preview-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.78em;
        }
        .wa-preview-key {
          color: #888;
        }
        .wa-preview-val {
          color: #eee;
          font-family: monospace;
        }
        .wa-preview-new {
          color: #00d4ff;
        }
        .wa-preview-up {
          color: #22c55e;
        }
        .wa-preview-down {
          color: #f85149;
        }
        .wa-preview-note {
          margin: 6px 0 0;
          font-size: 0.72em;
          color: #666;
        }
        .wa-yaml-label {
          display: block;
          font-size: 0.8em;
          color: #aaa;
          margin-bottom: 4px;
        }
        .wa-yaml-header {
          display: flex;
          gap: 8px;
          margin-bottom: 4px;
        }
        .wa-textarea {
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
        .wa-textarea:focus {
          outline: none;
          border-color: #00d4ff;
        }
        .wa-compute-btn {
          width: 100%;
          margin-top: 10px;
        }
        .wa-results {
          border-top: 1px solid #333;
          padding: 12px 16px;
        }
        .wa-results-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }
        .wa-results-header h4 {
          margin: 0;
          font-size: 0.9em;
          color: #00d4ff;
        }
        .wa-results-actions {
          display: flex;
          gap: 6px;
        }
        .wa-yaml-display {
          background: #1a1a1a;
          border: 1px solid #333;
          border-radius: 6px;
        }
        .wa-yaml-actions {
          display: flex;
          gap: 6px;
          padding: 6px 8px;
          border-bottom: 1px solid #2a2a2a;
        }
        .wa-yaml-pre {
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
