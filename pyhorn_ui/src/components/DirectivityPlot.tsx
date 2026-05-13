import { useState, useMemo } from "react";

interface DirectivityPlotProps {
  hornYaml: string;
  resultAvailable: boolean;
  offAxisSpl: Record<string, number[]> | null;
  radiationAngle: number | null;
  directionIndex: number[][] | null;
}

// Parse key horn/driver params from YAML text
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

// Levine/Inglis approximate directivity factor for a rectangular piston in a baffle
// D(θ) = 2·cos(ka·sinθ) / (ka·sinθ)  [on-axis intensity, simplified]
// We use a cosine-power model: D(θ) ≈ cos^γ(θ) where γ ≈ (ka)² for ka > 1
function pistonDirectivity(angleDeg: number, ka: number): number {
  const theta = (angleDeg * Math.PI) / 180;
  if (ka < 0.05) return 1.0; // Very low frequency — omnidirectional
  const sinT = Math.sin(theta);
  if (sinT < 1e-6) return 1.0; // On-axis
  const x = ka * sinT;
  const j1 = ((x / 3) * (3 + x * x * (-0.6 + x * x * 0.0375)));
  const sinc = 2 * j1 / (x * (1 + x * x * 0.05));
  return Math.max(0, Math.abs(sinc));
}

// Estimate mouth radius from mouth_area (circular mouth approximation)
function mouthRadiusM(hornYaml: string): number {
  const ma = parseYamlFloat(hornYaml, "mouth_area");
  if (ma == null || ma <= 0) return 0.1;
  return Math.sqrt(ma / Math.PI);
}

// Off-axis SPL relative to on-axis (dB) at given angle
// Dθ_dB = 10 * log10(D(θ) / D(0)) = 10 * log10(D(θ)) since D(0) = 1
function offAxisSPLdB(angleDeg: number, freqHz: number, mouthRadiusM: number): number {
  const k = (2 * Math.PI * freqHz) / 343; // wave number
  const ka = k * mouthRadiusM;
  const D = pistonDirectivity(angleDeg, ka);
  return 10 * Math.log10(Math.max(1e-9, D));
}

// Build polar data for a set of angles at a fixed frequency
function buildPolarData(
  angles: number[],
  freqHz: number,
  mouthRadiusM: number,
  refSPL: number
): { angle: number; spl: number; r: number }[] {
  return angles.map((angle) => {
    const rel = offAxisSPLdB(angle, freqHz, mouthRadiusM);
    const spl = refSPL + rel;
    // Normalize r to 0-1 range for polar plot (relative to max drop of ~12 dB → scale to radius)
    const r = Math.max(0, 1 - Math.abs(rel) / 14);
    return { angle, spl, r };
  });
}

// Find -6dB beamwidth at a given frequency
function findBeamwidth6dB(
  freqHz: number,
  mouthRadiusM: number
): number {
  const R = mouthRadiusM;
  const k = (2 * Math.PI * freqHz) / 343;
  const ka = k * R;
  if (ka < 0.3) return 180; // Very wide beamwidth, nearly omnidirectional
  // Approximate -6dB half-angle for circular piston:
  // ka·sin(θ) ≈ 1.6 → θ ≈ arcsin(1.6/ka)
  const halfAngle = Math.asin(Math.min(1, 1.6 / Math.max(0.01, ka))) * (180 / Math.PI);
  return Math.min(180, halfAngle * 2);
}

const POLAR_ANGLES = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180];
const POLAR_ANGLES_HALF = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];

// ─── Direction Index-vs-frequency chart ──────────────────────────────────

