/**
 * HornSynthesisWizard — Hornresp page 067 "System Design"
 *
 * Full end-to-end synthesis tool: given T-S parameters + frequency range,
 * runs the optimizer to generate a complete horn system (driver, horn geometry,
 * chambers, baffle). Wires to the existing POST /synthesize + GET /synthesize/{task_id}
 * endpoints in server.py.
 */
import { useState, useCallback, useRef } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { ImportedRoomGain } from "./RoomGeneratorPanel";

export interface HornSynthesisWizardProps {
  /** Pre-populate T-S fields from an existing driver YAML */
  initialDriverYaml?: string;
  /** Called when user wants to load the synthesized horn into the main editors */
  onLoadResult?: (geometryYaml: string, driverYaml: string) => void;
  /** Imported room gain from RoomGeneratorPanel — used to show room-corrected acoustical power */
  importedGain?: ImportedRoomGain | null;
}

// ── T-S parameter field definition ───────────────────────────────────────────
interface TSField {
  key: keyof SynthRequest;
  label: string;
  unit: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  default: number;
  decimals?: number;
}

interface SynthRequest {
  fs: number;
  qts: number;
  qes: number;
  qms: number;
  vas: number;
  re: number;
  bl: number;
  mms: number;
  cms: number;
  rms: number;
  sd: number;
  voltage: number;
  le: number;
  xmax: number;
  fmin: number;
  fmax: number;
  mouth_area_max: number | null;
  path_length_max: number | null;
  profile_types: string[];
}

// ── Parse T-S params from driver YAML ─────────────────────────────────────────
function parseTSFromYaml(yaml: string): Partial<SynthRequest> {
  const result: Partial<Record<keyof SynthRequest, number>> = {};
  const pattern = /^\s*(\w+)\s*:\s*([\d.e+-]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(yaml)) !== null) {
    const key = m[1] as keyof SynthRequest;
    const val = parseFloat(m[2]);
    if (key in result || ![
      "fs","qts","qes","qms","vas","re","bl","mms","cms","rms","sd","le","xmax"
    ].includes(key)) continue;
    (result as Record<string, number>)[key] = val;
  }
  return result as Partial<SynthRequest>;
}

// ── Build driver YAML from T-S params ─────────────────────────────────────────
function buildDriverYaml(p: SynthRequest): string {
  return `# Synthesized driver\n---\nfs: ${p.fs}\nqts: ${p.qts}\nqes: ${p.qes}\nqms: ${p.qms}\nvas: ${p.vas}\nre: ${p.re}\nbl: ${p.bl}\nmms: ${p.mms}\ncms: ${p.cms}\nrms: ${p.rms}\nsd: ${p.sd}\nvoltage: ${p.voltage}\nle: ${p.le}\nxmax: ${p.xmax}`;
}

// ── Build geometry YAML from synthesis result ──────────────────────────────────
function buildGeometryYaml(horn: SynthHornResult): string {
  const sections = [];
  sections.push(`  - name: throat
    profile_type: straight
    length: ${(0.05).toFixed(4)}
    start_area: ${horn.throat_area}
    end_area: ${horn.throat_area}`);
  sections.push(`  - name: main_horn
    profile_type: ${horn.profile_type}
    hyperbolic_t: ${horn.hyperbolic_t ?? 0.5}
    length: ${horn.path_length}
    start_area: ${horn.throat_area}
    end_area: ${horn.mouth_area}`);
  sections.push(`  - name: mouth
    profile_type: straight
    length: ${(0.05).toFixed(4)}
    start_area: ${horn.mouth_area}
    end_area: ${horn.mouth_area}`);

  return `# Synthesized horn geometry\n---\nenclosure_type: ${horn.enclosure_type ?? "bkh"}\nlrc: ${horn.lrc ?? 0.18}\nvrc: ${horn.vrc ?? 0}\nvtc: ${horn.vtc ?? 0}\natc: ${horn.atc ?? 0}\nang: ${horn.ang ?? 3.1416}\nsections:\n${sections.join("\n")}`;
}

interface SynthHornResult {
  throat_area: number;
  mouth_area: number;
  path_length: number;
  profile_type: string;
  hyperbolic_t?: number;
  n_segments?: number;
  enclosure_type?: string;
  lrc?: number;
  vrc?: number;
  vtc?: number;
  atc?: number;
  ang?: number;
}

interface SynthMetrics {
  profile_type: string;
  cost: number;
  mean_spl_db: number;
  flatness_db: number;
  bass_deficit_db: number;
  excursion_ok: boolean;
  n_evaluations: number;
}

