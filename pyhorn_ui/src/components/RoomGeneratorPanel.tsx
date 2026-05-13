/**
 * RoomGeneratorPanel — Hornresp page 96 "Room Generator"
 *
 * Imports measured room gain data for acoustical power calculations.
 * Users can load a CSV/text file with (frequency_hz, room_gain_db) columns,
 * and the imported curve is displayed alongside the theoretical room gain.
 *
 * The imported room gain can be used by the Horn Synthesis Wizard's
 * acoustical power diagram to show room-boundary effects on power response.
 */
import { useState, useCallback, useRef } from "react";

export interface ImportedRoomGain {
  frequencies: number[];
  room_gain_db: number[];
  filename: string;
}

export interface RoomGeneratorPanelProps {
  /** Called when user wants to use the imported room gain in the acoustical power calculation */
  onImport?: (gain: ImportedRoomGain) => void;
  /** Current imported room gain (e.g., from a previous session) */
  importedGain?: ImportedRoomGain | null;
}

// ─── Parse CSV / text file ─────────────────────────────────────────────────────

interface ParseResult {
  frequencies: number[];
  room_gain_db: number[];
  errors: string[];
}

/** Parse a CSV or tab-separated file with (frequency, room_gain_db) columns.
 *  Handles common formats: frequency in Hz, room_gain in dB (can be negative).
 *  Skips header rows automatically.
 */