function DirectivityIndexChart({
  directionIndex,
  offAxisAngles,
}: {
  directionIndex: number[][] | null;
  offAxisAngles: number[];
}) {
  // Use 30° if available, otherwise first non-zero angle
  const primaryAngle = offAxisAngles.includes(30)
    ? 30
    : offAxisAngles.find((a) => a > 0) ?? 45;

  const diData = (() => {
    if (!directionIndex) return null;
    const angleIdx = offAxisAngles.indexOf(primaryAngle);
    if (angleIdx < 0) return null;
    const n = directionIndex.length;
    if (n === 0) return null;
    const fmin = 20, fmax = 5000;
    const freqs = Array.from({ length: n }, (_, i) =>
      fmin * Math.pow(fmax / fmin, i / (n - 1))
    );
    return freqs.map((freq, i) => ({ freq, di: directionIndex[i][angleIdx] }));
  })();

  if (!diData) return null;

  const chartW = 300, chartH = 80;
  const padL = 38, padR = 10, padT = 10, padB = 24;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;

  const logScale = (v: number, min: number, max: number) =>
    (Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min));

  const xPx = (f: number) =>
    padL + logScale(f, 20, 5000) * innerW;

  // DI is negative; y=0 at top, y=bottom at -20
  const yMin = -20, yMax = 0;
  const yPx = (di: number) =>
    padT + ((yMax - di) / (yMax - yMin)) * innerH;

  const pathDI = (data: { freq: number; di: number }[]) => {
    if (!data || data.length === 0) return "";
    return data
      .map((d, i) => `${i === 0 ? "M" : "L"} ${xPx(d.freq).toFixed(1)},${yPx(d.di).toFixed(1)}`)
      .join(" ");
  };

  return (
    <div style={{ marginTop: "8px" }}>
      <div style={{ fontSize: "11px", color: "#8b949e", marginBottom: "4px" }}>
        Direction Index — {primaryAngle}° off-axis
      </div>
      <svg width={chartW} height={chartH} style={{ display: "block" }}>
        <rect x={padL} y={padT} width={innerW} height={innerH} fill="#161b22" rx="3" />

        {/* Grid lines — horizontal */}
        {[-5, -10, -15, -20].map((di) => (
          <line
            key={di}
            x1={padL}
            y1={yPx(di)}
            x2={padL + innerW}
            y2={yPx(di)}
            stroke="#30363d"
            strokeWidth={0.75}
          />
        ))}

        {/* 0 dB reference */}
        <line x1={padL} y1={yPx(0)} x2={padL + innerW} y2={yPx(0)}
          stroke="#e3b341" strokeWidth={0.75} strokeDasharray="2 4" opacity={0.5} />

        {/* DI line */}
        <path
          d={pathDI(diData)}
          fill="none"
          stroke="#f97316"
          strokeWidth={2}
        />

        {/* Y-axis labels */}
        {([0, -10, -20] as const).map((di) => (
          <text key={di} x={padL - 4} y={yPx(di) + 4} textAnchor="end"
            fill="#8b949e" fontSize="9">
            {di}
          </text>
        ))}

        {/* X-axis labels */}
        {([20, 100, 500, 1000, 5000] as const).map((f) => (
          <text key={f} x={xPx(f)} y={padT + innerH + 14} textAnchor="middle"
            fill="#8b949e" fontSize="9">
            {f >= 1000 ? `${f / 1000}k` : f}
          </text>
        ))}
        <text x={padL + innerW / 2} y={chartH - 3} textAnchor="middle"
          fill="#6e7681" fontSize="9">Hz</text>

        {/* Legend */}
        <line x1={padL + 4} y1={padT + 6} x2={padL + 16} y2={padT + 6}
          stroke="#f97316" strokeWidth={2} />
        <text x={padL + 19} y={padT + 9} fill="#8b949e" fontSize="8">DI @ {primaryAngle}°</text>
      </svg>
    </div>
  );
}

// ─── Beamwidth-vs-frequency chart ─────────────────────────────────────────