// ── T-S field definitions ─────────────────────────────────────────────────────
const TS_FIELDS: TSField[] = [
  { key: "fs",   label: "fs",   unit: "Hz",   hint: "Free-air resonance frequency",       min: 10,    max: 200,   step: 0.5,   default: 50,    decimals: 1 },
  { key: "qts",  label: "Qts",  unit: "",      hint: "Total Q factor",                    min: 0.1,   max: 2.0,   step: 0.01,  default: 0.5,   decimals: 2 },
  { key: "qes",  label: "Qes",  unit: "",      hint: "Electrical Q",                      min: 0.1,   max: 2.0,   step: 0.01,  default: 0.4,   decimals: 2 },
  { key: "qms",  label: "Qms",  unit: "",      hint: "Mechanical Q",                      min: 0.5,   max: 20,    step: 0.1,   default: 5,     decimals: 1 },
  { key: "vas",  label: "Vas",  unit: "L",     hint: "Equivalent volume (litres)",        min: 0.1,   max: 200,   step: 0.1,   default: 20,    decimals: 2 },
  { key: "re",   label: "Re",   unit: "Ω",    hint: "DC resistance",                     min: 1,     max: 50,    step: 0.1,   default: 7.8,   decimals: 1 },
  { key: "bl",   label: "Bl",   unit: "N/A",  hint: "Force factor",                       min: 1,     max: 30,    step: 0.1,   default: 7.8,   decimals: 2 },
  { key: "mms",  label: "Mms",  unit: "g",    hint: "Moving mass",                       min: 1,     max: 100,   step: 0.1,   default: 6.99,  decimals: 2 },
  { key: "cms",  label: "Cms",  unit: "mm/N", hint: "Stiffness (×10⁻³ m/N → enter ×10⁻³)", min: 0.01, max: 5,    step: 0.001, default: 1.472, decimals: 3 },
  { key: "rms",  label: "Rms",  unit: "kg/s", hint: "Mechanical resistance",               min: 0.01, max: 5,     step: 0.01,  default: 0.28,  decimals: 2 },
  { key: "sd",   label: "Sd",   unit: "cm²",  hint: "Piston diaphragm area",              min: 20,    max: 500,   step: 1,     default: 132.7, decimals: 1 },
  { key: "le",   label: "Le",   unit: "mH",   hint: "Voice coil inductance",              min: 0.01,  max: 5,     step: 0.01,  default: 0.8,   decimals: 2 },
  { key: "xmax", label: "Xmax", unit: "mm",   hint: "Max linear excursion",               min: 0,     max: 20,    step: 0.1,   default: 0,     decimals: 1 },
];

const PROFILE_TYPES = ["exponential", "hyperbolic", "catenoidal", "conical", "parabolic", "straight"];

// ── Metric badge ───────────────────────────────────────────────────────────────
function MetricBadge({ label, value, unit, color }: {
  label: string; value: string | number; unit?: string; color?: string;
}) {
  return (
    <div className="hsw-metric" style={color ? { borderLeftColor: color } : {}}>
      <span className="hsw-metric-label">{label}</span>
      <span className="hsw-metric-value">
        {typeof value === "number" ? value.toFixed(2) : value}
        {unit && <span className="hsw-metric-unit"> {unit}</span>}
      </span>
    </div>
  );
}

// ── T-S field slider ───────────────────────────────────────────────────────────
function TSFieldSlider({ field, value, onChange }: {
  field: TSField; value: number; onChange: (v: number) => void;
}) {
  const pct = Math.max(0, Math.min(100,
    ((value - field.min) / (field.max - field.min)) * 100));

  return (
    <div className="hsw-param-row">
      <div className="hsw-param-label">
        <span className="hsw-param-name">{field.label}</span>
        <span className="hsw-param-hint">{field.hint}</span>
      </div>
      <div className="hsw-param-control">
        <span className="hsw-param-value">
          {value.toFixed(field.decimals ?? 2)} {field.unit}
        </span>
        <div className="hsw-slider-track">
          <div className="hsw-slider-fill" style={{ width: `${pct}%` }} />
          <input
            type="range"
            min={field.min}
            max={field.max}
            step={field.step}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="hsw-slider"
          />
        </div>
      </div>
    </div>
  );
}

