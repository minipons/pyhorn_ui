import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { SimulationResult } from "../types/simulation";
import ChartTitle from "./ChartTitle";

const API_BASE = "http://localhost:8765";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SpectrogramData {
  time_ms: number[];
  freq_hz: number[];
  stft_db: number[][]; // [time_idx][freq_idx]
  window_ms: number;
  overlap: number;
}

interface SpectrogramPanelProps {
  result: SimulationResult | null;
  onSpectrogramResult?: (data: SpectrogramData) => void;
}

type Colormap = "magma" | "viridis" | "plasma" | "inferno";
type ColorScale = "linear" | "log";

interface FreqPreset {
  label: string;
  fMin: number;
  fMax: number;
}

const FREQ_PRESETS: FreqPreset[] = [
  { label: "Full", fMin: 20, fMax: 20000 },
  { label: "Bass", fMin: 20, fMax: 500 },
  { label: "Mid", fMin: 500, fMax: 5000 },
  { label: "High", fMin: 5000, fMax: 20000 },
];

// ─── Colormap LUTs (256 entries each) ───────────────────────────────────────

function buildColormap(name: Colormap): [number, number, number][] {
  // Generate a perceptual colormap using simple polynomial approximations
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
      case "viridis":
      default: {
        // Viridis approximation
        const v4 = t ** 4;
        const v3 = t ** 3;
        const v2 = t ** 2;
        r = Math.min(1, Math.max(0, -0.0135 + 2.111 * v2 + 1.239 * v3 - 2.43 * v4));
        g = Math.min(1, Math.max(0, 0.0015 + 0.683 * v2 + 1.136 * v3 - 1.832 * v4));
        b = Math.min(1, Math.max(0, 0.117 + 2.039 * v2 - 2.119 * v3 + 1.437 * v4));
        break;
      }
    }
    lut.push([Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]);
  }
  return lut;
}

// ─── Color helper ─────────────────────────────────────────────────────────────

function sampleColormap(dbValue: number, dbMin: number, dbMax: number, lut: [number, number, number][]): string {
  const t = Math.max(0, Math.min(1, (dbValue - dbMin) / (dbMax - dbMin)));
  const idx = Math.round(t * 255);
  const [r, g, b] = lut[Math.max(0, Math.min(255, idx))];
  return `rgb(${r},${g},${b})`;
}

// ─── Canvas heatmap drawing ───────────────────────────────────────────────────

