import { useState, useEffect, useCallback, useRef } from "react";
import yaml from "js-yaml";

const API_BASE = "http://localhost:8765";

// ─── Types ───────────────────────────────────────────────────────────────────

interface WavefrontFiles {
  frequencies: string[];
  snapshots: Record<string, string>;
  animations: Record<string, string>;
}

interface WavefrontComputeResponse {
  frequency_hz: number;
  k_radm: number;
  nx: number;
  ny: number;
  dx_m: number;
  dy_m: number;
  mesh_x: number[][];
  mesh_y: number[][];
  p_magnitude: number[][];
  p_real: number[][];
  horn_polygon_m: number[][];
  source_x_m: number;
  source_y_m: number;
  ka_validity: string;
}

interface WavefrontViewerProps {
  outputDir: string | null;
  onOutputDirChange: (dir: string) => void;
  /** Pre-populate geometry YAML from the App's current horn config */
  geometryYaml?: string;
  onGeometryChange?: (yaml: string) => void;
}

type ViewMode = "compute" | "browse";
type Colormap = "magma" | "viridis" | "plasma" | "inferno";

// ─── Geometry YAML parsing ─────────────────────────────────────────────────────

/** Parse `coordinates` from a YAML string as a list of [x, y] pairs in metres. */
function parseCoordinates(yaml: string): number[][] | null {
  const match = yaml.match(/coordinates:\s*\n((?:\s*-\s*\[[\d.,\s-]+\]\s*\n?)*)/);
  if (!match) return null;
  const pairs: number[][] = [];
  const lines = match[1].split("\n");
  for (const line of lines) {
    const m = line.match(/\[\s*([\d.e+-]+)\s*,\s*([\d.e+-]+)\s*\]/);
    if (m) pairs.push([parseFloat(m[1]), parseFloat(m[2])]);
  }
  return pairs.length >= 2 ? pairs : null;
}

// ─── Sections → polygon conversion (WavefrontViewer) ─────────────────────────
// Converts standard pyhorn `sections` YAML format into a 2-D horn polygon
// suitable for the wavefront solver's `coordinates` parameter.
// Each section describes the horn's cross-sectional profile along the path.
// We treat the horn as having a rectangular cross-section (width = height)
// so width = sqrt(area) × 2 / sqrt(pi) ≈ sqrt(area / π) × 2.
// The polygon traces the horn outline: throat → mouth (top edge),
// then mouth → throat (bottom edge), forming a closed loop.

interface HornSection {
  name: string;
  profile_type: string;
  length: number;
  start_area: number;
  end_area: number;
  hyperbolic_t?: number;
}

/** Convert a radius at position x within a section to a half-width (y coordinate).
 *  For a rectangular cross-section: width = sqrt(area), height = sqrt(area),
 *  so the "radius" in the profile plot = sqrt(area/π).  */
function sectionRadius(
  x: number,
  rt: number,
  rm: number,
  L: number,
  profile_type: string,
  hyperbolic_t = 0.5
): number {
  const pt = profile_type.toLowerCase();
  if (pt === "straight" || pt === "conical") {
    return rt; // constant radius (plane wave tube)
  }
  if (pt === "exponential") {
    if (L <= 0 || rt <= 0 || rm <= 0) return rt;
    const m = Math.log(rm / rt) / L;
    return rt * Math.exp(m * x);
  }
  if (pt === "hyperbolic") {
    if (L <= 0) return rt;
    const ratio = (rm * rm) / (rt * rt);
    const m = Math.acosh(Math.sqrt(ratio)) / L;
    return rt * (Math.cosh(m * x) + hyperbolic_t * Math.sinh(m * x));
  }
  if (pt === "parabolic") {
    if (L <= 0) return rt;
    const ratio = rm * rm - rt * rt;
    return Math.sqrt(rt * rt + (ratio * x) / L);
  }
  return rt; // fallback: straight
}

/** Convert sections YAML text → polygon coordinates [[x,y], ...].
 *  Returns null if the text does not contain a valid sections block.
 *  The polygon traces the top edge throat→mouth then bottom edge mouth→throat. */