// ── Interpolation helper (mirrors RoomGeneratorPanel.interpolateRoomGain) ─────
function interpolateGain(
  freqs: number[],
  gains: number[],
  freq: number
): number {
  if (freqs.length === 0) return 0;
  if (freq <= freqs[0]) return gains[0];
  if (freq >= freqs[freqs.length - 1]) return gains[freqs.length - 1];
  for (let i = 0; i < freqs.length - 1; i++) {
    if (freq >= freqs[i] && freq <= freqs[i + 1]) {
      const t = (freq - freqs[i]) / (freqs[i + 1] - freqs[i]);
      return gains[i] + t * (gains[i + 1] - gains[i]);
    }
  }
  return 0;
}

// ── Simple SPL chart (no room gain import) ────────────────────────────────────
function AcousticalPowerChartSimple({
  simResult,
}: {
  simResult: { frequencies: number[]; spl: number[]; room_gain_db?: number[] };
}) {
  const chartData = simResult.frequencies.map((f, i) => ({
    freq: f,
    spl: simResult.spl[i],
    // If server returned a theoretical room gain, show it
    ...(simResult.room_gain_db && simResult.room_gain_db[i] != null
      ? { roomGain: simResult.room_gain_db[i] }
      : {}),
    // Combined = SPL + room gain
    ...(simResult.room_gain_db && simResult.room_gain_db[i] != null
      ? { combined: simResult.spl[i] + simResult.room_gain_db[i] }
      : { combined: simResult.spl[i] }),
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={chartData} margin={{ top: 4, right: 16, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #2a2a3a)" />
        <XAxis
          dataKey="freq"
          scale="log"
          type="number"
          domain={[20, 20000]}
          tickFormatter={(f) => (f >= 1000 ? `${(f / 1000).toFixed(0)}k` : f.toFixed(0))}
          tick={{ fontSize: 10, fill: "var(--text2, #888)" }}
          stroke="var(--border, #2a2a3a)"
        />
        <YAxis
          tickFormatter={(v) => v.toFixed(0)}
          tick={{ fontSize: 10, fill: "var(--text2, #888)" }}
          stroke="var(--border, #2a2a3a)"
        />
        <Tooltip
          formatter={(v: number, name: string) => [`${v.toFixed(1)} dB`, name]}
          labelFormatter={(f) => `${Number(f).toFixed(0)} Hz`}
          contentStyle={{ fontSize: 11 }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {simResult.room_gain_db && simResult.room_gain_db.length > 0 && (
          <Line
            type="monotone"
            dataKey="roomGain"
            name="Room Gain (dB)"
            stroke="#22c55e"
            strokeDasharray="5 5"
            dot={false}
            strokeWidth={1.5}
          />
        )}
        <Line
          type="monotone"
          dataKey="spl"
          name="SPL (dB)"
          stroke="#f97316"
          dot={false}
          strokeWidth={1.5}
        />
        <Line
          type="monotone"
          dataKey="combined"
          name="Acoustical Power (dB)"
          stroke="#a78bfa"
          strokeDasharray="3 3"
          dot={false}
          strokeWidth={1.5}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Chart with imported room gain overlay ──────────────────────────────────────
function AcousticalPowerChartWithRoom({
  simResult,
  importedGain,
}: {
  simResult: { frequencies: number[]; spl: number[]; room_gain_db?: number[] };
  importedGain: ImportedRoomGain;
}) {
  const chartData = simResult.frequencies.map((f, i) => {
    const imported = interpolateGain(
      importedGain.frequencies,
      importedGain.room_gain_db,
      f
    );
    return {
      freq: f,
      spl: simResult.spl[i],
      importedRoomGain: imported,
      combined: simResult.spl[i] + imported,
    };
  });

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={chartData} margin={{ top: 4, right: 16, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #2a2a3a)" />
        <XAxis
          dataKey="freq"
          scale="log"
          type="number"
          domain={[20, 20000]}
          tickFormatter={(f) => (f >= 1000 ? `${(f / 1000).toFixed(0)}k` : f.toFixed(0))}
          tick={{ fontSize: 10, fill: "var(--text2, #888)" }}
          stroke="var(--border, #2a2a3a)"
        />
        <YAxis
          tickFormatter={(v) => v.toFixed(0)}
          tick={{ fontSize: 10, fill: "var(--text2, #888)" }}
          stroke="var(--border, #2a2a3a)"
        />
        <Tooltip
          formatter={(v: number, name: string) => [`${v.toFixed(1)} dB`, name]}
          labelFormatter={(f) => `${Number(f).toFixed(0)} Hz`}
          contentStyle={{ fontSize: 11 }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line
          type="monotone"
          dataKey="spl"
          name="SPL (dB)"
          stroke="#f97316"
          dot={false}
          strokeWidth={1.5}
        />
        <Line
          type="monotone"
          dataKey="importedRoomGain"
          name="Imported Room Gain (dB)"
          stroke="#22c55e"
          strokeDasharray="5 5"
          dot={false}
          strokeWidth={1.5}
        />
        <Line
          type="monotone"
          dataKey="combined"
          name="Ac. Power (dB SPL + room)"
          stroke="#a78bfa"
          dot={false}
          strokeWidth={2}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function HornSynthesisWizard({
  initialDriverYaml = "",
  onLoadResult,
  importedGain,
}: HornSynthesisWizardProps) {
  // Parse initial driver YAML if provided
  const initial = parseTSFromYaml(initialDriverYaml);

  const [params, setParams] = useState<SynthRequest>(() => ({
    fs:    initial.fs    ?? 50,
    qts:   initial.qts   ?? 0.5,
    qes:   initial.qes   ?? 0.4,
    qms:   initial.qms   ?? 5,
    vas:   initial.vas   ?? 0.02,   // stored as m³; 0.02 m³ = 20 L
    re:    initial.re    ?? 7.8,
    bl:    initial.bl    ?? 7.8,
    mms:   initial.mms   ?? 0.00699, // stored as kg; 6.99 g = 0.00699 kg
    cms:   initial.cms   ?? 1.472e-3,
    rms:   initial.rms   ?? 0.28,
    sd:    initial.sd    ?? 0.01327, // stored as m²; 132.7 cm² = 0.01327 m²
    voltage: 2.83,
    le:    initial.le    ?? 0.0008, // stored as H; 0.8 mH = 0.0008 H
    xmax:  initial.xmax  ?? 0,
    fmin:  80,
    fmax:  5000,
    mouth_area_max: null,
    path_length_max: null,
    profile_types: ["exponential", "hyperbolic", "catenoidal"],
  }));

  // vas stored as L in UI but m³ in API
  const [vas_L, setVas_L] = useState(
    initial.vas != null ? initial.vas * 1000 : 20
  );
  // sd stored as cm² in UI but m² in API
  const [sd_cm2, setSd_cm2] = useState(
    initial.sd != null ? initial.sd * 1e4 : 132.7
  );

  const [fmin, setFmin] = useState(80);
  const [fmax, setFmax] = useState(5000);
  const [mouthAreaMax, setMouthAreaMax] = useState<string>("");
  const [pathLengthMax, setPathLengthMax] = useState<string>("");
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>(["exponential", "hyperbolic", "catenoidal"]);

  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<{ horn: SynthHornResult; metrics: SynthMetrics } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [simResult, setSimResult] = useState<{
    frequencies: number[]; spl: number[];
    room_gain_db?: number[];
  } | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleProfile = useCallback((p: string) => {
    setSelectedProfiles((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  }, []);

  const startSynthesis = useCallback(async () => {
    setStatus("running");
    setErrorMsg(null);
    setResult(null);
    setSimResult(null);
    setSimError(null);

    // Build API request — convert UI units to SI
    const reqBody = {
      fs: params.fs,
      qts: params.qts,
      qes: params.qes,
      qms: params.qms,
      vas: vas_L / 1000,           // L → m³
      re: params.re,
      bl: params.bl,
      mms: params.mms / 1000,      // g → kg
      cms: params.cms,             // already mm/N × 10⁻³ = m/N
      rms: params.rms,
      sd: sd_cm2 / 1e4,            // cm² → m²
      voltage: params.voltage,
      le: params.le / 1000,         // mH → H
      xmax: params.xmax / 1000,    // mm → m
      fmin,
      fmax,
      mouth_area_max: mouthAreaMax ? parseFloat(mouthAreaMax) : null,
      path_length_max: pathLengthMax ? parseFloat(pathLengthMax) : null,
      profile_types: selectedProfiles.length > 0 ? selectedProfiles : ["exponential"],
    };

    try {
      const res = await fetch("http://localhost:8765/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      const data = await res.json();

      // Start polling
      const poll = async () => {
        try {
          const pollRes = await fetch(`http://localhost:8765/synthesize/${data.task_id}`);
          if (!pollRes.ok) throw new Error(`Poll failed: ${pollRes.status}`);
          const pollData = await pollRes.json();
          if (pollData.status === "running") {
            pollRef.current = setTimeout(poll, 1500);
          } else if (pollData.status === "done") {
            if (pollData.error) {
              setErrorMsg(pollData.error);
              setStatus("error");
            } else if (pollData.result) {
              setResult(pollData.result);
              setStatus("done");
              // Kick off a simulation to get the SPL curve for the acoustical power chart
              runSimulation(pollData.result);

            } else {
              setErrorMsg("No result returned");
              setStatus("error");
            }
          }
        } catch (e) {
          setErrorMsg(e instanceof Error ? e.message : "Poll failed");
          setStatus("error");
        }
      };
      pollRef.current = setTimeout(poll, 1500);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Synthesis failed");
      setStatus("error");
    }
  }, [params, vas_L, sd_cm2, fmin, fmax, mouthAreaMax, pathLengthMax, selectedProfiles]);

  // ── Run simulation to get SPL for acoustical power chart ─────────────────────
  const runSimulation = useCallback(
    async (synthResult: { horn: SynthHornResult; metrics: SynthMetrics }) => {
      setSimResult(null);
      setSimError(null);
      const geoYaml = buildGeometryYaml(synthResult.horn);
      const drvYaml = buildDriverYaml({ ...params, vas: vas_L / 1000, sd: sd_cm2 / 1e4 });
      try {
        const simRes = await fetch("http://localhost:8765/simulate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            driver_config: drvYaml,
            horn_config: geoYaml,
            fmin,
            fmax,
            n_points: 200,
          }),
        });
        if (!simRes.ok) {
          const err = await simRes.json().catch(() => ({ detail: "Simulate failed" }));
          setSimError(err.detail ?? `HTTP ${simRes.status}`);
          return;
        }
        const simData = await simRes.json();
        setSimResult({
          frequencies: simData.frequencies ?? [],
          spl: simData.spl_db ?? [],
          room_gain_db: simData.room_gain_db ?? [],
        });
      } catch (e) {
        setSimError(e instanceof Error ? e.message : "Simulation failed");
      }
    },
    [params, vas_L, sd_cm2, fmin, fmax]
  );

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
  }, []);

  const copyYaml = useCallback(() => {
    if (!result) return;
    const geo = buildGeometryYaml(result.horn);
    const drv = buildDriverYaml({ ...params, vas: vas_L / 1000, sd: sd_cm2 / 1e4 });
    const combined = `### DRIVER\n${drv}\n\n### HORN GEOMETRY\n${geo}`;
    navigator.clipboard.writeText(combined).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [result, params, vas_L, sd_cm2]);

  const loadIntoEditor = useCallback(() => {
    if (!result || !onLoadResult) return;
    const geo = buildGeometryYaml(result.horn);
    const drv = buildDriverYaml({ ...params, vas: vas_L / 1000, sd: sd_cm2 / 1e4 });
    onLoadResult(geo, drv);
  }, [result, onLoadResult, params, vas_L, sd_cm2]);

  const driverYaml = buildDriverYaml({ ...params, vas: vas_L / 1000, sd: sd_cm2 / 1e4 });
  const geometryYaml = result ? buildGeometryYaml(result.horn) : "";

  return (
    <div className="hsw">
      <div className="hsw-header">
        <h3>🎺 Horn System Synthesis Wizard</h3>
        <p className="hsw-subtitle">
          Hornresp page 067 — end-to-end synthesis from T-S parameters → complete horn system
        </p>
      </div>

      {/* ── Frequency Range ─────────────────────────────────── */}
      <div className="hsw-section">
        <h4 className="hsw-section-title">Frequency Range</h4>
        <div className="hsw-freq-row">
          <div className="hsw-freq-field">
            <label>Fmin (Hz)</label>
            <input
              type="number"
              min={10}
              max={500}
              value={fmin}
              onChange={(e) => setFmin(parseInt(e.target.value) || 10)}
              className="hsw-number-input"
            />
            <span className="hsw-freq-hint">Low-frequency cutoff target</span>
          </div>
          <div className="hsw-freq-field">
            <label>Fmax (Hz)</label>
            <input
              type="number"
              min={1000}
              max={20000}
              value={fmax}
              onChange={(e) => setFmax(parseInt(e.target.value) || 5000)}
              className="hsw-number-input"
            />
            <span className="hsw-freq-hint">High-frequency limit</span>
          </div>
        </div>

        {/* Optional constraints */}
        <div className="hsw-constraints">
          <div className="hsw-constraint-field">
            <label>Mouth area max (m²)</label>
            <input
              type="text"
              placeholder="auto"
              value={mouthAreaMax}
              onChange={(e) => setMouthAreaMax(e.target.value)}
              className="hsw-text-input"
            />
          </div>
          <div className="hsw-constraint-field">
            <label>Path length max (m)</label>
            <input
              type="text"
              placeholder="auto"
              value={pathLengthMax}
              onChange={(e) => setPathLengthMax(e.target.value)}
              className="hsw-text-input"
            />
          </div>
        </div>

        {/* Profile type selector */}
        <div className="hsw-profile-row">
          <span className="hsw-profile-label">Profile types:</span>
          {PROFILE_TYPES.map((p) => (
            <button
              key={p}
              className={`hsw-profile-btn ${selectedProfiles.includes(p) ? "active" : ""}`}
              onClick={() => toggleProfile(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="hsw-divider" />

      {/* ── T-S Parameters ────────────────────────────────────── */}
      <div className="hsw-section">
        <h4 className="hsw-section-title">Thiele-Small Parameters</h4>

        {/* Special UI for Vas and Sd (shown in L and cm²) */}
        <div className="hsw-param-row">
          <div className="hsw-param-label">
            <span className="hsw-param-name">Vas</span>
            <span className="hsw-param-hint">Equivalent volume</span>
          </div>
          <div className="hsw-param-control">
            <span className="hsw-param-value">{vas_L.toFixed(2)} L</span>
            <div className="hsw-slider-track">
              <div className="hsw-slider-fill"
                style={{ width: `${((vas_L - 0.1) / (200 - 0.1)) * 100}%` }} />
              <input
                type="range" min={0.1} max={200} step={0.1}
                value={vas_L}
                onChange={(e) => setVas_L(parseFloat(e.target.value))}
                className="hsw-slider"
              />
            </div>
          </div>
        </div>

        <div className="hsw-param-row">
          <div className="hsw-param-label">
            <span className="hsw-param-name">Sd</span>
            <span className="hsw-param-hint">Diaphragm piston area</span>
          </div>
          <div className="hsw-param-control">
            <span className="hsw-param-value">{sd_cm2.toFixed(1)} cm²</span>
            <div className="hsw-slider-track">
              <div className="hsw-slider-fill"
                style={{ width: `${((sd_cm2 - 20) / (500 - 20)) * 100}%` }} />
              <input
                type="range" min={20} max={500} step={1}
                value={sd_cm2}
                onChange={(e) => setSd_cm2(parseFloat(e.target.value))}
                className="hsw-slider"
              />
            </div>
          </div>
        </div>

        {/* Rest of T-S fields */}
        {TS_FIELDS.filter((f) => f.key !== "vas" && f.key !== "sd").map((field) => (
          <TSFieldSlider
            key={field.key}
            field={field}
            value={params[field.key] as number}
            onChange={(v) =>
              setParams((p) => ({ ...p, [field.key]: v }))
            }
          />
        ))}
      </div>

      <div className="hsw-divider" />

      {/* ── Action ───────────────────────────────────────────── */}
      <div className="hsw-action-row">
        <button
          onClick={startSynthesis}
          className="btn-primary hsw-synth-btn"
          disabled={status === "running" || selectedProfiles.length === 0}
        >
          {status === "running"
            ? "⏳ Synthesizing… (poll every 1.5s)"
            : "🎺 Synthesize Horn System"}
        </button>
        {status === "running" && (
          <button onClick={stopPolling} className="btn-outline btn-sm">
            Cancel
          </button>
        )}
      </div>

      {/* ── Error ────────────────────────────────────────────── */}
      {status === "error" && errorMsg && (
        <div className="hsw-error">⚠ {errorMsg}</div>
      )}

      {/* ── Metrics ──────────────────────────────────────────── */}
      {status === "done" && result && (
        <div className="hsw-results">
          <div className="hsw-divider" />
          <h4 className="hsw-section-title">Synthesis Results</h4>

          <div className="hsw-metrics-grid">
            <MetricBadge label="Profile" value={result.horn.profile_type} />
            <MetricBadge label="Mean SPL" value={result.metrics.mean_spl_db} unit="dB" color="#f97316" />
            <MetricBadge label="Flatness" value={result.metrics.flatness_db} unit="dB" />
            <MetricBadge label="Bass deficit" value={result.metrics.bass_deficit_db} unit="dB" />
            <MetricBadge label="Cutoff (F12)" value={result.metrics.cost} unit="Hz" />
            <MetricBadge
              label="Excursion OK"
              value={result.metrics.excursion_ok ? "✅" : "❌"}
            />
            <MetricBadge label="Evaluations" value={result.metrics.n_evaluations} />
          </div>

          {/* Horn geometry summary */}
          <div className="hsw-horn-summary">
            <span>Throat: {(result.horn.throat_area * 1e4).toFixed(1)} cm²</span>
            <span>·</span>
            <span>Mouth: {(result.horn.mouth_area * 1e4).toFixed(1)} cm²</span>
            <span>·</span>
            <span>Path: {(result.horn.path_length * 100).toFixed(1)} cm</span>
            {result.horn.n_segments != null && (
              <>
                <span>·</span>
                <span>{result.horn.n_segments} segments</span>
              </>
            )}
          </div>

          {/* ── Acoustical Power Chart (Hornresp page 96) ───── */}
          {simResult && simResult.frequencies.length > 0 && (
            <div className="hsw-acoustical-power">
              <h4 className="hsw-section-title">Acoustical Power (Hornresp page 096)</h4>
              {simError && (
                <div className="hsw-sim-error">⚠ Simulation error: {simError}</div>
              )}
              {importedGain && importedGain.frequencies.length > 0 ? (
                <AcousticalPowerChartWithRoom simResult={simResult} importedGain={importedGain} />
              ) : (
                <AcousticalPowerChartSimple simResult={simResult} />
              )}
              {importedGain && importedGain.frequencies.length > 0 && (
                <div className="hsw-room-import-badge">
                  🏠 Room gain applied from: <em>{importedGain.filename}</em>
                  {simResult.room_gain_db && simResult.room_gain_db.length > 0 && (
                    <span> · theoretical room gain also shown</span>
                  )}
                </div>
              )}
            </div>
          )}
          {status === "done" && !simResult && !simError && (
            <div className="hsw-sim-loading">⏳ Loading acoustical power chart…</div>
          )}

          {/* YAML output */}
          <div className="hsw-yaml-output">
            <div className="hsw-yaml-header">
              <span>Generated YAML</span>
              <div className="hsw-yaml-actions">
                <button onClick={copyYaml} className="btn-outline btn-sm">
                  {copied ? "✅ Copied!" : "📋 Copy"}
                </button>
                {onLoadResult && (
                  <button onClick={loadIntoEditor} className="btn-outline btn-sm">
                    ➕ Load into Editor
                  </button>
                )}
              </div>
            </div>

            <div className="hsw-yaml-tabs">
              <div className="hsw-yaml-tab-label">Driver YAML</div>
              <pre className="hsw-yaml-snippet">{driverYaml}</pre>
              <div className="hsw-yaml-tab-label">Geometry YAML</div>
              <pre className="hsw-yaml-snippet">{geometryYaml}</pre>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .hsw { padding: 0; }
        .hsw-header { padding: 12px 16px 8px; }
        .hsw-header h3 { margin: 0 0 2px 0; font-size: 1em; color: #f97316; }
        .hsw-subtitle { margin: 0; font-size: 0.73em; color: #888; }

        .hsw-section { padding: 8px 16px 10px; }
        .hsw-section-title {
          margin: 0 0 8px 0; font-size: 0.78em; color: #aaa; font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.05em;
        }

        .hsw-divider { height: 1px; background: #2a2a3a; margin: 4px 0; }

        /* Frequency row */
        .hsw-freq-row {
          display: flex; gap: 16px; margin-bottom: 10px;
        }
        .hsw-freq-field {
          display: flex; flex-direction: column; gap: 3px; flex: 1;
        }
        .hsw-freq-field label { font-size: 0.72em; color: #00d4ff; font-family: monospace; }
        .hsw-freq-hint { font-size: 0.65em; color: #666; }
        .hsw-number-input {
          background: #1a1a2e; border: 1px solid #2a2a3a; border-radius: 4px;
          color: #eee; font-size: 0.82em; padding: 4px 8px; width: 100%;
          font-family: monospace;
        }

        /* Constraints */
        .hsw-constraints {
          display: flex; gap: 12px; margin-bottom: 10px;
        }
        .hsw-constraint-field {
          display: flex; flex-direction: column; gap: 3px; flex: 1;
        }
        .hsw-constraint-field label { font-size: 0.7em; color: #888; }
        .hsw-text-input {
          background: #1a1a2e; border: 1px solid #2a2a3a; border-radius: 4px;
          color: #eee; font-size: 0.8em; padding: 4px 8px; width: 100%;
          font-family: monospace;
        }

        /* Profile buttons */
        .hsw-profile-row {
          display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
        }
        .hsw-profile-label { font-size: 0.72em; color: #888; }
        .hsw-profile-btn {
          background: #1a1a2e; border: 1px solid #2a2a3a; border-radius: 4px;
          color: #888; font-size: 0.7em; padding: 3px 8px; cursor: pointer;
          transition: all 0.15s;
        }
        .hsw-profile-btn.active {
          background: #2a1f00; border-color: #f97316; color: #f97316;
        }
        .hsw-profile-btn:hover { border-color: #f9731666; }

        /* T-S param rows */
        .hsw-param-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 4px 6px; border-radius: 4px; background: #1a1a2e;
          border: 1px solid #2a2a3a; gap: 8px; margin-bottom: 4px;
        }
        .hsw-param-label { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
        .hsw-param-name { font-family: monospace; font-size: 0.82em; color: #f97316; font-weight: 600; }
        .hsw-param-hint { font-size: 0.65em; color: #777; }
        .hsw-param-control {
          display: flex; flex-direction: column; align-items: flex-end; gap: 2px;
          flex-shrink: 0; min-width: 130px;
        }
        .hsw-param-value { font-family: monospace; font-size: 0.8em; color: #eee; }
        .hsw-slider-track {
          position: relative; width: 120px; height: 4px;
          background: #2a2a3a; border-radius: 2px;
        }
        .hsw-slider-fill {
          position: absolute; left: 0; top: 0; height: 100%;
          background: #f97316; border-radius: 2px; pointer-events: none;
        }
        .hsw-slider {
          position: absolute; top: 50%; transform: translateY(-50%);
          left: 0; width: 100%; margin: 0; opacity: 0; cursor: pointer; height: 16px;
        }

        /* Action */
        .hsw-action-row { padding: 8px 16px 12px; display: flex; gap: 8px; align-items: center; }
        .hsw-synth-btn { flex: 1; }

        /* Error */
        .hsw-error {
          margin: 0 16px 10px; font-size: 0.78em; color: #f87171;
          background: #2a1010; border: 1px solid #f8717144;
          border-radius: 4px; padding: 6px 10px;
        }

        /* Results */
        .hsw-results { padding-bottom: 8px; }
        .hsw-metrics-grid {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
          gap: 6px; padding: 0 16px 10px;
        }
        .hsw-metric {
          background: #1a1a2e; border: 1px solid #2a2a3a; border-radius: 4px;
          padding: 6px 8px; border-left: 3px solid #00d4ff;
        }
        .hsw-metric-label { display: block; font-size: 0.65em; color: #888; text-transform: uppercase; }
        .hsw-metric-value { display: block; font-family: monospace; font-size: 0.85em; color: #eee; }
        .hsw-metric-unit { font-size: 0.75em; color: #888; }

        .hsw-horn-summary {
          display: flex; gap: 6px; flex-wrap: wrap;
          padding: 6px 16px; background: #1a1a2e; border-radius: 4px;
          margin: 0 16px 10px; font-family: monospace; font-size: 0.75em; color: #aaa;
        }

        /* YAML output */
        .hsw-yaml-output { padding: 0 16px; }
        .hsw-yaml-header {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 6px;
        }
        .hsw-yaml-header > span { font-size: 0.78em; color: #aaa; }
        .hsw-yaml-actions { display: flex; gap: 6px; }
        .hsw-yaml-tabs { display: flex; flex-direction: column; gap: 4px; }
        .hsw-yaml-tab-label { font-size: 0.68em; color: #888; text-transform: uppercase; }
        .hsw-yaml-snippet {
          background: #1a1a1a; border: 1px solid #333; border-radius: 4px;
          padding: 8px 10px; font-size: 0.72em; color: #86efac;
          overflow-x: auto; white-space: pre; margin: 0; max-height: 180px; overflow-y: auto;
        }

        /* Acoustical power chart */
        .hsw-acoustical-power { padding: 8px 16px 6px; }
        .hsw-sim-error {
          font-size: 0.72em; color: #f87171; background: rgba(239,68,68,0.1);
          border: 1px solid rgba(239,68,68,0.3); border-radius: 4px;
          padding: 6px 8px; margin-bottom: 6px;
        }
        .hsw-room-import-badge {
          font-size: 0.68em; color: #a78bfa; margin-top: 6px; text-align: center;
        }
        .hsw-room-import-badge em { color: #22c55e; font-style: normal; }
        .hsw-sim-loading { font-size: 0.72em; color: #888; padding: 6px 16px; }
      `}</style>
    </div>
  );
}