function drawSpectrogram(
  canvas: HTMLCanvasElement,
  data: SpectrogramData,
  cmap: Colormap,
  fMin: number,
  fMax: number,
  timeMin: number,
  timeMax: number,
  _colorScale: ColorScale,
  dbMin: number,
  dbMax: number
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const lut = buildColormap(cmap);
  const { time_ms, freq_hz, stft_db } = data;
  const W = canvas.width;
  const H = canvas.height;

  // Margins (axes drawn by HTML/CSS)
  const marginTop = 8;
  const marginBottom = 8;
  const marginLeft = 8;
  const marginRight = 8;

  const plotW = W - marginLeft - marginRight;
  const plotH = H - marginTop - marginBottom;

  // Helper: map pixel Y → frequency (log)
  const freqToY = (f: number): number => {
    const logMin = Math.log10(Math.max(fMin, 20));
    const logMax = Math.log10(Math.min(fMax, 20000));
    const logF = Math.log10(Math.max(fMin, Math.min(fMax, f)));
    return marginTop + plotH - ((logF - logMin) / (logMax - logMin)) * plotH;
  };

  // Helper: map pixel X → time
  const timeToX = (t: number): number => {
    const t0 = timeMin;
    const t1 = timeMax;
    return marginLeft + ((t - t0) / (t1 - t0)) * plotW;
  };

  // ImageData approach for fast pixel drawing
  const imgData = ctx.createImageData(W, H);
  const pixels = imgData.data;

  // Draw each STFT bin as a filled rectangle
  for (let ti = 0; ti < time_ms.length - 1; ti++) {
    const x0 = timeToX(time_ms[ti]);
    const x1 = timeToX(time_ms[ti + 1]);
    const px0 = Math.max(marginLeft, Math.floor(x0));
    const px1 = Math.min(W - marginRight, Math.ceil(x1));
    const row = stft_db[ti];
    for (let fi = 0; fi < freq_hz.length - 1; fi++) {
      const f0 = freq_hz[fi];
      const f1 = freq_hz[fi + 1];
      if (f0 < fMin || f1 > fMax) continue;

      const y0 = freqToY(f1); // Y flipped
      const y1 = freqToY(f0);
      const py0 = Math.max(marginTop, Math.floor(y0));
      const py1 = Math.min(H - marginBottom, Math.ceil(y1));

      const db = row[fi];
      const color = sampleColormap(db, dbMin, dbMax, lut);

      // Parse rgb from color string
      const m = color.match(/rgb\((\d+),(\d+),(\d+)\)/);
      if (!m) continue;
      const r = parseInt(m[1]), g = parseInt(m[2]), b = parseInt(m[3]);

      // Fill the pixels in this rectangle
      for (let py = py0; py < py1; py++) {
        for (let px = px0; px < px1; px++) {
          const idx = (py * W + px) * 4;
          pixels[idx] = r;
          pixels[idx + 1] = g;
          pixels[idx + 2] = b;
          pixels[idx + 3] = 255;
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);

  // Draw axis lines
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;
  ctx.strokeRect(marginLeft, marginTop, plotW, plotH);
}

// ─── Axis rendering ───────────────────────────────────────────────────────────

function drawAxes(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  fMin: number,
  fMax: number,
  timeMin: number,
  timeMax: number
) {
  const marginTop = 8, marginBottom = 28, marginLeft = 48, marginRight = 8;
  const plotW = W - marginLeft - marginRight;
  const plotH = H - marginTop - marginBottom;

  ctx.clearRect(0, 0, W, H);

  // Frequency axis (Y) — log
  const logFMin = Math.log10(fMin);
  const logFMax = Math.log10(fMax);
  const freqToY = (f: number) =>
    marginTop + plotH - ((Math.log10(f) - logFMin) / (logFMax - logFMin)) * plotH;

  // Time axis (X) — linear
  const timeToX = (t: number) =>
    marginLeft + ((t - timeMin) / (timeMax - timeMin)) * plotW;

  // Y-axis ticks and labels
  ctx.fillStyle = "#aaa";
  ctx.font = "10px monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  const freqTicks = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].filter(
    (f) => f >= fMin && f <= fMax
  );

  for (const f of freqTicks) {
    const y = freqToY(f);
    if (y < marginTop || y > H - marginBottom) continue;

    // Tick mark
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(marginLeft - 3, y);
    ctx.lineTo(marginLeft, y);
    ctx.stroke();

    // Label
    const label = f >= 1000 ? `${(f / 1000).toFixed(f % 1000 === 0 ? 0 : 1)}k` : `${f}`;
    ctx.fillStyle = "#aaa";
    ctx.fillText(label, marginLeft - 5, y);
  }

  // Y-axis title
  ctx.save();
  ctx.translate(12, H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#888";
  ctx.font = "10px monospace";
  ctx.fillText("Frequency (Hz)", 0, 0);
  ctx.restore();

  // X-axis ticks and labels
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const nTicks = Math.min(8, Math.floor((timeMax - timeMin) / 5) + 1);
  for (let i = 0; i <= nTicks; i++) {
    const t = timeMin + (i / nTicks) * (timeMax - timeMin);
    const x = timeToX(t);
    if (x < marginLeft || x > W - marginRight) continue;

    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, H - marginBottom);
    ctx.lineTo(x, H - marginBottom + 3);
    ctx.stroke();

    ctx.fillStyle = "#aaa";
    ctx.fillText(`${t.toFixed(1)}`, x, H - marginBottom + 4);
  }

  // X-axis title
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "#888";
  ctx.font = "10px monospace";
  ctx.fillText("Time (ms)", W / 2, H - 2);
}

// ─── Colorbar ─────────────────────────────────────────────────────────────────

function drawColorbar(
  canvas: HTMLCanvasElement,
  dbMin: number,
  dbMax: number,
  cmap: Colormap
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const W = canvas.width;
  const H = canvas.height;
  const lut = buildColormap(cmap);

  // Draw vertical gradient
  for (let y = 0; y < H; y++) {
    const t = 1 - y / H; // flip: top = max dB
    const db = dbMin + t * (dbMax - dbMin);
    const color = sampleColormap(db, dbMin, dbMax, lut);
    ctx.fillStyle = color;
    ctx.fillRect(0, y, W, 1);
  }

  // Border
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
}

// ─── Tooltip data extraction ─────────────────────────────────────────────────

function getDataAtPoint(
  data: SpectrogramData,
  px: number,
  py: number,
  canvasW: number,
  canvasH: number,
  fMin: number,
  fMax: number,
  timeMin: number,
  timeMax: number
): { time_ms: number; freq_hz: number; db: number } | null {
  const marginTop = 8, marginBottom = 28, marginLeft = 48, marginRight = 8;
  const plotW = canvasW - marginLeft - marginRight;
  const plotH = canvasH - marginTop - marginBottom;

  if (px < marginLeft || px >= canvasW - marginRight) return null;
  if (py < marginTop || py >= canvasH - marginBottom) return null;

  const t = timeMin + ((px - marginLeft) / plotW) * (timeMax - timeMin);
  const logFMin = Math.log10(fMin);
  const logFMax = Math.log10(fMax);
  const logF = logFMin + ((plotH - (py - marginTop)) / plotH) * (logFMax - logFMin);
  const f = Math.pow(10, logF);

  // Clamp to data range
  if (t < data.time_ms[0] || t > data.time_ms[data.time_ms.length - 1]) return null;
  if (f < data.freq_hz[0] || f > data.freq_hz[data.freq_hz.length - 1]) return null;

  // Find nearest indices
  let ti = 0;
  for (let i = 0; i < data.time_ms.length - 1; i++) {
    if (t >= data.time_ms[i] && t <= data.time_ms[i + 1]) {
      ti = Math.abs(t - data.time_ms[i]) < Math.abs(t - data.time_ms[i + 1]) ? i : i + 1;
      break;
    }
  }
  ti = Math.min(ti, data.stft_db.length - 1);

  let fi = 0;
  for (let i = 0; i < data.freq_hz.length - 1; i++) {
    if (f >= data.freq_hz[i] && f <= data.freq_hz[i + 1]) {
      fi = Math.abs(f - data.freq_hz[i]) < Math.abs(f - data.freq_hz[i + 1]) ? i : i + 1;
      break;
    }
  }
  fi = Math.min(fi, data.stft_db[0].length - 1);

  return {
    time_ms: data.time_ms[ti],
    freq_hz: data.freq_hz[fi],
    db: data.stft_db[ti][fi],
  };
}

// ─── Metric tooltip (click) ───────────────────────────────────────────────────

interface ClickTooltipProps {
  x: number;
  y: number;
  time_ms: number;
  freq_hz: number;
  db: number;
  onClose: () => void;
}

function ClickTooltip({ x, y, time_ms, freq_hz, db, onClose }: ClickTooltipProps) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const panelW = 240;
  const panelH = 160;
  const left = Math.min(x + 12, vw - panelW - 8);
  const top = Math.min(y + 12, vh - panelH - 8);

  const freqLabel = freq_hz >= 1000
    ? `${(freq_hz / 1000).toFixed(freq_hz % 1000 === 0 ? 0 : 2)} kHz`
    : `${freq_hz.toFixed(1)} Hz`;

  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 999, background: "transparent" }}
        onClick={onClose}
      />
      <div
        style={{
          position: "fixed",
          left,
          top,
          zIndex: 1000,
          background: "rgba(18,18,18,0.97)",
          border: "1px solid #444",
          borderRadius: 6,
          padding: "10px 12px",
          minWidth: panelW,
          backdropFilter: "blur(8px)",
          boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#00d4ff" }}>📊 Sample Point</span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#888",
              cursor: "pointer",
              fontSize: 12,
              padding: "0 2px",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
        {[
          ["Time", `${time_ms.toFixed(3)} ms`],
          ["Frequency", freqLabel],
          ["Level", `${db.toFixed(1)} dB`],
        ].map(([label, value]) => (
          <div
            key={label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 11,
              padding: "3px 0",
              borderBottom: "1px solid #2a2a2a",
            }}
          >
            <span style={{ color: "#888" }}>{label}</span>
            <span style={{ color: "#eee", fontFamily: "monospace" }}>{value}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function SpectrogramPanel({ result, onSpectrogramResult }: SpectrogramPanelProps) {
  const [spectrogramData, setSpectrogramData] = useState<SpectrogramData | null>(null);
  const [windowMs, setWindowMs] = useState(5.0);
  const [overlap, setOverlap] = useState(0.5);
  const [cmap, setCmap] = useState<Colormap>("magma");
  const [colorScale, setColorScale] = useState<ColorScale>("linear");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fPreset, setFPreset] = useState<FreqPreset>(FREQ_PRESETS[0]);
  const [fMin, setFMin] = useState(20);
  const [fMax, setFMax] = useState(20000);
  const [timeMin, setTimeMin] = useState(0);
  const [timeMax, setTimeMax] = useState(100);

  // Zoom state (multipliers) — values read via timeMin/timeMax/fMin/fMax

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorbarRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [hover, setHover] = useState<{ x: number; y: number; time_ms: number; freq_hz: number; db: number } | null>(null);
  const [clickTooltip, setClickTooltip] = useState<{ x: number; y: number; time_ms: number; freq_hz: number; db: number } | null>(null);

  // Auto-compute dB range
  const { dbMin, dbMax } = useMemo(() => {
    if (!spectrogramData) return { dbMin: -80, dbMax: 0 };
    const allDbs = spectrogramData.stft_db.flat();
    const min = Math.min(...allDbs);
    const max = Math.max(...allDbs);
    return { dbMin: Math.floor(min), dbMax: Math.ceil(max) };
  }, [spectrogramData]);

  // Draw spectrogram when data or view params change
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !spectrogramData) return;

    const W = canvas.width;
    const H = canvas.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    drawSpectrogram(canvas, spectrogramData, cmap, fMin, fMax, timeMin, timeMax, colorScale, dbMin, dbMax); // eslint-disable-line @typescript-eslint/no-unused-vars

    // Redraw axis overlay
    drawAxes(ctx, W, H, fMin, fMax, timeMin, timeMax);

    // Draw colorbar
    const cbCanvas = colorbarRef.current;
    if (cbCanvas) {
      drawColorbar(cbCanvas, dbMin, dbMax, cmap);
    }
  }, [spectrogramData, cmap, fMin, fMax, timeMin, timeMax, colorScale, dbMin, dbMax]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  // Resize canvas to container
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      canvas.width = Math.floor(rect.width);
      canvas.height = Math.floor(rect.height);
      redraw();
    });

    observer.observe(container);
    const rect = container.getBoundingClientRect();
    canvas.width = Math.floor(rect.width);
    canvas.height = Math.floor(rect.height);
    redraw();

    return () => observer.disconnect();
  }, [redraw]);

  // Compute spectrogram from result
  const compute = useCallback(async () => {
    if (!result) return;
    setLoading(true);
    setError(null);
    setSpectrogramData(null);
    onSpectrogramResult?.(null as unknown as SpectrogramData);

    try {
      const body = {
        frequencies: result.freqs,
        spl: result.spl,
        phase_degrees: result.phase_degrees ?? result.freqs.map(() => 0),
        window_ms: windowMs,
        overlap,
      };

      const res = await fetch(`${API_BASE}/spectrogram/compute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }

      const data: SpectrogramData = await res.json();
      setSpectrogramData(data);

      // Auto-set time range
      if (data.time_ms.length > 1) {
        const t0 = data.time_ms[0];
        const t1 = data.time_ms[data.time_ms.length - 1];
        setTimeMin(t0);
        setTimeMax(t1);
      }

      onSpectrogramResult?.(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Spectrogram computation failed");
    } finally {
      setLoading(false);
    }
  }, [result, windowMs, overlap, onSpectrogramResult]);

  // Frequency preset handler
  const handlePreset = useCallback((preset: FreqPreset) => {
    setFPreset(preset);
    setFMin(preset.fMin);
    setFMax(preset.fMax);
  }, []);

  // Mouse handlers
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!spectrogramData) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const px = (e.clientX - rect.left) * scaleX;
      const py = (e.clientY - rect.top) * scaleY;

      const hit = getDataAtPoint(
        spectrogramData, px, py,
        canvas.width, canvas.height,
        fMin, fMax, timeMin, timeMax
      );
      if (hit) {
        setHover({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          ...hit,
        });
      } else {
        setHover(null);
      }
    },
    [spectrogramData, fMin, fMax, timeMin, timeMax]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!spectrogramData) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const px = (e.clientX - rect.left) * scaleX;
      const py = (e.clientY - rect.top) * scaleY;

      const hit = getDataAtPoint(
        spectrogramData, px, py,
        canvas.width, canvas.height,
        fMin, fMax, timeMin, timeMax
      );
      if (hit) {
        setClickTooltip({ x: e.clientX, y: e.clientY, ...hit });
      }
    },
    [spectrogramData, fMin, fMax, timeMin, timeMax]
  );

  const handleMouseLeave = useCallback(() => {
    setHover(null);
  }, []);

  // Zoom handlers
  const zoomInX = useCallback(() => {
    const span = timeMax - timeMin;
    const center = (timeMin + timeMax) / 2;
    const newSpan = span / 1.5;
    setTimeMin(center - newSpan / 2);
    setTimeMax(center + newSpan / 2);
  }, [timeMin, timeMax]);

  const zoomOutX = useCallback(() => {
    const span = timeMax - timeMin;
    const center = (timeMin + timeMax) / 2;
    const newSpan = span * 1.5;
    setTimeMin(Math.max(0, center - newSpan / 2));
    setTimeMax(center + newSpan / 2);
  }, [timeMin, timeMax]);

  const zoomInY = useCallback(() => {
    const logMin = Math.log10(fMin);
    const logMax = Math.log10(fMax);
    const logCenter = (logMin + logMax) / 2;
    const logSpan = (logMax - logMin) / 1.5;
    setFMin(Math.pow(10, logCenter - logSpan / 2));
    setFMax(Math.pow(10, logCenter + logSpan / 2));
  }, [fMin, fMax]);

  const zoomOutY = useCallback(() => {
    const logMin = Math.log10(fMin);
    const logMax = Math.log10(fMax);
    const logCenter = (logMin + logMax) / 2;
    const logSpan = (logMax - logMin) * 1.5;
    setFMin(Math.max(20, Math.pow(10, logCenter - logSpan / 2)));
    setFMax(Math.min(20000, Math.pow(10, logCenter + logSpan / 2)));
  }, [fMin, fMax]);

  const resetZoom = useCallback(() => {
    setFMin(fPreset.fMin);
    setFMax(fPreset.fMax);
    if (spectrogramData) {
      setTimeMin(spectrogramData.time_ms[0]);
      setTimeMax(spectrogramData.time_ms[spectrogramData.time_ms.length - 1]);
    }
  }, [fPreset, spectrogramData]);

  const COLORMAPS: Colormap[] = ["magma", "viridis", "plasma", "inferno"];

  return (
    <div className="spectrogram-panel">
      {/* Header */}
      <div className="sp-header">
        <ChartTitle title="🔥 Spectrogram" />
        {spectrogramData && (
          <button className="sp-reset-btn" onClick={resetZoom} title="Reset zoom">
            ↺ Reset
          </button>
        )}
      </div>

      {/* Parameter controls */}
      <div className="sp-controls">
        <div className="sp-control-row">
          <label className="sp-label">
            Window (ms)
            <input
              type="range"
              min={1}
              max={20}
              step={0.5}
              value={windowMs}
              onChange={(e) => setWindowMs(Number(e.target.value))}
              className="sp-slider"
            />
            <span className="sp-value">{windowMs.toFixed(1)}</span>
          </label>

          <label className="sp-label">
            Overlap
            <input
              type="range"
              min={0.25}
              max={0.9}
              step={0.05}
              value={overlap}
              onChange={(e) => setOverlap(Number(e.target.value))}
              className="sp-slider"
            />
            <span className="sp-value">{Math.round(overlap * 100)}%</span>
          </label>
        </div>

        <div className="sp-control-row">
          <label className="sp-label">
            Colormap
            <select
              value={cmap}
              onChange={(e) => setCmap(e.target.value as Colormap)}
              className="sp-select"
            >
              {COLORMAPS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>

          <label className="sp-label">
            Freq Scale
            <select
              value={colorScale}
              onChange={(e) => setColorScale(e.target.value as ColorScale)}
              className="sp-select"
            >
              <option value="log">Log</option>
              <option value="linear">Linear</option>
            </select>
          </label>
        </div>

        {/* Frequency presets */}
        <div className="sp-presets">
          {FREQ_PRESETS.map((p) => (
            <button
              key={p.label}
              className={`sp-preset-btn${fPreset.label === p.label ? " active" : ""}`}
              onClick={() => handlePreset(p)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Custom frequency range inputs */}
        <div className="sp-custom-range">
          <label className="sp-custom-label">
            <span>Custom fMin</span>
            <input
              type="number"
              className="sp-custom-input"
              value={fMin}
              min={20}
              max={fMax - 1}
              step={1}
              onChange={(e) => {
                const v = Math.max(20, Math.min(fMax - 1, Number(e.target.value)));
                setFMin(v);
                setFPreset({ label: "Custom", fMin: v, fMax });
              }}
            />
            <span className="sp-custom-unit">Hz</span>
          </label>
          <span className="sp-range-sep">–</span>
          <label className="sp-custom-label">
            <span>Custom fMax</span>
            <input
              type="number"
              className="sp-custom-input"
              value={fMax}
              min={fMin + 1}
              max={20000}
              step={1}
              onChange={(e) => {
                const v = Math.max(fMin + 1, Math.min(20000, Number(e.target.value)));
                setFMax(v);
                setFPreset({ label: "Custom", fMin, fMax: v });
              }}
            />
            <span className="sp-custom-unit">Hz</span>
          </label>
        </div>
      </div>

      {/* Compute button */}
      <button
        onClick={compute}
        disabled={!result || loading}
        className="sp-compute-btn"
      >
        {loading ? "⏳ Computing…" : spectrogramData ? "🔄 Recompute" : "🔬 Generate Spectrogram"}
      </button>

      {error && (
        <div className="sp-error">{error}</div>
      )}

      {!result && (
        <div className="sp-placeholder">Run a simulation first to enable spectrogram.</div>
      )}

      {/* Spectrogram display */}
      {spectrogramData && (
        <div className="sp-display">
          {/* Zoom controls */}
          <div className="sp-zoom-controls">
            <div className="sp-zoom-group">
              <span className="sp-zoom-label">Time</span>
              <button onClick={zoomInX} className="sp-zoom-btn" title="Zoom in time">🔍+</button>
              <button onClick={zoomOutX} className="sp-zoom-btn" title="Zoom out time">🔍−</button>
            </div>
            <div className="sp-zoom-group">
              <span className="sp-zoom-label">Freq</span>
              <button onClick={zoomInY} className="sp-zoom-btn" title="Zoom in freq">🔍+</button>
              <button onClick={zoomOutY} className="sp-zoom-btn" title="Zoom out freq">🔍−</button>
            </div>
          </div>

          {/* Canvas area with colorbar */}
          <div className="sp-canvas-wrapper">
            <div className="sp-canvas-container" ref={containerRef}>
              <canvas
                ref={canvasRef}
                className="sp-canvas"
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onClick={handleClick}
                style={{ cursor: spectrogramData ? "crosshair" : "default" }}
              />

              {/* Hover tooltip */}
              {hover && (
                <div
                  className="sp-tooltip"
                  style={{
                    left: hover.x + 12,
                    top: hover.y - 8,
                  }}
                >
                  <span>{hover.time_ms.toFixed(2)} ms</span>
                  <span>
                    {hover.freq_hz >= 1000
                      ? `${(hover.freq_hz / 1000).toFixed(1)}k Hz`
                      : `${hover.freq_hz.toFixed(1)} Hz`}
                  </span>
                  <span className="sp-tooltip-db">{hover.db.toFixed(1)} dB</span>
                </div>
              )}

              {/* Click tooltip */}
              {clickTooltip && (
                <ClickTooltip
                  x={clickTooltip.x}
                  y={clickTooltip.y}
                  time_ms={clickTooltip.time_ms}
                  freq_hz={clickTooltip.freq_hz}
                  db={clickTooltip.db}
                  onClose={() => setClickTooltip(null)}
                />
              )}
            </div>

            {/* Colorbar */}
            <div className="sp-colorbar-wrapper">
              <div className="sp-colorbar-labels">
                <span>{dbMax} dB</span>
                <span>{(dbMin + dbMax) / 2 > -9999 ? `${((dbMin + dbMax) / 2).toFixed(0)}` : ""}</span>
                <span>{dbMin} dB</span>
              </div>
              <canvas
                ref={colorbarRef}
                className="sp-colorbar"
                width={20}
                height={200}
              />
            </div>
          </div>

          {/* dB range info */}
          <div className="sp-db-range">
            Range: {dbMin} – {dbMax} dB · {spectrogramData.time_ms.length} × {spectrogramData.freq_hz.length} bins
          </div>
        </div>
      )}

      <style>{`
        .spectrogram-panel {
          padding: 0;
        }
        .sp-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        .sp-title {
          font-size: 11px;
          font-weight: 600;
          color: var(--text);
        }
        .sp-reset-btn {
          background: none;
          border: 1px solid var(--border);
          border-radius: 3px;
          color: var(--text2);
          font-size: 10px;
          padding: 2px 6px;
          cursor: pointer;
        }
        .sp-reset-btn:hover {
          color: var(--text);
          border-color: var(--text2);
        }
        .sp-controls {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 8px;
        }
        .sp-control-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }
        .sp-label {
          display: flex;
          flex-direction: column;
          gap: 2px;
          font-size: 10px;
          color: var(--text2);
        }
        .sp-slider {
          width: 100%;
          height: 4px;
          accent-color: var(--accent);
          cursor: pointer;
        }
        .sp-value {
          font-family: monospace;
          color: var(--text);
          font-size: 10px;
          text-align: right;
        }
        .sp-select {
          padding: 3px 6px;
          background: #2a2a2a;
          border: 1px solid #444;
          border-radius: 4px;
          color: #eee;
          font-size: 10px;
          cursor: pointer;
        }
        .sp-presets {
          display: flex;
          gap: 4px;
        }
        .sp-custom-range {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 2px;
        }
        .sp-custom-label {
          display: flex;
          align-items: center;
          gap: 3px;
          font-size: 10px;
          color: var(--text2);
        }
        .sp-custom-label > span:first-child {
          display: none;
        }
        .sp-custom-input {
          width: 60px;
          padding: 2px 5px;
          background: #2a2a2a;
          border: 1px solid #444;
          border-radius: 3px;
          color: #eee;
          font-size: 10px;
          font-family: monospace;
          text-align: right;
        }
        .sp-custom-input:focus {
          outline: none;
          border-color: var(--accent);
          background: #333;
        }
        .sp-custom-unit {
          font-size: 10px;
          color: var(--text2);
        }
        .sp-range-sep {
          color: var(--text2);
          font-size: 11px;
        }
        .sp-preset-btn {
          flex: 1;
          padding: 3px 6px;
          background: #2a2a2a;
          border: 1px solid #444;
          border-radius: 4px;
          color: var(--text2);
          font-size: 10px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .sp-preset-btn:hover {
          border-color: var(--accent);
          color: var(--accent);
        }
        .sp-preset-btn.active {
          background: rgba(0, 212, 255, 0.12);
          border-color: var(--accent);
          color: var(--accent);
        }
        .sp-compute-btn {
          width: 100%;
          padding: 6px 8px;
          background: var(--accent);
          color: #fff;
          border: none;
          border-radius: 4px;
          font-size: 11px;
          cursor: pointer;
          margin-bottom: 6px;
          transition: opacity 0.15s;
        }
        .sp-compute-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .sp-compute-btn:not(:disabled):hover {
          opacity: 0.9;
        }
        .sp-error {
          font-size: 10px;
          color: #ef4444;
          margin-bottom: 6px;
          padding: 4px 6px;
          background: rgba(239,68,68,0.1);
          border-radius: 4px;
        }
        .sp-placeholder {
          font-size: 10px;
          color: var(--text2);
          font-style: italic;
          margin-bottom: 6px;
        }
        .sp-display {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .sp-zoom-controls {
          display: flex;
          gap: 12px;
        }
        .sp-zoom-group {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .sp-zoom-label {
          font-size: 10px;
          color: var(--text2);
        }
        .sp-zoom-btn {
          background: #2a2a2a;
          border: 1px solid #444;
          border-radius: 3px;
          color: var(--text);
          font-size: 10px;
          padding: 1px 5px;
          cursor: pointer;
        }
        .sp-zoom-btn:hover {
          border-color: var(--accent);
          color: var(--accent);
        }
        .sp-canvas-wrapper {
          display: flex;
          gap: 6px;
          align-items: flex-start;
        }
        .sp-canvas-container {
          flex: 1;
          position: relative;
          min-height: 200px;
          background: #111;
          border-radius: 4px;
          overflow: hidden;
        }
        .sp-canvas {
          display: block;
          width: 100%;
          height: 100%;
          position: absolute;
          inset: 0;
        }
        .sp-tooltip {
          position: absolute;
          background: rgba(0, 0, 0, 0.85);
          border: 1px solid #444;
          border-radius: 4px;
          padding: 4px 8px;
          font-size: 10px;
          color: #eee;
          pointer-events: none;
          display: flex;
          flex-direction: column;
          gap: 1px;
          z-index: 10;
          white-space: nowrap;
          backdrop-filter: blur(4px);
        }
        .sp-tooltip-db {
          color: var(--accent);
          font-weight: 600;
        }
        .sp-colorbar-wrapper {
          display: flex;
          gap: 4px;
          align-items: stretch;
        }
        .sp-colorbar-labels {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          font-size: 9px;
          color: #888;
          font-family: monospace;
          text-align: right;
          padding: 2px 0;
        }
        .sp-colorbar {
          border-radius: 2px;
          border: 1px solid #333;
        }
        .sp-db-range {
          font-size: 9px;
          color: var(--text2);
          text-align: center;
        }
      `}</style>
    </div>
  );
}