function sectionsToPolygon(yamlText: string): number[][] | null {
  try {
    const doc = yaml.load(yamlText) as Record<string, unknown>;
    const rawSections = doc?.sections;
    if (!Array.isArray(rawSections) || rawSections.length === 0) return null;

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
    if (sections.length === 0) return null;

    const polygon: number[][] = [];
    let cumX = 0;
    const SAMPLES_PER_SECTION = 20;

    for (const sec of sections) {
      const rt = Math.sqrt(sec.start_area / Math.PI);
      const rm = Math.sqrt(sec.end_area / Math.PI);
      const L = sec.length;
      const pt = sec.profile_type || "exponential";
      const T = sec.hyperbolic_t ?? 0.5;

      for (let i = 0; i <= SAMPLES_PER_SECTION; i++) {
        const x = (i / SAMPLES_PER_SECTION) * L;
        const r = sectionRadius(x, rt, rm, L, pt, T);
        polygon.push([cumX + x, r]);
      }
      cumX += L;
    }

    // Bottom edge: walk back from mouth to throat
    for (let i = SAMPLES_PER_SECTION; i >= 0; i--) {
      const sec = sections[sections.length - 1];
      const rt = Math.sqrt(sec.start_area / Math.PI);
      const rm = Math.sqrt(sec.end_area / Math.PI);
      const L = sec.length;
      const pt = sec.profile_type || "exponential";
      const T = sec.hyperbolic_t ?? 0.5;
      // i/SAMPLES maps from SAMPLES→0 across the last section
      const x = (i / SAMPLES_PER_SECTION) * L;
      const r = sectionRadius(x, rt, rm, L, pt, T);
      polygon.push([cumX - L + x, -r]);
    }

    return polygon;
  } catch {
    return null;
  }
}

// ─── Colormap helpers (shared with SpectrogramPanel) ─────────────────────────

function buildColormap(name: Colormap): [number, number, number][] {
  const lut: [number, number, number][] = [];
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let r = 0, g = 0, b = 0;
    switch (name) {
      case "magma":
        r = Math.min(1, 0.7486 * t + 1.348 * t ** 2 - 0.6413 * t ** 3);
        g = Math.min(1, -0.0305 + 1.848 * t - 0.106 * t ** 2);
        b = Math.min(1, 0.227 + 1.774 * t - 2.003 * t ** 2 + 1.225 * t ** 3);
        break;
      case "inferno":
        r = Math.min(1, t + 0.622 * t ** 2 - 0.441 * t ** 3);
        g = Math.min(1, 0.207 + 1.444 * t - 0.906 * t ** 2 + 0.271 * t ** 3);
        b = Math.min(1, 0.094 + 1.474 * t - 1.374 * t ** 2 + 0.647 * t ** 3);
        break;
      case "plasma":
        r = Math.min(1, 0.058 * t + 1.565 * t ** 2 - 0.723 * t ** 3);
        g = Math.min(1, 0.221 - 0.711 * t + 1.461 * t ** 2);
        b = Math.min(1, 0.923 - 0.569 * t + 0.813 * t ** 2 - 0.385 * t ** 3);
        break;
      default: // viridis
        r = Math.min(1, 0.267 + 0.994 * t + 1.709 * t ** 2 - 6.507 * t ** 3 + 7.611 * t ** 4 - 3.419 * t ** 5);
        g = Math.min(1, -0.002 + 1.296 * t + 12.812 * t ** 2 - 40.21 * t ** 3 + 66.73 * t ** 4 - 43.82 * t ** 5 + 11.16 * t ** 6);
        b = Math.min(1, 0.001 + 1.669 * t - 3.475 * t ** 2 + 13.95 * t ** 3 - 25.62 * t ** 4 + 19.98 * t ** 5 - 5.863 * t ** 6);
        break;
    }
    lut.push([Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]);
  }
  return lut;
}

function sampleColormap(t: number, lut: [number, number, number][]): [number, number, number] {
  const idx = Math.max(0, Math.min(255, Math.round(t * 255)));
  return lut[idx];
}

// ─── Canvas pressure-field renderer ──────────────────────────────────────────

