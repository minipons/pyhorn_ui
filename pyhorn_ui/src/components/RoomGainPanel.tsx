import { useState, useCallback } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

// API base: same pattern as SpectrogramPanel
const API_BASE = "http://localhost:8765";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface RoomGainComputeResponse {
  frequencies: number[];
  room_gain_db: number[];
  room_type: string;
  cutoff_frequency_hz: number | null;
  peak_gain_db: number;
  model_note: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ROOM_TYPES = [
  { value: "free_space", label: "Free space (0 dB)", description: "Away from all walls" },
  { value: "half_space", label: "Half space (+3 dB)", description: "Near one wall" },
  { value: "quarter_space", label: "Quarter space (+6 dB)", description: "In a corner (2 walls)" },
  { value: "eighth_space", label: "Eighth space (+9 dB)", description: "In a recess (3 walls)" },
];

const PEAK_GAIN_DB: Record<string, number> = {
  free_space: 0,
  half_space: 3.01,
  quarter_space: 6.02,
  eighth_space: 9.03,
};

// Log-frequency tick values
const LOG_TICK_VALUES = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

function fmtFreqTick(v: number): string {
  if (v >= 1000) {
    const k = v / 1000;
    return `${k === Math.round(k) ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `${Math.round(v)}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RoomGainPanel() {
  const [fmin, setFmin] = useState(20);
  const [fmax, setFmax] = useState(20000);
  const [nPoints, setNPoints] = useState(500);
  const [roomType, setRoomType] = useState<string>("half_space");
  const [distanceToWall, setDistanceToWall] = useState<string>("");
  const [roomVolume, setRoomVolume] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RoomGainComputeResponse | null>(null);

  const compute = useCallback(async () => {
    setLoading(true);
    setError(null);

    // Build frequency array (log spaced)
    const freqs = Array.from({ length: nPoints }, (_, i) => {
      const logMin = Math.log10(fmin);
      const logMax = Math.log10(fmax);
      return Math.pow(10, logMin + (i / (nPoints - 1)) * (logMax - logMin));
    });

    const body: Record<string, unknown> = {
      frequencies: freqs,
      room_type: roomType,
    };

    const dist = parseFloat(distanceToWall);
    if (!isNaN(dist) && dist > 0) {
      body.distance_to_wall_m = dist;
    }

    const vol = parseFloat(roomVolume);
    if (!isNaN(vol) && vol > 0) {
      body.room_volume_m3 = vol;
    }

    try {
      const res = await fetch(`${API_BASE}/room-gain/compute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }

      const data: RoomGainComputeResponse = await res.json();
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Room gain computation failed");
    } finally {
      setLoading(false);
    }
  }, [fmin, fmax, nPoints, roomType, distanceToWall, roomVolume]);

  const chartData = result
    ? result.frequencies.map((f, i) => ({
        freq: f,
        room_gain_db: result.room_gain_db[i],
      }))
    : [];

  const cutoff = result?.cutoff_frequency_hz;
  const peakGain = result?.peak_gain_db ?? PEAK_GAIN_DB[roomType] ?? 0;

  return (
    <div style={{ padding: "8px 0" }}>
      {/* Frequency range */}
      <div style={{ marginBottom: "10px" }}>
        <label style={{ fontSize: "11px", color: "var(--text2)", display: "block", marginBottom: "4px" }}>
          Frequency Range
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
          <div>
            <span style={{ fontSize: "10px", color: "var(--text2)" }}>fmin (Hz)</span>
            <input
              type="number"
              value={fmin}
              min={1}
              max={fmax - 1}
              onChange={(e) => setFmin(Math.max(1, Number(e.target.value)))}
              style={{
                width: "100%",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                color: "var(--text)",
                padding: "3px 6px",
                fontSize: "12px",
                fontFamily: "monospace",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div>
            <span style={{ fontSize: "10px", color: "var(--text2)" }}>fmax (Hz)</span>
            <input
              type="number"
              value={fmax}
              min={fmin + 1}
              max={50000}
              onChange={(e) => setFmax(Math.min(50000, Number(e.target.value)))}
              style={{
                width: "100%",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                color: "var(--text)",
                padding: "3px 6px",
                fontSize: "12px",
                fontFamily: "monospace",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div>
            <span style={{ fontSize: "10px", color: "var(--text2)" }}>Points</span>
            <input
              type="number"
              value={nPoints}
              min={50}
              max={2000}
              step={50}
              onChange={(e) => setNPoints(Number(e.target.value))}
              style={{
                width: "100%",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                color: "var(--text)",
                padding: "3px 6px",
                fontSize: "12px",
                fontFamily: "monospace",
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>
      </div>

      {/* Room type */}
      <div style={{ marginBottom: "10px" }}>
        <label style={{ fontSize: "11px", color: "var(--text2)", display: "block", marginBottom: "4px" }}>
          Room Boundary Type
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {ROOM_TYPES.map((rt) => (
            <label
              key={rt.value}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "5px 8px",
                borderRadius: "6px",
                border: roomType === rt.value
                  ? "1px solid var(--accent)"
                  : "1px solid var(--border)",
                background: roomType === rt.value
                  ? "rgba(0,212,255,0.08)"
                  : "transparent",
                cursor: "pointer",
                fontSize: "11px",
              }}
            >
              <input
                type="radio"
                name="room_type"
                value={rt.value}
                checked={roomType === rt.value}
                onChange={() => setRoomType(rt.value)}
                style={{ accentColor: "var(--accent)" }}
              />
              <span style={{ color: roomType === rt.value ? "var(--accent)" : "var(--text)" }}>
                {rt.label}
              </span>
              <span style={{ color: "var(--text2)", fontSize: "10px" }}>
                — {rt.description}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Distance & volume */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "10px" }}>
        <div>
          <label style={{ fontSize: "11px", color: "var(--text2)", display: "block", marginBottom: "4px" }}>
            📏 Distance to Wall (m)
          </label>
          <input
            type="number"
            value={distanceToWall}
            placeholder="e.g. 0.5"
            min={0}
            max={20}
            step={0.05}
            onChange={(e) => setDistanceToWall(e.target.value)}
            style={{
              width: "100%",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              color: "var(--text)",
              padding: "4px 6px",
              fontSize: "12px",
              fontFamily: "monospace",
              boxSizing: "border-box",
            }}
          />
          <span style={{ fontSize: "10px", color: "var(--text2)", display: "block", marginTop: "2px" }}>
            f_cutoff ≈ 343 / (2π × d)
          </span>
        </div>
        <div>
          <label style={{ fontSize: "11px", color: "var(--text2)", display: "block", marginBottom: "4px" }}>
            📦 Room Volume (m³)
          </label>
          <input
            type="number"
            value={roomVolume}
            placeholder="e.g. 80"
            min={0}
            max={1000}
            step={1}
            onChange={(e) => setRoomVolume(e.target.value)}
            style={{
              width: "100%",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              color: "var(--text)",
              padding: "4px 6px",
              fontSize: "12px",
              fontFamily: "monospace",
              boxSizing: "border-box",
            }}
          />
          <span style={{ fontSize: "10px", color: "var(--text2)", display: "block", marginTop: "2px" }}>
            Sabine room-mode est.
          </span>
        </div>
      </div>

      {/* Compute button */}
      <button
        onClick={compute}
        disabled={loading}
        style={{
          width: "100%",
          padding: "6px 8px",
          background: loading ? "rgba(0,212,255,0.3)" : "var(--accent)",
          color: "#fff",
          border: "none",
          borderRadius: "4px",
          fontSize: "12px",
          cursor: loading ? "not-allowed" : "pointer",
          fontWeight: 600,
          marginBottom: "8px",
          transition: "opacity 0.15s",
        }}
      >
        {loading ? "⏳ Computing…" : result ? "🔄 Recompute" : "📐 Compute Room Gain"}
      </button>

      {error && (
        <div style={{
          fontSize: "11px",
          color: "#ef4444",
          marginBottom: "8px",
          padding: "6px 8px",
          background: "rgba(239,68,68,0.1)",
          borderRadius: "4px",
          border: "1px solid rgba(239,68,68,0.3)",
        }}>
          ⚠ {error}
        </div>
      )}

      {/* Result summary */}
      {result && (
        <div style={{
          marginBottom: "10px",
          padding: "8px 10px",
          background: "rgba(0,212,255,0.06)",
          border: "1px solid rgba(0,212,255,0.2)",
          borderRadius: "8px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
            <span style={{ fontSize: "11px", color: "var(--text2)" }}>Room type</span>
            <span style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--accent)" }}>
              {result.room_type.replace("_", " ")}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
            <span style={{ fontSize: "11px", color: "var(--text2)" }}>Peak gain</span>
            <span style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--accent)" }}>
              +{result.peak_gain_db.toFixed(2)} dB
            </span>
          </div>
          {cutoff && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "11px", color: "var(--text2)" }}>Cutoff freq</span>
              <span style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--accent)" }}>
                {cutoff.toFixed(0)} Hz
              </span>
            </div>
          )}
          <p style={{
            fontSize: "10px",
            color: "var(--text2)",
            margin: "6px 0 0",
            fontStyle: "italic",
            lineHeight: 1.4,
          }}>
            {result.model_note}
          </p>
        </div>
      )}

      {/* Chart */}
      {result && (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis
              dataKey="freq"
              type="number"
              scale="log"
              ticks={LOG_TICK_VALUES}
              domain={[fmin, fmax]}
              tickFormatter={fmtFreqTick}
              stroke="#aaa"
              fontSize={11}
            />
            <YAxis
              stroke="#aaa"
              fontSize={11}
              domain={[Math.min(0, Math.floor(peakGain - 3)), Math.ceil(peakGain + 1)]}
              tickFormatter={(v) => `${v >= 0 ? "+" : ""}${v}`}
              label={{
                value: "Room Gain (dB)",
                angle: -90,
                position: "insideLeft",
                fill: "#aaa",
                fontSize: 10,
              }}
            />
            <Tooltip
              formatter={(v: number) => [`${v >= 0 ? "+" : ""}${v.toFixed(2)} dB`, "Room Gain"]}
              labelFormatter={(v) => `${Number(v).toFixed(0)} Hz`}
              contentStyle={{ background: "#1e1e1e", border: "1px solid #444" }}
            />
            <Legend />
            {cutoff && cutoff >= fmin && cutoff <= fmax && (
              <ReferenceLine
                x={cutoff}
                stroke="#e3b341"
                strokeDasharray="5 5"
                strokeWidth={1.5}
                label={{
                  value: `f_cutoff: ${cutoff.toFixed(0)} Hz`,
                  fill: "#e3b341",
                  fontSize: 10,
                  position: "insideTopRight",
                }}
              />
            )}
            <Line
              type="monotone"
              dataKey="room_gain_db"
              stroke="#00d4ff"
              dot={false}
              name="Room Gain (dB)"
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      )}

      {!result && !loading && (
        <div style={{
          height: "120px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px dashed var(--border)",
          borderRadius: "8px",
          fontSize: "12px",
          color: "var(--text2)",
        }}>
          Click "Compute Room Gain" to see the boundary gain curve
        </div>
      )}
    </div>
  );
}