function parseRoomGainFile(text: string, _filename: string): ParseResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const frequencies: number[] = [];
  const room_gain_db: number[] = [];
  const errors: string[] = [];

  // Try to detect delimiter
  const firstLine = lines[0];
  let delimiter = ",";
  if (firstLine.includes("\t")) delimiter = "\t";
  else if (firstLine.includes(";")) delimiter = ";";

  let started = false;
  let lineNum = 0;

  for (const line of lines) {
    lineNum++;
    // Skip clear header lines
    if (!started && (line.toLowerCase().includes("frequency") ||
        line.toLowerCase().includes("room") || line.toLowerCase().includes("gain") ||
        line.toLowerCase().includes("freq") || line.startsWith("#") || line.startsWith("%"))) {
      // Check if it might be a header with numeric data
      const parts = line.split(delimiter).map((p) => p.trim().toLowerCase());
      const numericParts = parts.filter((p) => !isNaN(parseFloat(p)) && p !== "");
      if (numericParts.length < parts.length * 0.5) continue; // mostly non-numeric = header
    }

    const parts = line.split(delimiter).map((p) => p.trim().replace(/['"]/g, ""));
    if (parts.length < 2) {
      if (lineNum > 1) errors.push(`Line ${lineNum}: expected 2 columns, got ${parts.length}`);
      continue;
    }

    const f = parseFloat(parts[0]);
    const g = parseFloat(parts[1]);

    if (isNaN(f) || isNaN(g)) {
      errors.push(`Line ${lineNum}: non-numeric value (freq=${parts[0]}, gain=${parts[1]})`);
      continue;
    }
    if (f <= 0) {
      errors.push(`Line ${lineNum}: frequency must be > 0 (got ${f})`);
      continue;
    }

    frequencies.push(f);
    room_gain_db.push(g);
    started = true;
  }

  // Sort by frequency
  const order = frequencies.map((f, i) => ({ f, i })).sort((a, b) => a.f - b.f);
  const sortedFreqs = order.map((x) => frequencies[x.i]);
  const sortedGains = order.map((x) => room_gain_db[x.i]);

  return { frequencies: sortedFreqs, room_gain_db: sortedGains, errors: errors.slice(0, 5) };
}

// ─── Interpolation helper ──────────────────────────────────────────────────────

/** Get room gain (dB) at a specific frequency by linear interpolation */
export function interpolateRoomGain(freqs: number[], gains: number[], freq: number): number {
  if (freqs.length === 0) return 0;
  if (freq <= freqs[0]) return gains[0];
  if (freq >= freqs[freqs.length - 1]) return gains[gains.length - 1];
  for (let i = 0; i < freqs.length - 1; i++) {
    if (freq >= freqs[i] && freq <= freqs[i + 1]) {
      const t = (freq - freqs[i]) / (freqs[i + 1] - freqs[i]);
      return gains[i] + t * (gains[i + 1] - gains[i]);
    }
  }
  return 0;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RoomGeneratorPanel({ onImport, importedGain }: RoomGeneratorPanelProps) {
  const [data, setData] = useState<ImportedRoomGain | null>(importedGain ?? null);
  const [errors, setErrors] = useState<string[]>([]);
  const [filename, setFilename] = useState<string>(importedGain?.filename ?? "");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const result = parseRoomGainFile(text, file.name);
      setErrors(result.errors);
      if (result.frequencies.length > 0) {
        const imported: ImportedRoomGain = {
          frequencies: result.frequencies,
          room_gain_db: result.room_gain_db,
          filename: file.name,
        };
        setData(imported);
        onImport?.(imported);
      }
    };
    reader.readAsText(file);
  }, [onImport]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleClear = useCallback(() => {
    setData(null);
    setFilename("");
    setErrors([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // Chart rendering (lightweight inline SVG, no recharts dependency for this small panel)
  const chartWidth = 460;
  const chartHeight = 160;
  const padL = 48, padR = 16, padT = 12, padB = 32;
  const plotW = chartWidth - padL - padR;
  const plotH = chartHeight - padT - padB;

  function renderChart() {
    if (!data || data.frequencies.length === 0) return null;

    const freqs = data.frequencies;
    const gains = data.room_gain_db;

    // Log-frequency scale
    const logMin = Math.log10(Math.max(20, freqs[0]));
    const logMax = Math.log10(Math.min(20000, freqs[freqs.length - 1]));
    const xPx = (f: number) => padL + ((Math.log10(f) - logMin) / (logMax - logMin)) * plotW;

    const gainMin = Math.min(...gains, 0) - 2;
    const gainMax = Math.max(...gains, 0) + 2;
    const yPx = (g: number) => padT + plotH - ((g - gainMin) / (gainMax - gainMin)) * plotH;

    const points = freqs.map((f, i) => `${xPx(f).toFixed(1)},${yPx(gains[i]).toFixed(1)}`).join(" ");

    // X-axis ticks
    const xTicks = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
      .filter((f) => f >= freqs[0] * 0.8 && f <= freqs[freqs.length - 1] * 1.2);
    const yTicks = [Math.round(gainMin), 0, Math.round(gainMax)];

    return (
      <svg width={chartWidth} height={chartHeight} style={{ display: "block", fontSize: "10px" }}>
        {/* Grid */}
        {yTicks.map((t) => {
          const y = yPx(t).toFixed(1);
          return (
            <g key={t}>
              <line x1={padL} y1={y} x2={padL + plotW} y2={y} stroke="var(--border)" strokeWidth={0.5} strokeDasharray={t !== 0 ? "3 3" : "none"} />
              <text x={padL - 4} y={(parseFloat(y) + 3).toFixed(1)} textAnchor="end" fill="var(--text2)">{t.toFixed(0)}</text>
            </g>
          );
        })}
        {xTicks.map((f) => (
          <g key={f}>
            <line x1={xPx(f).toFixed(1)} y1={padT} x2={xPx(f).toFixed(1)} y2={padT + plotH} stroke="var(--border)" strokeWidth={0.5} />
            <text x={xPx(f).toFixed(1)} y={(padT + plotH + 14).toFixed(1)} textAnchor="middle" fill="var(--text2)">
              {f >= 1000 ? `${(f / 1000).toFixed(0)}k` : f.toFixed(0)}
            </text>
          </g>
        ))}

        {/* Zero line */}
        <line x1={padL} y1={yPx(0).toFixed(1)} x2={padL + plotW} y2={yPx(0).toFixed(1)} stroke="var(--text2)" strokeWidth={0.8} />

        {/* Room gain curve */}
        <polyline points={points} fill="none" stroke="#a78bfa" strokeWidth={1.8} strokeLinejoin="round" />

        {/* Axis labels */}
        <text x={(padL + padL + plotW) / 2} y={chartHeight - 2} textAnchor="middle" fill="var(--text2)" fontSize="10">Frequency (Hz)</text>
        <text x={10} y={(padT + padT + plotH) / 2} textAnchor="middle" fill="var(--text2)" fontSize="10"
          transform={`rotate(-90, 10, ${(padT + padT + plotH) / 2})`}>Room Gain (dB)</text>
      </svg>
    );
  }

  return (
    <div className="panel" style={{ fontSize: "12px" }}>
      <div className="panel-header-row">
        <h2 style={{ marginBottom: 0 }}>🏠 Room Generator</h2>
      </div>

      <p style={{ fontSize: "11px", color: "var(--text2)", marginBottom: "8px" }}>
        Import measured room gain data for acoustical power calculations.
        Supports CSV/text files with (frequency_hz, room_gain_db) columns.
      </p>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${isDragging ? "var(--accent)" : "var(--border)"}`,
          borderRadius: "6px",
          padding: "16px",
          textAlign: "center",
          cursor: "pointer",
          background: isDragging ? "rgba(0,212,255,0.05)" : "transparent",
          transition: "border-color 0.15s, background 0.15s",
          marginBottom: "8px",
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.txt,.meas,.frd,.txt"
          onChange={handleFileInput}
          style={{ display: "none" }}
        />
        <div style={{ fontSize: "11px", color: "var(--text2)" }}>
          📂 Drag & drop a room gain file here, or click to browse
        </div>
        <div style={{ fontSize: "10px", color: "var(--text2)", marginTop: "4px" }}>
          Format: frequency (Hz), room_gain (dB) — CSV, TSV, or space-separated
        </div>
      </div>

      {errors.length > 0 && (
        <div style={{ marginBottom: "8px", padding: "6px 8px", background: "rgba(239,68,68,0.1)", borderRadius: "4px", border: "1px solid rgba(239,68,68,0.3)" }}>
          {errors.map((e, i) => (
            <div key={i} style={{ fontSize: "10px", color: "#f87171" }}>{e}</div>
          ))}
        </div>
      )}

      {data && data.frequencies.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
            <span style={{ fontSize: "11px", color: "var(--accent)" }}>✅ {filename}</span>
            <span style={{ fontSize: "10px", color: "var(--text2)" }}>
              {data.frequencies.length} points · {data.frequencies[0].toFixed(0)} –
              {data.frequencies[data.frequencies.length - 1].toFixed(0)} Hz
            </span>
            <button
              onClick={handleClear}
              className="btn-outline"
              style={{ marginLeft: "auto", fontSize: "10px", padding: "2px 8px", color: "#ef4444", borderColor: "#ef4444" }}
            >
              ✕ Clear
            </button>
          </div>

          <div style={{ marginBottom: "6px" }}>
            {renderChart()}
          </div>

          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            <button
              onClick={() => {
                const blob = new Blob([`frequency_hz,room_gain_db\n${
                  data!.frequencies.map((f, i) => `${f},${data!.room_gain_db[i]}`).join("\n")
                }`], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url; a.download = `room_gain_${data!.filename}`; a.click();
                URL.revokeObjectURL(url);
              }}
              className="btn-outline"
              style={{ fontSize: "10px", padding: "3px 10px" }}
            >
              📥 Re-export CSV
            </button>
            {onImport && (
              <button
                onClick={() => onImport(data)}
                className="btn-primary"
                style={{ fontSize: "10px", padding: "3px 10px" }}
              >
                🔗 Use in Power Calculation
              </button>
            )}
          </div>
        </>
      )}

      {!data && errors.length === 0 && (
        <p style={{ fontSize: "11px", color: "var(--text2)", fontStyle: "italic" }}>
          No file loaded. Import room gain data from REW, ARTA, or similar measurement tools.
        </p>
      )}
    </div>
  );
}