function drawPressureField(
  canvas: HTMLCanvasElement,
  data: WavefrontComputeResponse,
  cmapName: Colormap
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const W = rect.width;
  const H = rect.height;

  const { mesh_x, mesh_y, p_magnitude, horn_polygon_m } = data;

  // Compute world coordinate bounds from mesh
  const xMin = mesh_x[0][0];
  const xMax = mesh_x[0][mesh_x[0].length - 1];
  const yMin = mesh_y[0][0];
  const yMax = mesh_y[mesh_y.length - 1][0];

  const margin = 12;
  const plotW = W - margin * 2;
  const plotH = H - margin * 2;

  const toScreenX = (x: number) => margin + ((x - xMin) / (xMax - xMin)) * plotW;
  const toScreenY = (y: number) => margin + ((yMax - y) / (yMax - yMin)) * plotH;

  // Find pressure magnitude range for normalization
  let pMin = Infinity, pMax = -Infinity;
  for (const row of p_magnitude) {
    for (const v of row) {
      if (v < pMin) pMin = v;
      if (v > pMax) pMax = v;
    }
  }
  const range = pMax - pMin || 1;

  const lut = buildColormap(cmapName);
  const imgData = ctx.createImageData(canvas.width, canvas.height);
  const pixels = imgData.data;

  const ny = p_magnitude.length;
  const nx = p_magnitude[0].length;

  // Guard against degenerate mesh
  if (nx < 2 || ny < 2) return;

  // Guard against NaN/Infinity in pressure range
  if (!isFinite(pMin) || !isFinite(pMax) || range === 0) return;

  // Draw each grid cell
  for (let iy = 0; iy < ny - 1; iy++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      // Map grid cell to screen pixels
      const worldX0 = mesh_x[iy][ix];
      const worldX1 = mesh_x[iy][ix + 1];
      const worldY0 = mesh_y[iy][ix];
      const worldY1 = mesh_y[iy + 1][ix];

      // Clamp to logical pixel bounds [0, W] × [0, H]; canvas.width/height are physical
      const sx0 = Math.max(0, Math.min(W - 1, Math.floor(toScreenX(worldX0))));
      const sx1 = Math.max(sx0 + 1, Math.min(W, Math.ceil(toScreenX(worldX1))));
      const sy0 = Math.max(0, Math.min(H - 1, Math.floor(toScreenY(worldY0))));
      const sy1 = Math.max(sy0 + 1, Math.min(H, Math.ceil(toScreenY(worldY1))));

      // Guard against NaN in mesh data
      const pVal = p_magnitude[iy][ix];
      if (!isFinite(pVal)) continue;
      const t = Math.max(0, Math.min(1, (pVal - pMin) / range));
      const [r, g, b] = sampleColormap(t, lut);

      // Each CSS pixel (sx, sy) maps to a dpr×dpr block of physical pixels.
      // Physical pixel (physX, physY) = (sx*dpr+dx, sy*dpr+dy), 0≤dx,dpr<dpr.
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          for (let dy = 0; dy < dpr; dy++) {
            for (let dx = 0; dx < dpr; dx++) {
              const physX = sx * dpr + dx;
              const physY = sy * dpr + dy;
              const pi = (physY * canvas.width + physX) * 4;
              pixels[pi] = r;
              pixels[pi + 1] = g;
              pixels[pi + 2] = b;
              pixels[pi + 3] = 255;
            }
          }
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);

  // ── Overlay horn polygon ──────────────────────────────────────────────────
  if (horn_polygon_m.length >= 2) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(toScreenX(horn_polygon_m[0][0]), toScreenY(horn_polygon_m[0][1]));
    for (let i = 1; i < horn_polygon_m.length; i++) {
      ctx.lineTo(toScreenX(horn_polygon_m[i][0]), toScreenY(horn_polygon_m[i][1]));
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // ── Overlay source marker ────────────────────────────────────────────────
  const sx = toScreenX(data.source_x_m);
  const sy = toScreenY(data.source_y_m);
  ctx.beginPath();
  ctx.arc(sx, sy, 5, 0, 2 * Math.PI);
  ctx.fillStyle = "#ffd60a";
  ctx.fill();
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1;
  ctx.stroke();

  // ── Axis labels ─────────────────────────────────────────────────────────
  ctx.fillStyle = "#8b949e";
  ctx.font = "10px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`x (m)`, W / 2, H - 2);
  ctx.save();
  ctx.translate(8, H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("y (m)", 0, 0);
  ctx.restore();
}

// ─── Compute mode component ───────────────────────────────────────────────────

const CMAPS: Colormap[] = ["magma", "viridis", "plasma", "inferno"];

function ComputePanel({
  geometryYaml,
  onGeometryChange,
}: {
  geometryYaml?: string;
  onGeometryChange?: (yaml: string) => void;
}) {
  const [yamlText, setYamlText] = useState(geometryYaml ?? "");
  const [frequency, setFrequency] = useState(500);
  const [nx, setNx] = useState(80);
  const [ny, setNy] = useState(40);
  const [cmap, setCmap] = useState<Colormap>("magma");
  const [computeResult, setComputeResult] = useState<WavefrontComputeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Keep yamlText in sync when prop changes
  useEffect(() => {
    if (geometryYaml && geometryYaml !== yamlText) {
      setYamlText(geometryYaml);
    }
  }, [geometryYaml]);

  // Try explicit coordinates: block first, then fall back to sections→polygon
  const coords = parseCoordinates(yamlText) ?? sectionsToPolygon(yamlText);

  const handleCompute = useCallback(async () => {
    if (!coords) {
      setError("No valid `coordinates` found in geometry YAML. Make sure the YAML contains a coordinates: list.");
      return;
    }
    setLoading(true);
    setError(null);
    setComputeResult(null);
    try {
      const res = await fetch(`${API_BASE}/wavefront/compute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coordinates: coords,
          frequency,
          nx,
          ny,
          wall_thickness: 0.005,
          pml_width: 15,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data: WavefrontComputeResponse = await res.json();
      setComputeResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Compute failed");
    } finally {
      setLoading(false);
    }
  }, [coords, frequency, nx, ny]);

  // Redraw canvas whenever result or colormap changes
  useEffect(() => {
    if (!computeResult || !canvasRef.current) return;
    drawPressureField(canvasRef.current, computeResult, cmap);
  }, [computeResult, cmap]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {/* Geometry YAML textarea */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
          <label style={{ fontSize: "11px", color: "var(--text2)", fontWeight: 600 }}>
            Geometry YAML
          </label>
          <button
            onClick={() => onGeometryChange?.(yamlText)}
            style={{
              fontSize: "10px",
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: "3px",
              color: "var(--text2)",
              cursor: "pointer",
              padding: "1px 6px",
            }}
            title="Update App geometry"
          >
            ↩ Push to App
          </button>
        </div>
        <textarea
          value={yamlText}
          onChange={(e) => setYamlText(e.target.value)}
          placeholder={`Paste horn geometry YAML containing:\ncoordinates:\n  - [0.1, 0.2]\n  - [0.15, 0.3]\n  ...`}
          style={{
            width: "100%",
            height: "120px",
            background: "var(--bg3)",
            border: "1px solid var(--border)",
            borderRadius: "4px",
            color: "var(--text)",
            padding: "6px 8px",
            fontSize: "11px",
            fontFamily: "ui-monospace, monospace",
            resize: "vertical",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        {coords ? (
          <p style={{ fontSize: "10px", color: "var(--green)", margin: "2px 0 0" }}>
            ✓ {coords.length} polygon vertices parsed
            {yamlText.includes("sections:") ? " (from sections)" : ""}
          </p>
        ) : yamlText.trim() ? (
          <p style={{ fontSize: "10px", color: "var(--red)", margin: "2px 0 0" }}>
            ⚠ No geometry found — use `coordinates:` list or `sections:` block
          </p>
        ) : null}
      </div>

      {/* Parameters row */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: "11px", color: "var(--text2)" }}>
          Freq (Hz)
          <input
            type="number"
            value={frequency}
            onChange={(e) => setFrequency(parseFloat(e.target.value) || 500)}
            min={20}
            max={20000}
            style={{
              width: "70px",
              marginLeft: "4px",
              background: "var(--bg3)",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              color: "var(--text)",
              padding: "3px 6px",
              fontSize: "11px",
              outline: "none",
            }}
          />
        </label>
        <label style={{ fontSize: "11px", color: "var(--text2)" }}>
          NX
          <input
            type="number"
            value={nx}
            onChange={(e) => setNx(parseInt(e.target.value) || 80)}
            min={20}
            max={400}
            style={{
              width: "60px",
              marginLeft: "4px",
              background: "var(--bg3)",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              color: "var(--text)",
              padding: "3px 6px",
              fontSize: "11px",
              outline: "none",
            }}
          />
        </label>
        <label style={{ fontSize: "11px", color: "var(--text2)" }}>
          NY
          <input
            type="number"
            value={ny}
            onChange={(e) => setNy(parseInt(e.target.value) || 40)}
            min={20}
            max={400}
            style={{
              width: "60px",
              marginLeft: "4px",
              background: "var(--bg3)",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              color: "var(--text)",
              padding: "3px 6px",
              fontSize: "11px",
              outline: "none",
            }}
          />
        </label>
        <label style={{ fontSize: "11px", color: "var(--text2)" }}>
          Colormap
          <select
            value={cmap}
            onChange={(e) => setCmap(e.target.value as Colormap)}
            style={{
              marginLeft: "4px",
              background: "var(--bg3)",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              color: "var(--text)",
              padding: "3px 6px",
              fontSize: "11px",
              outline: "none",
            }}
          >
            {CMAPS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <button
          onClick={handleCompute}
          disabled={!coords || loading}
          style={{
            background: coords && !loading ? "var(--accent)" : "var(--bg3)",
            border: `1px solid ${coords && !loading ? "var(--accent)" : "var(--border)"}`,
            borderRadius: "4px",
            color: coords && !loading ? "var(--bg)" : "var(--text2)",
            cursor: coords && !loading ? "pointer" : "not-allowed",
            fontSize: "11px",
            fontWeight: 600,
            padding: "4px 12px",
          }}
        >
          {loading ? "⏳ Computing…" : "▶ Compute"}
        </button>
      </div>

      {error && (
        <p style={{ fontSize: "11px", color: "var(--red)" }}>⚠ {error}</p>
      )}

      {computeResult && (
        <div>
          <canvas
            ref={canvasRef}
            style={{
              width: "100%",
              height: "300px",
              borderRadius: "4px",
              border: "1px solid var(--border)",
              display: "block",
            }}
          />
          <div style={{ display: "flex", gap: "16px", marginTop: "6px", flexWrap: "wrap" }}>
            <p style={{ fontSize: "10px", color: "var(--text2)", margin: 0 }}>
              {computeResult.frequency_hz.toFixed(0)} Hz · k·a: {computeResult.k_radm.toFixed(2)} rad/m · grid: {computeResult.nx}×{computeResult.ny}
            </p>
            <p style={{ fontSize: "10px", color: "var(--text2)", margin: 0 }}>
              🟡 Source ({computeResult.source_x_m.toFixed(3)}, {computeResult.source_y_m.toFixed(3)}) m
            </p>
          </div>
          <p style={{ fontSize: "10px", color: "var(--green)", margin: "4px 0 0" }}>
            {computeResult.ka_validity}
          </p>
        </div>
      )}

      {!computeResult && !loading && !error && (
        <div
          style={{
            height: "300px",
            border: "1px dashed var(--border)",
            borderRadius: "4px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text2)",
            fontSize: "12px",
          }}
        >
          Load a geometry YAML and click Compute to render the 2-D pressure field
        </div>
      )}
    </div>
  );
}

// ─── Browse mode (existing file-browser behaviour) ───────────────────────────

function BrowsePanel({
  outputDir,
  onOutputDirChange,
}: {
  outputDir: string | null;
  onOutputDirChange: (dir: string) => void;
}) {
  const [wavefrontFiles, setWavefrontFiles] = useState<WavefrontFiles | null>(null);
  const [selectedFreq, setSelectedFreq] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgError, setImgError] = useState<Record<string, boolean>>({});
  const [showAnimation, setShowAnimation] = useState(false);

  const loadWavefrontFiles = useCallback(async (dir: string) => {
    setLoading(true);
    setError(null);
    setWavefrontFiles(null);
    setSelectedFreq(null);
    try {
      const res = await fetch(
        `${API_BASE}/fs/wavefront?path=${encodeURIComponent(dir)}`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data: WavefrontFiles = await res.json();
      setWavefrontFiles(data);
      if (data.frequencies.length > 0) {
        setSelectedFreq(data.frequencies[data.frequencies.length - 1]);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load wavefront files");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (outputDir) {
      loadWavefrontFiles(outputDir);
    }
  }, [outputDir, loadWavefrontFiles]);

  const currentPng = selectedFreq && wavefrontFiles?.snapshots[selectedFreq];
  const currentGif = selectedFreq && wavefrontFiles?.animations[selectedFreq];

  const handleImgError = (key: string) => {
    setImgError((prev) => ({ ...prev, [key]: true }));
  };

  const imgBase = currentPng ? `${API_BASE}/fs/read?path=${encodeURIComponent(currentPng)}` : null;
  const gifSrc = currentGif ? `${API_BASE}/fs/read?path=${encodeURIComponent(currentGif)}` : null;

  if (!outputDir) {
    return (
      <div>
        <p style={{ fontSize: "11px", color: "var(--text2)", marginBottom: "8px" }}>
          Run the wavefront simulator from CLI to generate pressure field
          visualisations, then point this panel at the output directory.
        </p>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <input
            type="text"
            placeholder="e.g. outputs/run_2024/"
            value={outputDir ?? ""}
            onChange={(e) => onOutputDirChange(e.target.value)}
            style={{
              flex: 1,
              background: "var(--bg3)",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              color: "var(--text)",
              padding: "5px 8px",
              fontSize: "12px",
              outline: "none",
            }}
          />
        </div>
        <p style={{ fontSize: "10px", color: "var(--text2)", marginTop: "6px" }}>
          CLI: <code style={{ background: "var(--bg3)", padding: "1px 4px", borderRadius: "3px" }}>
            pyhorn run --project myproject.yaml --wavefront --wavefront-freq 500 --output-dir outputs/run_2024/
          </code>
        </p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "10px" }}>
        <input
          type="text"
          placeholder="Output directory…"
          value={outputDir}
          onChange={(e) => onOutputDirChange(e.target.value)}
          style={{
            flex: 1,
            background: "var(--bg3)",
            border: "1px solid var(--border)",
            borderRadius: "4px",
            color: "var(--text)",
            padding: "5px 8px",
            fontSize: "12px",
            outline: "none",
          }}
        />
      </div>

      {loading && <p style={{ fontSize: "11px", color: "var(--text2)" }}>⏳ Scanning for wavefront files…</p>}
      {error && <p style={{ fontSize: "11px", color: "var(--red)" }}>⚠ {error}</p>}

      {!loading && !error && wavefrontFiles && wavefrontFiles.frequencies.length === 0 && (
        <div>
          <p style={{ fontSize: "11px", color: "var(--text2)", fontStyle: "italic", marginBottom: "8px" }}>
            No wavefront files found in this directory.
          </p>
          <p style={{ fontSize: "10px", color: "var(--text2)" }}>
            Run from CLI with <code style={{ background: "var(--bg3)", padding: "1px 4px", borderRadius: "3px" }}>--wavefront</code> first.
          </p>
        </div>
      )}

      {!loading && !error && wavefrontFiles && wavefrontFiles.frequencies.length > 0 && (
        <div>
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "10px" }}>
            {wavefrontFiles.frequencies.map((freq) => (
              <button
                key={freq}
                onClick={() => {
                  setSelectedFreq(freq);
                  setShowAnimation(false);
                }}
                style={{
                  background: selectedFreq === freq ? "var(--accent)" : "var(--bg3)",
                  border: `1px solid ${selectedFreq === freq ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: "4px",
                  color: selectedFreq === freq ? "var(--bg)" : "var(--text)",
                  cursor: "pointer",
                  fontSize: "11px",
                  padding: "3px 10px",
                  fontWeight: selectedFreq === freq ? "700" : "400",
                }}
              >
                {parseFloat(freq).toLocaleString()} Hz
              </button>
            ))}
          </div>

          {currentGif && (
            <div style={{ display: "flex", gap: "4px", marginBottom: "8px" }}>
              <button
                onClick={() => setShowAnimation(false)}
                style={{
                  background: !showAnimation ? "var(--bg3)" : "transparent",
                  border: `1px solid ${!showAnimation ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: "4px",
                  color: !showAnimation ? "var(--accent)" : "var(--text2)",
                  cursor: "pointer",
                  fontSize: "11px",
                  padding: "2px 10px",
                }}
              >
                📸 Snapshot
              </button>
              <button
                onClick={() => setShowAnimation(true)}
                style={{
                  background: showAnimation ? "var(--bg3)" : "transparent",
                  border: `1px solid ${showAnimation ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: "4px",
                  color: showAnimation ? "var(--accent)" : "var(--text2)",
                  cursor: "pointer",
                  fontSize: "11px",
                  padding: "2px 10px",
                }}
              >
                🎞 Animation
              </button>
            </div>
          )}

          <div style={{ position: "relative" }}>
            {showAnimation && gifSrc ? (
              <img
                key={`gif-${selectedFreq}`}
                src={gifSrc}
                alt={`Wavefront animation at ${selectedFreq} Hz`}
                style={{
                  width: "100%",
                  borderRadius: "4px",
                  border: "1px solid var(--border)",
                }}
                onError={() => handleImgError(`gif-${selectedFreq}`)}
              />
            ) : imgBase ? (
              <img
                key={`png-${selectedFreq}`}
                src={imgBase}
                alt={`Wavefront snapshot at ${selectedFreq} Hz`}
                style={{
                  width: "100%",
                  borderRadius: "4px",
                  border: "1px solid var(--border)",
                }}
                onError={() => handleImgError(`png-${selectedFreq}`)}
              />
            ) : null}

            {imgError[`png-${selectedFreq}`] && !showAnimation && (
              <p style={{ fontSize: "11px", color: "var(--red)", marginTop: "4px" }}>
                Failed to load PNG image.
              </p>
            )}
            {imgError[`gif-${selectedFreq}`] && showAnimation && (
              <p style={{ fontSize: "11px", color: "var(--red)", marginTop: "4px" }}>
                Failed to load GIF animation.
              </p>
            )}
          </div>

          <p style={{ fontSize: "10px", color: "var(--text2)", marginTop: "6px" }}>
            {wavefrontFiles.frequencies.length} frequency(ies) · click frequency to switch
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main WavefrontViewer ─────────────────────────────────────────────────────

export default function WavefrontViewer({
  outputDir,
  onOutputDirChange,
  geometryYaml,
  onGeometryChange,
}: WavefrontViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("compute");

  return (
    <section className="panel">
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
        <h2 style={{ margin: 0 }}>🌊 Wavefront</h2>
        {/* Mode toggle */}
        <div
          style={{
            display: "flex",
            background: "var(--bg3)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            padding: "2px",
            gap: "2px",
            marginLeft: "auto",
          }}
        >
          <button
            onClick={() => setViewMode("compute")}
            style={{
              background: viewMode === "compute" ? "var(--accent)" : "transparent",
              border: "none",
              borderRadius: "4px",
              color: viewMode === "compute" ? "var(--bg)" : "var(--text2)",
              cursor: "pointer",
              fontSize: "10px",
              fontWeight: 600,
              padding: "3px 10px",
            }}
          >
            ⚡ Compute
          </button>
          <button
            onClick={() => setViewMode("browse")}
            style={{
              background: viewMode === "browse" ? "var(--accent)" : "transparent",
              border: "none",
              borderRadius: "4px",
              color: viewMode === "browse" ? "var(--bg)" : "var(--text2)",
              cursor: "pointer",
              fontSize: "10px",
              fontWeight: 600,
              padding: "3px 10px",
            }}
          >
            📁 Browse
          </button>
        </div>
      </div>

      {viewMode === "compute" ? (
        <ComputePanel
          geometryYaml={geometryYaml}
          onGeometryChange={onGeometryChange}
        />
      ) : (
        <BrowsePanel outputDir={outputDir} onOutputDirChange={onOutputDirChange} />
      )}
    </section>
  );
}