function BeamwidthChart({
  offAxisSpl,
  mouthR,
}: {
  offAxisSpl: Record<string, number[]> | null;
  mouthR: number;
}) {
  // Compute beamwidth at each frequency from API data
  const bwData = (() => {
    if (!offAxisSpl) return null;
    const n = Object.values(offAxisSpl)[0]?.length ?? 0;
    if (n === 0) return null;
    const fmin = 20, fmax = 5000;
    const freqs = Array.from({ length: n }, (_, i) =>
      fmin * Math.pow(fmax / fmin, i / (n - 1))
    );
    const result: { freq: number; bw: number }[] = [];
    for (let i = 0; i < n; i++) {
      const onAxis = offAxisSpl["0"]?.[i] ?? 0;
      let halfAngle = 180;
      for (const ha of POLAR_ANGLES_HALF) {
        const rel = (offAxisSpl[String(ha)]?.[i] ?? 0);
        if (rel <= onAxis - 6) { halfAngle = ha; break; }
      }
      result.push({ freq: freqs[i], bw: Math.min(180, halfAngle * 2) });
    }
    return result;
  })();

  // Also compute piston-model reference
  const pistonBw = (() => {
    if (!offAxisSpl) return null;
    const n = 200;
    const fmin = 20, fmax = 5000;
    return Array.from({ length: n }, (_, i) => {
      const f = fmin * Math.pow(fmax / fmin, i / (n - 1));
      return { freq: f, bw: findBeamwidth6dB(f, mouthR) };
    });
  })();

  if (!bwData && !pistonBw) return null;

  const chartW = 300, chartH = 80;
  const padL = 38, padR = 10, padT = 10, padB = 24;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;

  const logScale = (v: number, min: number, max: number) =>
    (Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min));

  const xPx = (f: number) =>
    padL + logScale(f, 20, 5000) * innerW;
  const yPx = (bw: number) =>
    padT + (1 - bw / 180) * innerH;

  const pathBw = (data: { freq: number; bw: number }[]) => {
    if (!data || data.length === 0) return "";
    return data
      .map((d, i) => `${i === 0 ? "M" : "L"} ${xPx(d.freq).toFixed(1)},${yPx(d.bw).toFixed(1)}`)
      .join(" ");
  };

  return (
    <div style={{ marginTop: "8px" }}>
      <div style={{ fontSize: "11px", color: "#8b949e", marginBottom: "4px" }}>
        −6 dB beamwidth vs frequency
      </div>
      <svg width={chartW} height={chartH} style={{ display: "block" }}>
        {/* Background */}
        <rect x={padL} y={padT} width={innerW} height={innerH} fill="#161b22" rx="3" />

        {/* Grid lines — horizontal */}
        {[0, 45, 90, 135, 180].map((bw) => (
          <line
            key={bw}
            x1={padL}
            y1={yPx(bw)}
            x2={padL + innerW}
            y2={yPx(bw)}
            stroke="#30363d"
            strokeWidth={0.75}
          />
        ))}

        {/* Piston model reference */}
        {pistonBw && (
          <path
            d={pathBw(pistonBw)}
            fill="none"
            stroke="#6e7681"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {/* API beamwidth line */}
        {bwData && (
          <path
            d={pathBw(bwData)}
            fill="none"
            stroke="#00d4ff"
            strokeWidth={2}
          />
        )}

        {/* Reference lines at 90° and 180° */}
        <line x1={padL} y1={yPx(90)} x2={padL + innerW} y2={yPx(90)}
          stroke="#e3b341" strokeWidth={0.75} strokeDasharray="2 4" opacity={0.5} />

        {/* Y-axis labels */}
        {([0, 90, 180] as const).map((bw) => (
          <text key={bw} x={padL - 4} y={yPx(bw) + 4} textAnchor="end"
            fill="#8b949e" fontSize="9">
            {bw}°
          </text>
        ))}

        {/* X-axis labels */}
        {([20, 100, 500, 1000, 5000] as const).map((f) => (
          <text key={f} x={xPx(f)} y={padT + innerH + 14} textAnchor="middle"
            fill="#8b949e" fontSize="9">
            {f >= 1000 ? `${f / 1000}k` : f}
          </text>
        ))}
        <text x={padL + innerW / 2} y={chartH - 3} textAnchor="middle"
          fill="#6e7681" fontSize="9">Hz</text>

        {/* Legend */}
        {bwData && (
          <g>
            <line x1={padL + 4} y1={padT + 6} x2={padL + 16} y2={padT + 6}
              stroke="#00d4ff" strokeWidth={2} />
            <text x={padL + 19} y={padT + 9} fill="#8b949e" fontSize="8">Horn model</text>
          </g>
        )}
        <line x1={padL + 90} y1={padT + 6} x2={padL + 102} y2={padT + 6}
          stroke="#6e7681" strokeWidth={1} strokeDasharray="3 3" />
        <text x={padL + 105} y={padT + 9} fill="#6e7681" fontSize="8">Piston ref.</text>
      </svg>
    </div>
  );
}

// SVG polar plot
function PolarChart({
  data,
  polarFreq,
}: {
  data: { angle: number; spl: number; r: number }[];
  polarFreq: number;
}) {
  const size = 240;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size / 2 - 18;

  // Convert polar to SVG x,y
  const toXY = (angle: number, r: number) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return {
      x: cx + r * maxR * Math.cos(rad),
      y: cy + r * maxR * Math.sin(rad),
    };
  };

  // Grid rings at r = 0.25, 0.5, 0.75, 1.0
  const rings = [0.25, 0.5, 0.75, 1.0];
  // Radial lines every 30°
  const radials = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330];

  const pts = data.map((d) => ({ ...toXY(d.angle, d.r), angle: d.angle }));

  // Generate SVG arc for the filled area
  const buildAreaPath = () => {
    if (pts.length === 0) return "";
    const first = pts[0];
    let d = `M ${first.x.toFixed(1)},${first.y.toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      // Check if we crossed the 0/360 boundary (jump)
      const delta = Math.abs(curr.angle - prev.angle);
      if (delta > 90) {
        // Crossed boundary — draw line back to origin then to next
        d += ` L ${cx.toFixed(1)},${cy.toFixed(1)} L ${curr.x.toFixed(1)},${curr.y.toFixed(1)}`;
      } else {
        d += ` L ${curr.x.toFixed(1)},${curr.y.toFixed(1)}`;
      }
    }
    d += " Z";
    return d;
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: "block", margin: "0 auto", overflow: "visible" }}
    >
      {/* Background circle */}
      <circle cx={cx} cy={cy} r={maxR} fill="#0d1117" stroke="#21262d" strokeWidth="1" />

      {/* Grid rings */}
      {rings.map((r) => (
        <circle
          key={r}
          cx={cx}
          cy={cy}
          r={r * maxR}
          fill="none"
          stroke="#30363d"
          strokeWidth={r === 1 ? 1.5 : 0.75}
          strokeDasharray={r === 1 ? "4 2" : undefined}
        />
      ))}

      {/* Radial lines */}
      {radials.map((a) => {
        const end = toXY(a, 1);
        return (
          <line
            key={a}
            x1={cx}
            y1={cy}
            x2={end.x}
            y2={end.y}
            stroke="#30363d"
            strokeWidth={a % 90 === 0 ? 1 : 0.5}
          />
        );
      })}

      {/* Angle labels */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
        const labelR = maxR + 10;
        const rad = ((a - 90) * Math.PI) / 180;
        const lx = cx + labelR * Math.cos(rad);
        const ly = cy + labelR * Math.sin(rad);
        return (
          <text
            key={a}
            x={lx}
            y={ly}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#8b949e"
            fontSize="9"
          >
            {a}°
          </text>
        );
      })}

      {/* -6dB ring reference */}
      <circle
        cx={cx}
        cy={cy}
        r={(1 - 6 / 14) * maxR}
        fill="none"
        stroke="#e3b341"
        strokeWidth={1}
        strokeDasharray="3 3"
        opacity={0.5}
      />

      {/* Filled area */}
      <path
        d={buildAreaPath()}
        fill="url(#polarGrad)"
        fillOpacity={0.3}
        stroke="none"
      />

      {/* Outline path */}
      <path
        d={buildAreaPath()}
        fill="none"
        stroke="#00d4ff"
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {/* Data point dots */}
      {pts.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={2.5}
          fill="#00d4ff"
          stroke="#0d1117"
          strokeWidth={1}
        />
      ))}

      {/* Center dot */}
      <circle cx={cx} cy={cy} r={3} fill="#8b949e" />

      <defs>
        <radialGradient id="polarGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#00d4ff" stopOpacity={0.5} />
          <stop offset="100%" stopColor="#00d4ff" stopOpacity={0.05} />
        </radialGradient>
      </defs>

      {/* Title */}
      <text
        x={cx}
        y={8}
        textAnchor="middle"
        fill="#e6edf3"
        fontSize="11"
        fontWeight="600"
      >
        {polarFreq} Hz — Polar Pattern
      </text>
    </svg>
  );
}

export default function DirectivityPlot({
  hornYaml,
  resultAvailable,
  offAxisSpl,
  radiationAngle,
  directionIndex,
}: DirectivityPlotProps) {
  const [polarFreq, setPolarFreq] = useState(1000);

  const mouthR = useMemo(() => mouthRadiusM(hornYaml), [hornYaml]);

  // Interpolate off-axis SPL at polarFreq from API response (freqs × angle → SPL)
  // API frequencies are logarithmically spaced: f(i) = fmin * (fmax/fmin)^(i/(n-1))
  const getApiOffAxisDb = (angleDeg: number): number | null => {
    if (!offAxisSpl) return null;
    const key = String(angleDeg);
    const splArr = offAxisSpl[key];
    if (!splArr || splArr.length === 0) return null;
    const n = splArr.length;
    const fmin = 20, fmax = 5000;
    const t = Math.log(polarFreq / fmin) / Math.log(fmax / fmin);
    const idx = t * (n - 1);
    const lo = Math.max(0, Math.min(n - 2, Math.floor(idx)));
    const hi = lo + 1;
    const frac = idx - lo;
    return splArr[lo] * (1 - frac) + splArr[hi] * frac;
  };

  const polarData = useMemo(() => {
    // Try API data first; fall back to piston model
    const apiAngle0Db = getApiOffAxisDb(0);
    if (apiAngle0Db !== null) {
      return POLAR_ANGLES.map((angle) => {
        const relDb = getApiOffAxisDb(angle);
        if (relDb === null) return { angle, spl: 90, r: 1 };
        // relDb is already dB relative to on-axis
        const spl = 90 + relDb;
        const r = Math.max(0, 1 - Math.abs(relDb) / 14);
        return { angle, spl, r };
      });
    }
    // Fall back to piston model
    return buildPolarData(POLAR_ANGLES, polarFreq, mouthR, 90);
  }, [polarFreq, mouthR, offAxisSpl]);

  const beamwidth6 = useMemo(() => {
    // Try API-based beamwidth
    if (offAxisSpl) {
      for (let hw = 1; hw <= 90; hw++) {
        const angle = 90 - hw;
        const rel = getApiOffAxisDb(angle);
        if (rel !== null && rel <= -6) return hw * 2;
      }
    }
    return findBeamwidth6dB(polarFreq, mouthR);
  }, [polarFreq, mouthR, offAxisSpl]);

  // Frequency presets
  const freqPresets = [250, 500, 1000, 2000, 4000];

  if (!resultAvailable) {
    return (
      <div
        style={{
          height: "260px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#8b949e",
          fontSize: "13px",
        }}
      >
        Run a simulation to see directivity
      </div>
    );
  }

  return (
    <div className="directivity-container">
      {/* Controls row */}
      <div className="directivity-controls">
        <div className="control-group">
          <label className="control-label">Polar Frequency (Hz)</label>
          <div className="freq-presets">
            {freqPresets.map((f) => (
              <button
                key={f}
                className={`preset-btn ${polarFreq === f ? "active" : ""}`}
                onClick={() => setPolarFreq(f)}
              >
                {f >= 1000 ? `${f / 1000}k` : f}
              </button>
            ))}
          </div>
          <input
            type="number"
            className="freq-input"
            value={polarFreq}
            min={20}
            max={20000}
            step={50}
            onChange={(e) => setPolarFreq(Number(e.target.value))}
          />
        </div>

        <div className="beamwidth-display">
          <span className="beamwidth-label">−6 dB beamwidth</span>
          <span className="beamwidth-value">±{beamwidth6.toFixed(0)}°</span>
          <span className="beamwidth-note">
            {beamwidth6 >= 150
              ? "→ Wide (omnidirectional)"
              : beamwidth6 >= 60
              ? "→ Moderate"
              : "→ Narrow (directional)"}
          </span>
        </div>

        {radiationAngle !== null && (
          <div className="beamwidth-display" style={{ marginTop: "6px" }}>
            <span className="beamwidth-label">Mean radiation angle</span>
            <span className="beamwidth-value" style={{ color: "#f97316" }}>
              {radiationAngle.toFixed(1)}°
            </span>
            <span className="beamwidth-note">
              mean −6 dB half-angle
            </span>
          </div>
        )}
      </div>

      {/* Two-column layout: polar plot + beamwidth summary */}
      <div className="directivity-layout">
        <div>
          <PolarChart
            data={polarData}
            polarFreq={polarFreq}
          />
          {/* Beamwidth vs frequency chart */}
          <BeamwidthChart offAxisSpl={offAxisSpl} mouthR={mouthR} />
          {/* Direction Index vs frequency chart */}
          <DirectivityIndexChart
            directionIndex={directionIndex}
            offAxisAngles={[0, 15, 30, 45, 60, 75, 90]}
          />
        </div>

        <div className="directivity-table">
          <h4 style={{ margin: "0 0 8px 0", color: "#e6edf3", fontSize: "12px" }}>
            Off-axis SPL ({polarFreq} Hz, ref: on-axis)
          </h4>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ color: "#8b949e" }}>
                <th style={{ textAlign: "left", padding: "2px 6px" }}>Angle</th>
                <th style={{ textAlign: "right", padding: "2px 6px" }}>Rel. SPL</th>
                <th style={{ textAlign: "right", padding: "2px 6px" }}>ka</th>
              </tr>
            </thead>
            <tbody>
              {POLAR_ANGLES.map((angle) => {
                const rel = getApiOffAxisDb(angle) ?? offAxisSPLdB(angle, polarFreq, mouthR);
                const k = (2 * Math.PI * polarFreq) / 343;
                const ka = k * mouthR;
                const k_a_theta = ka * Math.sin((angle * Math.PI) / 180);
                return (
                  <tr
                    key={angle}
                    style={{
                      color: Math.abs(rel) > 6 ? "#f85149" : Math.abs(rel) > 3 ? "#e3b341" : "#79c0ff",
                    }}
                  >
                    <td style={{ padding: "2px 6px", color: "#e6edf3" }}>{angle}°</td>
                    <td style={{ padding: "2px 6px", textAlign: "right" }}>
                      {rel >= 0 ? "+" : ""}{rel.toFixed(1)} dB
                    </td>
                    <td style={{ padding: "2px 6px", textAlign: "right", color: "#8b949e" }}>
                      {k_a_theta.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p style={{ marginTop: "10px", fontSize: "10px", color: "#6e7681", lineHeight: "1.4" }}>
            {offAxisSpl
              ? "From horn simulation (piston radiation model)."
              : "Based on Levine/Inglis piston model for circular mouth aperture. "}
            ka &gt; 1 → increasingly directional.
          </p>
        </div>
      </div>
    </div>
  );
}
