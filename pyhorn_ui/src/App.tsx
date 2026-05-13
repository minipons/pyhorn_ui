import { useState, useEffect, useCallback, useRef } from "react";
import yaml from "js-yaml";

// API base: use relative URL (proxied in Vite dev) or absolute URL (Tauri/prod)
const API = import.meta.env.PROD
  ? (import.meta.env.VITE_API_URL ?? "http://localhost:8765")
  : "";
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
import { open } from "@tauri-apps/plugin-dialog";
import { SimulationResult } from "./types/simulation";
// @ts-ignore
import FrequencySampler, { SamplerState } from "./components/FrequencySampler";

// ── Result Memory / Baseline ─────────────────────────────────────────────────
export interface BaselineResult {
  id: string;
  name: string;
  createdAt: number;
  driverYaml: string;
  hornYaml: string;
  frequencies: number[];
  spl: number[];
  ib_spl: number[] | null;
  impedance: number[];
  excursion: number[];
  group_delay_ms: number[] | null;
  efficiency_pct: number[] | null;
}

const MAX_BASELINES = 4;
const LS_KEY = "pyhorn_baselines";

function loadBaselines(): BaselineResult[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveBaselines(baselines: BaselineResult[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(baselines));
  } catch { /* ignore */ }
}

import HornMetrics from "./components/HornMetrics";
import HornShape from "./components/HornShape";
import DirectivityPlot from "./components/DirectivityPlot";
import EfficiencyPanel from "./components/EfficiencyPanel";
import DriverPowerPanel from "./components/DriverPowerPanel";
import ConeAccelerationPanel from "./components/ConeAccelerationPanel";
import ConeVelocityPanel from "./components/ConeVelocityPanel";
import ParticleVelocityPanel from "./components/ParticleVelocityPanel";
import AcousticImpedancePanel from "./components/AcousticImpedancePanel";
import EditableHornSummary from "./components/EditableHornSummary";
import EditableDriverSummary from "./components/EditableDriverSummary";
import ErrorBoundary from "./components/ErrorBoundary";
import RegistryBrowser from "./components/RegistryBrowser";
import ThroatAdapterDesigner from "./components/ThroatAdapterDesigner";
import ChamberWizard from "./components/ChamberWizard";
import FilterWizard from "./components/FilterWizard";
import ResizeWizardPanel from "./components/ResizeWizardPanel";
import WidthAdjustment from "./components/WidthAdjustment";
import WavefrontViewer from "./components/WavefrontViewer";
import SpectrogramPanel from "./components/SpectrogramPanel";
import LossyLePanel from "./components/LossyLePanel";
import FDDModelPanel from "./components/FDDModelPanel";
import NotchFilterPanel from "./components/NotchFilterPanel";
import DampingMaterialPanel from "./components/DampingMaterialPanel";
import DiaphragmPressurePanel from "./components/DiaphragmPressurePanel";
import HornSynthesisWizard from "./components/HornSynthesisWizard";
import RoomGainPanel from "./components/RoomGainPanel";
import RoomGeneratorPanel from "./components/RoomGeneratorPanel";
import ChartTitle from "./components/ChartTitle";

const DRIVER_PRESETS: Record<string, string> = {
  "Fostex FE166NV2": `fs: 49.6
qts: 0.27
qes: 0.28
qms: 7.88
vas: 0.0369
re: 7.8
bl: 7.79
mms: 0.00699
cms: 0.001472
rms: 0.277
sd: 0.01327
le: 0.0008
xmax: 0.0015
voltage: 2.83`,
  "Dayton RS180-4": `fs: 41.8
qts: 0.46
qes: 0.49
qms: 6.5
vas: 0.0267
re: 3.6
bl: 5.9
mms: 0.0081
cms: 0.00152
rms: 0.28
sd: 0.0125
le: 0.00073
xmax: 0.0045
voltage: 2.83`,
  "Tango 7W": `fs: 36.0
qts: 0.30
qes: 0.31
qms: 5.6
vas: 0.042
re: 6.5
bl: 8.2
mms: 0.010
cms: 0.00195
rms: 0.32
sd: 0.014
le: 0.0012
xmax: 0.003
voltage: 2.83`,
};

const DEFAULT_DRIVER = `fs: 49.6
qts: 0.27
qes: 0.28
qms: 7.88
vas: 0.0369
re: 7.8
bl: 7.79
mms: 0.00699
cms: 0.001472
rms: 0.277
sd: 0.01327
le: 0.0008
xmax: 0.001
voltage: 2.83
`;

const DEFAULT_HORN = `ang: 1.5707963267948966
vrc: 0.0045
lrc: 0.1
vtc: 0.00016
atc: 0.008

profile_type: "hyperbolic"
n_segments: 50
throat_area: 0.008
mouth_area: 0.06
path_length: 1.5
hyperbolic_t: 0.3
`;

// Utility: compute cutoff frequency from horn YAML
function computeCutoffHz(hornYaml: string): number {
  function pf(yaml: string, key: string): number | null {
    const m = yaml.match(new RegExp(`^\\s*${key}\\s*:\\s*([\\d.e+-]+)`, "mi"));
    return m ? parseFloat(m[1]) : null;
  }
  function ps(yaml: string, key: string): string | null {
    const m = yaml.match(new RegExp(`^\\s*${key}\\s*:\\s*(.+)`, "mi"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
  }
  function solveHyperbolicU(t: number, target: number): number {
    if (target <= 0) return 0;
    if (t === 0) return Math.acosh(target);
    let u = Math.log(target);
    for (let i = 0; i < 50; i++) {
      const ch = Math.cosh(u), sh = Math.sinh(u);
      const f = ch + t * sh - target;
      const df = sh + t * ch;
      if (Math.abs(df) < 1e-15) break;
      const du = f / df;
      u -= du;
      if (Math.abs(du) < 1e-12) break;
    }
    return Math.max(0, u);
  }
  const ta = pf(hornYaml, "throat_area");
  const ma = pf(hornYaml, "mouth_area");
  const L = pf(hornYaml, "path_length");
  const pt = (ps(hornYaml, "profile_type") || "exponential").toLowerCase();
  const t = pf(hornYaml, "hyperbolic_t") ?? 0;
  if (ta == null || ma == null || L == null || L === 0) return 0;
  const PI = Math.PI;
  let m = 0;
  if (pt === "exponential" || pt === "parabolic") {
    m = (1 / L) * Math.log(ma / ta);
  } else if (pt === "hyperbolic") {
    m = solveHyperbolicU(t, Math.sqrt(ma / ta)) / L;
  }
  if (m <= 0 && pt !== "conical") return 0;
  if (pt === "hyperbolic") {
    return (m * 343) / (2 * PI);
  } else if (pt === "conical") {
    return 343 / (4 * PI * L);
  } else {
    return (m * 343) / (4 * PI);
  }
}

// Helper: build a SamplerState from a recharts click event
function buildSamplerState(
  data: { freq: number } | null,
  event: React.MouseEvent,
  result: SimulationResult
): SamplerState | null {
  if (!data) return null;
  const freq = data.freq;
  const freqIdx = result.freqs.reduce(
    (best, f, i) =>
      Math.abs(f - freq) < Math.abs(result.freqs[best] - freq) ? i : best,
    0
  );
  return { freq, freqIdx, x: event.clientX, y: event.clientY };
}

// ── Log-frequency X-axis tick values (standard audiophile decades) ─────────────
const LOG_TICK_VALUES = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

function fmtFreqTick(v: number): string {
  if (v >= 1000) {
    const k = v / 1000;
    return `${k === Math.round(k) ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `${Math.round(v)}`;
}

// Validate a YAML string; returns null if valid, error message string if invalid
function validateYaml(yamlText: string): string | null {
  if (!yamlText.trim()) return null; // empty is fine (runSimulation will handle missing fields)
  try {
    yaml.load(yamlText);
    return null;
  } catch (e: unknown) {
    return e instanceof Error ? e.message : "Invalid YAML";
  }
}

export default function App() {
  const [driverYaml, setDriverYaml] = useState(DEFAULT_DRIVER);
  const [hornYaml, setHornYaml] = useState(DEFAULT_HORN);
  const [driverYamlError, setDriverYamlError] = useState<string | null>(null);
  const [hornYamlError, setHornYamlError] = useState<string | null>(null);
  const [fmin, setFmin] = useState(10);
  const [fmax, setFmax] = useState(20000);
  const [nPoints, setNPoints] = useState(500);
  // Listening distance for finite horn-charged bass reflex phase offset (Hornresp p.091)
  const [pathLengthDiff, setPathLengthDiff] = useState(0);
  // Room gain params for /simulate
  const [roomGainEnabled, setRoomGainEnabled] = useState(false);
  const [roomGainType, setRoomGainType] = useState("half_space");
  const [roomGainDist, setRoomGainDist] = useState<number>(0.5);
  const [roomGainVolume, setRoomGainVolume] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [lastSimulatedAt, setLastSimulatedAt] = useState<Date | null>(null);
  const [showCrossSections, setShowCrossSections] = useState(false);
  const [driverExpanded, setDriverExpanded] = useState(false);
  const [hornExpanded, setHornExpanded] = useState(false);
  const [adapterExpanded, setAdapterExpanded] = useState(false);
  const [chamberWizardExpanded, setChamberWizardExpanded] = useState(true);
  const [filterExpanded, setFilterExpanded] = useState(false);
  const [resizeExpanded, setResizeExpanded] = useState(false);
  const [widthExpanded, setWidthExpanded] = useState(false);
  const [synthesisExpanded, setSynthesisExpanded] = useState(false);
  const [dampingExpanded, setDampingExpanded] = useState(false);
  const [roomGainExpanded, setRoomGainExpanded] = useState(false);
  const [roomGeneratorExpanded, setRoomGeneratorExpanded] = useState(false);
  const [importedRoomGain, setImportedRoomGain] = useState<{ frequencies: number[]; room_gain_db: number[]; filename: string } | null>(null);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [wavefrontOutputDir, setWavefrontOutputDir] = useState<string>("");
  // Result Memory / Baseline state
  const [baselines, setBaselines] = useState<BaselineResult[]>(() => loadBaselines());
  const [activeBaseline, setActiveBaseline] = useState<BaselineResult | null>(null);
  const [showBaselineOverlay, setShowBaselineOverlay] = useState(false);
  // Frequency Sampler state
  // @ts-ignore — used in JSX below
  const [samplerState, setSamplerState] = useState<SamplerState | null>(null);
  const [samplerVisible, setSamplerVisible] = useState(false);
  const [shortcutHelpVisible, setShortcutHelpVisible] = useState(false);

  const [filteredResult, setFilteredResult] = useState<{
    spl: number[];
    phase: number[];
    excursion: number[];
    impedance: number[];
    groupDelayMs: number[];
    gdPerPeriod: number[];
  } | null>(null);

  // Filter Wizard: toggle between filtered and unfiltered (baseline) SPL on main chart
  const [showFilteredSPL, setShowFilteredSPL] = useState(false);
  // Filter Wizard: overlay filtered SPL as a second line on the main SPL chart
  const [showFilteredOverlay, setShowFilteredOverlay] = useState(false);
  // Group delay display mode: "ms" (standard) or "per_period" (dimensionless = τ_g × f)
  const [groupDelayMode, setGroupDelayMode] = useState<"ms" | "per_period">("ms");
  // Notch filter params (suppress TMM artifact notches in SPL)
  const [notchFilterEnabled, setNotchFilterEnabled] = useState(false);
  const [notchFrequencies, setNotchFrequencies] = useState(""); // comma-separated Hz
  const [notchQ, setNotchQ] = useState(10.0);
  // FDD model params (Frequency Dependent Directivity — Hornresp pages 77, 92)
  const [fddEnabled, setFddEnabled] = useState(false);
  const [fddFc, setFddFc] = useState(300);
  const [fddDmax, setFddDmax] = useState(5.0);
  // Server connectivity: set to true when /health reports server is unreachable
  const [serverOffline, setServerOffline] = useState(false);

  // Ping /health on mount — set serverOffline banner if server is unreachable
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    fetch(`${API}/health`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) setServerOffline(true);
        else setServerOffline(false);
      })
      .catch(() => setServerOffline(true))
      .finally(() => clearTimeout(timeout));
  }, []);

  const pickFile = async (label: "driver" | "horn") => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "YAML", extensions: ["yaml", "yml"] }],
      });
      if (selected && typeof selected === "string") {
        const res = await fetch(`${API}/fs/read?path=${encodeURIComponent(selected)}`);
        if (!res.ok) {
          if (res.status === 404) {
            // Try to extract server's detail message for a friendly error
            const body = await res.json().catch(() => ({}));
            const detail = body?.detail ?? "File not found";
            throw new Error(`404 — ${detail}`);
          }
          throw new Error(`Failed to read file (HTTP ${res.status})`);
        }
        const data = await res.json();
        const { content: text, is_project_yaml: isProject } = data;

        if (label === "driver") {
          setDriverYaml(text);
        } else {
          // Server auto-resolves project YAML (geometry_path) → returns geometry YAML.
          // If server returned is_project_yaml: true, geometry was resolved successfully.
          // If not, the returned content is the raw file (could be project YAML with a
          // broken geometry_path, or a plain geometry YAML).
          // Validate: geometry YAML must have at least one known top-level key.
          const looksLikeProjectYaml =
            isProject === false &&
            (text.includes("geometry_path:") || text.includes("driver_yaml:"));

          if (looksLikeProjectYaml) {
            throw new Error(
              "The selected file is a project YAML but its geometry_path points to a " +
              "file that could not be loaded. Check that the geometry file exists."
            );
          }
          setHornYaml(text);
        }
      }
    } catch (e) {
      console.error("File picker error:", e);
      setError(e instanceof Error ? `Cannot load file: ${e.message}` : "Cannot load file — is the server running?");
    }
  };

  const runSimulation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Parse YAML strings into typed objects for manipulation
      const driver = yaml.load(driverYaml) as Record<string, unknown>;
      const horn = yaml.load(hornYaml) as Record<string, unknown>;

      // Inject listening distance for finite horn-charged bass reflex (Hornresp p.091)
      if (pathLengthDiff !== 0) {
        (horn as Record<string, unknown>).vented_box = {
          ...((horn as Record<string, unknown>).vented_box as Record<string, unknown> || {}),
          path_length_difference: pathLengthDiff,
        };
      }

      const res = await fetch(`${API}/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Send YAML strings (driver_config/horn_config) so the FastAPI server's
          // SimRequest can write them to temp files and call parse_driver_specs /
          // parse_horn_geometry. yaml.dump faithfully preserves all fields including
          // Lossy Le params (lossy_le, le_R_e_eddy, le_f_lossy_ref) added by
          // LossyLePanel.tsx.
          driver_config: yaml.dump(driver),
          horn_config: yaml.dump(horn),
          fmin,
          fmax,
          n_points: nPoints,
          off_axis_angles: [0, 15, 30, 45, 60, 75, 90],
          room_gain: roomGainEnabled,
          room_type: roomGainEnabled ? roomGainType : "free_space",
          distance_to_wall_m: roomGainEnabled && roomGainDist > 0 ? roomGainDist : undefined,
          room_volume_m3: roomGainEnabled ? roomGainVolume ?? undefined : undefined,
          filter_delay_mode: groupDelayMode === "per_period" ? "per_period" : "group_delay",
          notch_filter: notchFilterEnabled,
          notch_frequencies: notchFilterEnabled && notchFrequencies
            ? notchFrequencies.split(",").map((s) => parseFloat(s.trim())).filter((n) => !isNaN(n) && n > 0)
            : undefined,
          notch_q: notchFilterEnabled ? notchQ : undefined,
          fdd_mode: fddEnabled,
          fdd_fc: fddFc,
          fdd_dmax: fddDmax,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: null }));
        const msg = err.detail
          ? `Simulation error: ${res.status} ${res.statusText} — ${err.detail}`
          : `Simulation error: ${res.status} ${res.statusText}`;
        throw new Error(msg);
      }
      const data: SimulationResult = await res.json();
      setResult(data);
      setLastSimulatedAt(new Date());
    } catch (e: unknown) {
      // Distinguish network/connection errors (server unreachable) from HTTP errors and simulation failures
      const isNetworkError =
        e instanceof TypeError && (
          e.message.includes("Failed to fetch") ||
          e.message.includes("NetworkError") ||
          e.message.includes("Network request failed") ||
          e.message.includes("fetch") ||
          e.message.toLowerCase().includes("network")
        );
      const isSyntaxError =
        e instanceof SyntaxError;
      const isAbortError =
        e instanceof DOMException && e.name === "AbortError";
      if (isAbortError) {
        // Silently ignore — debounce cancelled a pending request; don't set error
      } else if (isNetworkError || isSyntaxError) {
        // Network failure (server unreachable, CORS blocked) or server returned
        // non-JSON (e.g. FastAPI HTML error page) — both mean connection problem.
        setError(
          "Cannot connect to pyhorn API server. Make sure the server is running " +
          "(`pyhorn api` or `python -m pyhorn_ui.server`) and accessible at the configured port."
        );
      } else {
        setError(e instanceof Error ? e.message : "Simulation failed");
      }
    } finally {
      setLoading(false);
    }
  }, [driverYaml, hornYaml, fmin, fmax, nPoints, pathLengthDiff, roomGainEnabled, roomGainType, roomGainDist, roomGainVolume, groupDelayMode, notchFilterEnabled, notchFrequencies, notchQ]);

  // Auto-simulate when parameters change (debounced 600ms)
  const autoSimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (autoSimTimerRef.current) clearTimeout(autoSimTimerRef.current);
    autoSimTimerRef.current = setTimeout(() => {
      runSimulation();
    }, 600);
    return () => { if (autoSimTimerRef.current) clearTimeout(autoSimTimerRef.current); };
  }, [runSimulation]);

  /** Immediate (non-debounced) simulation triggered by "Apply Notches" button */
  const applyNotchFilter = useCallback(() => {
    if (autoSimTimerRef.current) clearTimeout(autoSimTimerRef.current);
    runSimulation();
  }, [runSimulation]);

  const handleInsertAdapter = (ap1: number, lpt: number, profileType: string) => {
    // Add or update throat_adapter block in horn YAML
    const lines = hornYaml.split("\n");
    const adapterLines = [
      `throat_adapter:`,
      `  type: ${profileType}`,
      `  ap1: ${ap1}`,
      `  lpt: ${lpt}`,
    ];

    // Remove any existing throat_adapter block
    const filtered = lines.filter(
      (l) => !l.trim().startsWith("throat_adapter:") &&
             !l.trim().startsWith("ap1:") &&
             !l.trim().startsWith("lpt:") &&
             !l.trim().startsWith("type:")
    );

    // Insert after the last non-empty line or at the end
    const lastNonEmptyIdx = [...filtered].reverse().findIndex((l) => l.trim() !== "");
    const insertIdx = lastNonEmptyIdx === -1 ? filtered.length : filtered.length - 1 - lastNonEmptyIdx + 1;

    const newYaml = [
      ...filtered.slice(0, insertIdx),
      ...adapterLines,
      "",
      ...filtered.slice(insertIdx),
    ].join("\n");

    setHornYaml(newYaml);
  };

  const downloadCSV = async () => {
    if (!result) return;
    const hasFilter = filteredResult !== null;
    const header = hasFilter
      ? "Frequency (Hz),SPL (dB),Phase (deg),Impedance (Ohms),Filtered SPL (dB),Filtered Phase (deg),Filtered Impedance (Ohms)"
      : "Frequency (Hz),SPL (dB),Phase (deg),Impedance (Ohms)";
    const rows = result.freqs.map((f: number, i: number) => {
      const phaseDeg = result.phase_degrees?.[i] ?? 0;
      const baseline = `${f},${result.spl[i].toFixed(4)},${phaseDeg.toFixed(4)},${result.impedance[i].toFixed(4)}`;
      if (hasFilter) {
        const fr = filteredResult;
        return `${baseline},${fr.spl[i].toFixed(4)},${fr.phase[i].toFixed(4)},${fr.impedance[i].toFixed(4)}`;
      }
      return baseline;
    });
    const csv = [header, ...rows].join("\n");

    if (typeof window !== "undefined") {
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = hasFilter ? "response_filtered.csv" : "response.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const downloadJSON = async () => {
    if (!result) return;
    const hasFilter = filteredResult !== null;
    const payload: Record<string, unknown> = {
      frequencies: result.freqs,
      spl: result.spl,
      phase: result.phase_degrees ?? result.freqs.map(() => 0),
      impedance: result.impedance,
    };
    if (hasFilter) {
      payload.filtered_spl = filteredResult.spl;
      payload.filtered_phase = filteredResult.phase;
      payload.filtered_impedance = filteredResult.impedance;
    }

    if (typeof window !== "undefined") {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = hasFilter ? "response_filtered.json" : "response.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const downloadFRD = async () => {
    if (!result) return;
    const hasFilter = filteredResult !== null;
    const freqs = result.freqs;
    const spl = hasFilter ? filteredResult.spl : result.spl;
    const phaseDeg = hasFilter
      ? filteredResult.phase
      : (result.phase_degrees ?? freqs.map(() => 0));

    const lines = ["!FRD1.0", "Frequency(Hz)  Magnitude(dB)  Phase(deg)"];
    for (let i = 0; i < freqs.length; i++) {
      lines.push(`${freqs[i].toFixed(4)}  ${spl[i].toFixed(4)}  ${(phaseDeg[i] ?? 0).toFixed(4)}`);
    }
    const frd = lines.join("\n") + "\n";

    if (typeof window !== "undefined") {
      const blob = new Blob([frd], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = hasFilter ? "response_filtered.frd" : "response.frd";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  // ── Result Memory / Baseline ───────────────────────────────────────────────
  const saveAsBaseline = useCallback(() => {
    if (!result) return;
    const entry: BaselineResult = {
      id: Date.now().toString(),
      name: new Date().toLocaleTimeString(),
      createdAt: Date.now(),
      driverYaml,
      hornYaml,
      frequencies: result.freqs,
      spl: result.spl,
      ib_spl: result.ib_spl ?? null,
      impedance: result.impedance,
      excursion: result.excursion,
      group_delay_ms: result.group_delay_ms ?? null,
      efficiency_pct: result.efficiency_pct ?? null,
    };
    setBaselines((prev) => {
      const next = [entry, ...prev].slice(0, MAX_BASELINES);
      saveBaselines(next);
      return next;
    });
  }, [result, driverYaml, hornYaml]);

  const deleteBaseline = useCallback((id: string) => {
    setBaselines((prev) => {
      const next = prev.filter((b) => b.id !== id);
      saveBaselines(next);
      return next;
    });
    setActiveBaseline((b) => (b?.id === id ? null : b));
  }, []);

  const loadBaseline = useCallback((b: BaselineResult) => {
    setActiveBaseline(b);
    setShowBaselineOverlay(true);
  }, []);

  const toggleOverlay = useCallback(() => {
    setShowBaselineOverlay((v) => !v);
  }, []);

  // Frequency Sampler chart click handler — cast to any to satisfy recharts CategoricalChartFunc
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleChartClick = useCallback(
    (data: unknown, _index: unknown, event: React.MouseEvent) => {
      if (!result) return;
      const entry = data as { freq: number } | null;
      if (!entry) return;
      const state = buildSamplerState(entry, event, result);
      if (!state) return;
      setSamplerState(state);
      setSamplerVisible(true);
    },
    [result]
  ) as any;

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const inInput = tag === "TEXTAREA" || tag === "INPUT";
      // Ctrl+C → capture current result as baseline
      if (e.ctrlKey && e.key === "c" && !inInput && result) {
        e.preventDefault();
        saveAsBaseline();
      }
      // Ctrl+B → toggle baseline overlay
      if (e.ctrlKey && e.key === "b" && !inInput) {
        e.preventDefault();
        toggleOverlay();
      }
      // F3 or d → toggle Frequency Sampler (when result exists)
      if (
        (e.key === "F3" || e.key === "d" || e.key === "D") &&
        !inInput &&
        result
      ) {
        if (e.key === "F3") e.preventDefault();
        if (!samplerVisible) {
          // Activate sampler at center of viewport
          setSamplerState({
            freq: result.freqs[Math.floor(result.freqs.length / 2)],
            freqIdx: Math.floor(result.freqs.length / 2),
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          });
        }
        setSamplerVisible((v) => !v);
      }
      // Escape → close sampler or shortcut help
      if (e.key === "Escape") {
        if (shortcutHelpVisible) {
          setShortcutHelpVisible(false);
        } else if (samplerVisible) {
          setSamplerVisible(false);
          setSamplerState(null);
        }
      }
      // ? → toggle keyboard shortcut help (when not in input)
      if (e.key === "?" && !inInput) {
        setShortcutHelpVisible((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [result, saveAsBaseline, toggleOverlay, samplerVisible, shortcutHelpVisible]);

  const chartData = result
    ? result.freqs.map((f: number, i: number) => {
        let baseline_spl: number | null = null;
        if (showBaselineOverlay && activeBaseline) {
          // Interpolate baseline SPL at this frequency
          const idx = activeBaseline.frequencies.findIndex((ff, ii) =>
            ii > 0 && ff >= f && activeBaseline.frequencies[ii - 1] <= f
          );
          if (idx === -1) {
            baseline_spl = activeBaseline.spl[activeBaseline.spl.length - 1];
          } else if (idx === 0) {
            baseline_spl = activeBaseline.spl[0];
          } else {
            const t = (f - activeBaseline.frequencies[idx - 1]) /
              (activeBaseline.frequencies[idx] - activeBaseline.frequencies[idx - 1]);
            baseline_spl = activeBaseline.spl[idx - 1] +
              t * (activeBaseline.spl[idx] - activeBaseline.spl[idx - 1]);
          }
        }
        return {
          freq: f,
          // When overlay is active, spl always shows baseline so both lines are visible
          spl: showFilteredOverlay && filteredResult
            ? result.spl[i]
            : (showFilteredSPL && filteredResult ? filteredResult.spl[i] : result.spl[i]),
          filtered_spl: filteredResult ? filteredResult.spl[i] : null,
          ib_spl: result.ib_spl?.[i] ?? null,
          baseline_spl,
          impedance: result.impedance[i],
          excursion: result.excursion[i],
          group_delay: result.group_delay_ms?.[i] ?? null,
          // per-period = group_delay_seconds × frequency_hz (dimensionless, Hornresp "Delay" option)
          // Prefer server-computed value; fall back to client-side computation
          group_delay_per_period: result.group_delay_per_period?.[i] != null
            ? result.group_delay_per_period[i]
            : result.group_delay_ms?.[i] != null
              ? (result.group_delay_ms[i] / 1000) * f
              : null,
          // Futtrup audible group-delay limit (Hornresp page 113):
          // GDlimit = 1000 × 1160.6 / (5643 × f^0.81511 − f) ms
          // Clamps to 0 where formula gives negative (very low frequencies)
          futtrup_gdlimit: Math.max(0, 1000 * 1160.6 / (5643 * Math.pow(f, 0.81511) - f)),
          // 1/f reference line: group delay = 1/f seconds = 1000/f ms (Hornresp page 71)
          // This is the theoretical minimum group delay for a system with linear phase
          one_over_f_gd: 1000 / f,
          efficiency_pct: result.efficiency_pct?.[i] ?? null,
          electrical_input_power: result.electrical_input_power?.[i] ?? null,
          cone_velocity: result.cone_velocity?.[i] ?? null,
          cone_acceleration: result.cone_acceleration?.[i] ?? null,
          diaphragm_pressure_total: result.diaphragm_pressure_total?.[i] ?? null,
          diaphragm_pressure_horn_side: result.diaphragm_pressure_horn_side?.[i] ?? null,
          diaphragm_pressure_direct_side: result.diaphragm_pressure_direct_side?.[i] ?? null,
          particle_velocity_throat: result.particle_velocity_throat?.[i] ?? null,
          particle_velocity_mouth: result.particle_velocity_mouth?.[i] ?? null,
          particle_velocity_port: result.particle_velocity_port?.[i] ?? null,
          // Notch-filtered SPL: artifact notches suppressed (null when notch filter disabled)
          spl_notched: result.spl_notched?.[i] ?? null,
        };
      })
    : [];

  const fc = computeCutoffHz(hornYaml);
  const fcRounded = Math.round(fc);
  const showFcLine = fc > 0 && fcRounded >= fmin && fcRounded <= fmax;

  return (
    <ErrorBoundary>
    <div className="app">
      <header className="app-header">
        <h1>🎺 pyhorn</h1>
        <p>Horn loudspeaker simulator — Hornresp in Python</p>
        {result && (
          <span style={{ marginLeft: "auto", fontSize: "11px", color: "var(--text2)" }}>
            Click any chart or press F3 / d to sample · Esc to close
          </span>
        )}
      </header>

      {serverOffline && (
        <div className="server-offline-banner">
          ⚠ Server offline — <strong>start it with:</strong> <code>cd pyhorn_ui && python server.py</code>
          <button
            className="banner-retry"
            onClick={() => {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 4000);
              fetch(`${API}/health`, { signal: controller.signal })
                .then((res) => { if (res.ok) setServerOffline(false); })
                .catch(() => {})
                .finally(() => clearTimeout(timeout));
            }}
          >
            Retry
          </button>
        </div>
      )}

      <div className="layout">
        <aside className="sidebar">
          <RegistryBrowser
            driverYaml={driverYaml}
            hornYaml={hornYaml}
            onLoadDriver={(yaml) => setDriverYaml(yaml)}
            onLoadHorn={(yaml) => setHornYaml(yaml)}
          />

          <details className="panel" open={driverExpanded} onToggle={(e) => setDriverExpanded((e.target as HTMLDetailsElement).open)}>
            <summary className="yaml-summary">
              <span>Driver YAML</span>
              <span className="yaml-summary-badge">{driverExpanded ? "↑ collapse" : "↓ expand"}</span>
            </summary>
            <div className="yaml-body">
              <div className="file-row">
                <button onClick={() => pickFile("driver")} className="btn-outline">
                  📂 Load file
                </button>
              </div>
              <textarea
                value={driverYaml}
                onChange={(e) => {
                  setDriverYaml(e.target.value);
                  setDriverYamlError(validateYaml(e.target.value));
                }}
                spellCheck={false}
              />
              {driverYamlError && (
                <div className="yaml-error">⚠ Driver YAML: {driverYamlError}</div>
              )}
            </div>
          </details>

          <details className="panel" open={hornExpanded} onToggle={(e) => setHornExpanded((e.target as HTMLDetailsElement).open)}>
            <summary className="yaml-summary">
              <span>Horn YAML</span>
              <span className="yaml-summary-badge">{hornExpanded ? "↑ collapse" : "↓ expand"}</span>
            </summary>
            <div className="yaml-body">
              <div className="file-row">
                <button onClick={() => pickFile("horn")} className="btn-outline">
                  📂 Load file
                </button>
              </div>
              <textarea
                value={hornYaml}
                onChange={(e) => {
                  setHornYaml(e.target.value);
                  setHornYamlError(validateYaml(e.target.value));
                }}
                spellCheck={false}
              />
              {hornYamlError && (
                <div className="yaml-error">⚠ Horn YAML: {hornYamlError}</div>
              )}
            </div>
          </details>

          <section className="panel">
            <div className="panel-header-row">
              <h2>Driver Parameters</h2>
              <div className="presets-wrapper">
                <button
                  className="btn-outline presets-btn"
                  onClick={() => setPresetsOpen((v) => !v)}
                >
                  + Presets
                </button>
                {presetsOpen && (
                  <div className="presets-dropdown">
                    {Object.entries(DRIVER_PRESETS).map(([name, yaml]) => (
                      <button
                        key={name}
                        className="presets-dropdown-item"
                        onClick={() => {
                          setDriverYaml(yaml);
                          setPresetsOpen(false);
                        }}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <EditableDriverSummary
              driverYaml={driverYaml}
              onDriverYamlChange={setDriverYaml}
            />
            <LossyLePanel
              driverYaml={driverYaml}
              onDriverYamlChange={setDriverYaml}
            />
          </section>

          <section className="panel">
            <h2>Horn Parameters</h2>
            <HornMetrics hornYaml={hornYaml} />
            <EditableHornSummary
              hornYaml={hornYaml}
              driverYaml={driverYaml}
              onHornYamlChange={setHornYaml}
            />
            {/* Hyperbolic T parameter slider */}
            {(() => {
              function pf(text: string, key: string): number | null {
                const m = text.match(new RegExp(`^\\s*${key}\\s*:\\s*([\\d.e+-]+)`, "mi"));
                return m ? parseFloat(m[1]) : null;
              }
              function sf(text: string, key: string, value: number): string {
                const lines = text.split("\n");
                let found = false;
                const next = lines.map((line) => {
                  const idx = line.indexOf("#");
                  const clean = idx >= 0 ? line.slice(0, idx) : line;
                  const re = new RegExp(`^(\\s*${key}:\\s*)([0-9eE.+\\-]+)`);
                  const m = clean.match(re);
                  if (m) { found = true; return `${m[1]}${value}`; }
                  return line;
                });
                if (!found) return text.trimEnd() + `\n${key}: ${value}`;
                return next.join("\n");
              }
              const tVal = pf(hornYaml, "hyperbolic_t") ?? 0.5;
              return (
                <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                    <span style={{ fontSize: "11px", color: "var(--text2)" }}>
                      T (flare)
                      <span style={{ marginLeft: "4px", fontSize: "10px", color: "var(--text2)", opacity: 0.7 }}>
                        (0=Conical · 0.5=BLH · 1=Exp.)
                      </span>
                    </span>
                    <span style={{ fontSize: "11px", color: "var(--accent)", fontFamily: "monospace" }}>
                      {tVal.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={tVal}
                    onChange={(e) => setHornYaml(sf(hornYaml, "hyperbolic_t", parseFloat(e.target.value)))}
                    style={{ width: "100%", accentColor: "var(--accent)", cursor: "pointer" }}
                  />
                </div>
              );
            })()}
          </section>

          <button
            onClick={runSimulation}
            disabled={loading}
            className="btn-primary run-btn"
          >
            {loading ? "⏳ Simulating…" : "▶ Run Simulation"}
          </button>

          {error && <div className="error-box">⚠ {error}</div>}

          <section className="panel">
            <h2>Simulation Range</h2>
            <div className="param-grid">
              <label>
                fmin (Hz)
                <input
                  type="number"
                  value={fmin}
                  onChange={(e) => setFmin(Number(e.target.value))}
                />
              </label>
              <label>
                fmax (Hz)
                <input
                  type="number"
                  value={fmax}
                  onChange={(e) => setFmax(Number(e.target.value))}
                />
              </label>
              <label>
                Points
                <input
                  type="number"
                  value={nPoints}
                  onChange={(e) => setNPoints(Number(e.target.value))}
                />
              </label>
              <label title="Listening distance for finite horn-charged bass reflex phase offset (Hornresp p.091)">
                📏 Listen Dist (m)
                <input
                  type="number"
                  min={0}
                  max={20}
                  step={0.1}
                  value={pathLengthDiff}
                  onChange={(e) => setPathLengthDiff(Number(e.target.value))}
                />
              </label>
            </div>
          </section>

          {/* Room gain simulation params */}
          <details className="panel">
            <summary className="yaml-summary">
              <span>🏠 Room Gain in Simulation</span>
            </summary>
            <div style={{ padding: "6px 0" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", cursor: "pointer", marginBottom: "8px" }}>
                <input
                  type="checkbox"
                  checked={roomGainEnabled}
                  onChange={(e) => setRoomGainEnabled(e.target.checked)}
                  style={{ accentColor: "var(--accent)" }}
                />
                <span>Apply room boundary gain to SPL simulation</span>
              </label>
              {roomGainEnabled && (
                <>
                  <label style={{ fontSize: "11px", color: "var(--text2)", display: "block", marginBottom: "4px" }}>
                    Room type
                  </label>
                  <select
                    value={roomGainType}
                    onChange={(e) => setRoomGainType(e.target.value)}
                    style={{
                      width: "100%",
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      borderRadius: "4px",
                      color: "var(--text)",
                      padding: "4px 6px",
                      fontSize: "12px",
                      marginBottom: "8px",
                    }}
                  >
                    <option value="free_space">Free space (0 dB)</option>
                    <option value="half_space">Half space (+3 dB)</option>
                    <option value="quarter_space">Quarter space (+6 dB)</option>
                    <option value="eighth_space">Eighth space (+9 dB)</option>
                  </select>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <div>
                      <label style={{ fontSize: "11px", color: "var(--text2)", display: "block", marginBottom: "4px" }}>
                        📏 Dist to wall (m)
                      </label>
                      <input
                        type="number"
                        value={roomGainDist}
                        min={0.05}
                        max={20}
                        step={0.05}
                        onChange={(e) => setRoomGainDist(Number(e.target.value))}
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
                    </div>
                    <div>
                      <label style={{ fontSize: "11px", color: "var(--text2)", display: "block", marginBottom: "4px" }}>
                        📦 Room volume (m³)
                      </label>
                      <input
                        type="number"
                        value={roomGainVolume ?? ""}
                        placeholder="optional"
                        min={1}
                        max={1000}
                        step={1}
                        onChange={(e) => setRoomGainVolume(e.target.value ? Number(e.target.value) : null)}
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
                    </div>
                  </div>
                </>
              )}
            </div>
          </details>

          <details className="panel" open={synthesisExpanded} onToggle={(e) => setSynthesisExpanded((e.target as HTMLDetailsElement).open)}>
            <summary className="yaml-summary">
              <span>🎺 Horn System Synthesis Wizard</span>
              <span className="yaml-summary-badge">{synthesisExpanded ? "↑ collapse" : "↓ expand"}</span>
            </summary>
            <HornSynthesisWizard
              importedGain={importedRoomGain}
              initialDriverYaml={driverYaml}
              onLoadResult={(geometryYaml, driverYamlStr) => {
                setHornYaml(geometryYaml);
                setDriverYaml(driverYamlStr);
                // Collapse the synthesis wizard and expand the editors
                setSynthesisExpanded(false);
                setHornExpanded(true);
                setDriverExpanded(true);
              }}
            />
          </details>

          <details className="panel" open={chamberWizardExpanded} onToggle={(e) => setChamberWizardExpanded((e.target as HTMLDetailsElement).open)}>
            <summary className="yaml-summary">
              <span>🎛 Chamber Design Wizard</span>
              <span className="yaml-summary-badge">{chamberWizardExpanded ? "↑ collapse" : "↓ expand"}</span>
            </summary>
            <ChamberWizard
              driverYaml={driverYaml}
              hornYaml={hornYaml}
              onApplyToProject={(snippet) => {
                // Append the chamber snippet to the horn YAML
                setHornYaml((prev) => {
                  // Remove any existing rear_chamber / throat_chamber / throat_adapter blocks
                  const lines = prev.split("\n");
                  const filtered = lines.filter(
                    (l) =>
                      !l.trim().startsWith("rear_chamber:") &&
                      !l.trim().startsWith("vrc:") &&
                      !l.trim().startsWith("lrc:") &&
                      !l.trim().startsWith("throat_chamber:") &&
                      !l.trim().startsWith("vtc:") &&
                      !l.trim().startsWith("atc:") &&
                      !l.trim().startsWith("throat_adapter:") &&
                      !l.trim().startsWith("ap1:") &&
                      !l.trim().startsWith("lpt:")
                  );
                  return filtered.join("\n") + "\n" + snippet;
                });
              }}
            />
          </details>

          <details className="panel" open={adapterExpanded} onToggle={(e) => setAdapterExpanded((e.target as HTMLDetailsElement).open)}>
            <summary className="yaml-summary">
              <span>Throat Adapter Designer</span>
              <span className="yaml-summary-badge">{adapterExpanded ? "↑ collapse" : "↓ expand"}</span>
            </summary>
            <ThroatAdapterDesigner onInsertAdapter={handleInsertAdapter} />
          </details>

          <details className="panel" open={widthExpanded} onToggle={(e) => setWidthExpanded((e.target as HTMLDetailsElement).open)}>
            <summary className="yaml-summary">
              <span>Width Adjustment</span>
              <span className="yaml-summary-badge">{widthExpanded ? "↑ collapse" : "↓ expand"}</span>
            </summary>
            <WidthAdjustment
              initialGeometryYaml={hornYaml}
              onLoadAdjusted={(geoYaml) => {
                setHornYaml(geoYaml);
                setWidthExpanded(false);
              }}
            />
          </details>

          <details className="panel" open={dampingExpanded} onToggle={(e) => setDampingExpanded((e.target as HTMLDetailsElement).open)}>
            <summary className="yaml-summary">
              <span>🎭 Segment Damping Material</span>
              <span className="yaml-summary-badge">{dampingExpanded ? "↑ collapse" : "↓ expand"}</span>
            </summary>
            <DampingMaterialPanel
              hornYaml={hornYaml}
              onHornYamlChange={setHornYaml}
            />
          </details>

          <details className="panel" open={roomGainExpanded} onToggle={(e) => setRoomGainExpanded((e.target as HTMLDetailsElement).open)}>
            <summary className="yaml-summary">
              <span>🏠 Room Gain Calculator</span>
              <span className="yaml-summary-badge">{roomGainExpanded ? "↑ collapse" : "↓ expand"}</span>
            </summary>
            <RoomGainPanel />
          </details>

          <details className="panel" open={roomGeneratorExpanded} onToggle={(e) => setRoomGeneratorExpanded((e.target as HTMLDetailsElement).open)}>
            <summary className="yaml-summary">
              <span>🏠 Room Generator</span>
              <span className="yaml-summary-badge">{roomGeneratorExpanded ? "↑ collapse" : "↓ expand"}</span>
            </summary>
            <RoomGeneratorPanel
              importedGain={importedRoomGain}
              onImport={setImportedRoomGain}
            />
          </details>

          <details className="panel" open={resizeExpanded} onToggle={(e) => setResizeExpanded((e.target as HTMLDetailsElement).open)}>
            <summary className="yaml-summary">
              <span>Resize Wizard</span>
              <span className="yaml-summary-badge">{resizeExpanded ? "↑ collapse" : "↓ expand"}</span>
            </summary>
            <ResizeWizardPanel
              initialGeometryYaml={hornYaml}
              initialDriverYaml={driverYaml}
              onLoadResized={(geoYaml, drvYaml) => {
                setHornYaml(geoYaml);
                setDriverYaml(drvYaml);
                setResizeExpanded(false);
              }}
            />
          </details>

          {/* Notch Filter Panel — suppress TMM artifact notches in SPL */}
          <details className="panel">
            <summary className="yaml-summary">
              <span>🎯 Notch Filter</span>
              <span className="yaml-summary-badge">
                {notchFilterEnabled && notchFrequencies ? "ON" : "OFF"}
              </span>
            </summary>
            <NotchFilterPanel
              enabled={notchFilterEnabled}
              onEnabledChange={setNotchFilterEnabled}
              frequencies={notchFrequencies}
              onFrequenciesChange={setNotchFrequencies}
              q={notchQ}
              onQChange={setNotchQ}
              onApply={applyNotchFilter}
              disabled={loading || !result}
            />
          </details>

          {/* FDD Model Panel — Frequency Dependent Directivity (Hornresp pages 77, 92) */}
          <details className="panel">
            <summary className="yaml-summary">
              <span>📡 FDD Model</span>
              <span className="yaml-summary-badge">
                {fddEnabled ? "ON" : "OFF"}
              </span>
            </summary>
            <FDDModelPanel
              enabled={fddEnabled}
              onEnabledChange={setFddEnabled}
              fc={fddFc}
              onFcChange={setFddFc}
              dmax={fddDmax}
              onDmaxChange={setFddDmax}
            />
          </details>

          <details className="panel" open={filterExpanded} onToggle={(e) => setFilterExpanded((e.target as HTMLDetailsElement).open)}>
            <summary className="yaml-summary">
              <span>Filter Wizard</span>
              <span className="yaml-summary-badge">{filterExpanded ? "↑ collapse" : "↓ expand"}</span>
            </summary>
            {result && (
              <FilterWizard
                frequencies={result.freqs}
                baselineSpl={result.spl}
                excursion={result.excursion}
                impedance={result.impedance}
                groupDelayMs={result.group_delay_ms ?? result.spl.map(() => 0)}
                groupDelayPerPeriod={result.group_delay_per_period ?? result.freqs.map((f, i) => ((result.group_delay_ms?.[i] ?? 0) / 1000) * f)}
                onFilteredResult={(f) => setFilteredResult(f)}
                onToggleOverlay={(show) => {
                  setShowFilteredOverlay(show);
                  if (show) setShowFilteredSPL(false);
                }}
                overlayVisible={showFilteredOverlay}
              />
            )}
            {!result && (
              <p className="placeholder" style={{ padding: "0.5rem", fontSize: "0.85rem" }}>
                Run a simulation first to enable the Filter Wizard
              </p>
            )}
          </details>

          {result && (
            <section className="panel">
              <h2>Export</h2>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button onClick={downloadCSV} className="btn-outline">
                  📥 CSV
                </button>
                <button onClick={downloadJSON} className="btn-outline">
                  📥 JSON
                </button>
                <button onClick={downloadFRD} className="btn-outline">
                  📥 FRD
                </button>
              </div>
              {filteredResult && (
                <p style={{ fontSize: "11px", color: "var(--text2)", marginTop: "4px" }}>
                  Includes filtered response
                </p>
              )}
            </section>
          )}

          {/* Wavefront Viewer */}
          <WavefrontViewer
            outputDir={wavefrontOutputDir || null}
            onOutputDirChange={setWavefrontOutputDir}
            geometryYaml={hornYaml}
            onGeometryChange={setHornYaml}
          />

          {/* Spectrogram Panel */}
          <section className="panel">
            <SpectrogramPanel result={result} />
          </section>

          {/* Result Memory / Baseline Comparison */}
          <section className="panel">
            <div className="panel-header-row">
              <h2 style={{ marginBottom: 0 }}>📋 Baselines ({baselines.length}/{MAX_BASELINES})</h2>
            </div>

            <div style={{ display: "flex", gap: "6px", marginBottom: "8px", flexWrap: "wrap" }}>
              <button
                onClick={saveAsBaseline}
                disabled={!result}
                className="btn-outline"
                title="Ctrl+C to capture current result"
                style={{ fontSize: "11px", padding: "4px 10px" }}
              >
                💾 Save Baseline
              </button>
              {activeBaseline && (
                <button
                  onClick={toggleOverlay}
                  className="btn-outline"
                  style={{ fontSize: "11px", padding: "4px 10px" }}
                >
                  {showBaselineOverlay ? "🙈 Hide Overlay" : "👁 Show Overlay"}
                </button>
              )}
            </div>

            {result && (
              <p style={{ fontSize: "10px", color: "var(--text2)", marginBottom: "8px" }}>
                Ctrl+C = save · Ctrl+B = toggle overlay
              </p>
            )}

            {baselines.length === 0 ? (
              <p style={{ fontSize: "11px", color: "var(--text2)", fontStyle: "italic" }}>
                No baselines saved yet. Run a simulation and save.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {baselines.map((b) => (
                  <div
                    key={b.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      padding: "4px 6px",
                      borderRadius: "4px",
                      border: activeBaseline?.id === b.id ? "1px solid var(--accent)" : "1px solid var(--border)",
                      background: activeBaseline?.id === b.id ? "rgba(0,212,255,0.06)" : undefined,
                    }}
                  >
                    <button
                      onClick={() => loadBaseline(b)}
                      className="btn-outline"
                      style={{ flex: 1, fontSize: "11px", padding: "3px 6px", textAlign: "left" }}
                    >
                      {b.name}
                    </button>
                    <button
                      onClick={() => deleteBaseline(b.id)}
                      className="btn-outline"
                      style={{ fontSize: "11px", padding: "3px 7px", color: "#ef4444", borderColor: "#ef4444" }}
                      title="Delete baseline"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>

        <div className="plots-area">
          {lastSimulatedAt && (
            <div style={{
              fontSize: "11px",
              color: "var(--text2)",
              textAlign: "right",
              padding: "2px 8px 0",
              fontFamily: "monospace",
              opacity: 0.7,
            }}>
              last simulated {lastSimulatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </div>
          )}
          <div className="panel plot-panel">
            <ChartTitle title="SPL Frequency Response" />
            {result ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartData} onClick={handleChartClick}>
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
                  <YAxis stroke="#aaa" fontSize={11} />
                  <Tooltip
                    formatter={(v: number, name: string) => [`${v.toFixed(2)}`, name]}
                    contentStyle={{ background: "#1e1e1e", border: "1px solid #444" }}
                  />
                  <Legend />
                  {showFcLine && (
                    <ReferenceLine
                      x={fcRounded}
                      stroke="#e3b341"
                      strokeDasharray="5 5"
                      strokeWidth={1.5}
                      label={{ value: `fc: ${fcRounded} Hz`, fill: "#e3b341", fontSize: 11, position: "insideTopRight" }}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="spl"
                    stroke="#00d4ff"
                    dot={false}
                    name="Horn SPL (dB)"
                    strokeWidth={1.5}
                  />
                  {result.ib_spl && (
                    <Line
                      type="monotone"
                      dataKey="ib_spl"
                      stroke="#888"
                      dot={false}
                      name="Infinite Baffle"
                      strokeWidth={1}
                      strokeDasharray="4 4"
                    />
                  )}
                  {showBaselineOverlay && activeBaseline && (
                    <Line
                      type="monotone"
                      dataKey="baseline_spl"
                      stroke="#aaaaaa"
                      dot={false}
                      name={`Baseline: ${activeBaseline.name}`}
                      strokeWidth={1.5}
                      strokeDasharray="6 3"
                    />
                  )}
                  {showFilteredOverlay && filteredResult && (
                    <Line
                      type="monotone"
                      dataKey="filtered_spl"
                      stroke="#ff4488"
                      dot={false}
                      name="Filtered SPL"
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                    />
                  )}
                  {result?.spl_notched && (
                    <Line
                      type="monotone"
                      dataKey="spl_notched"
                      stroke="#f97316"
                      dot={false}
                      name="Notched SPL"
                      strokeWidth={1.5}
                      strokeDasharray="8 4"
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="placeholder">Run a simulation to see SPL response</div>
            )}
          </div>

          <div className="panel plot-panel">
            <ChartTitle title="Impedance" />
            {result ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} onClick={handleChartClick}>
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
                  <YAxis stroke="#aaa" fontSize={11} />
                  <Tooltip
                    formatter={(v: number) => [`${v.toFixed(2)} Ω`, "Impedance"]}
                    contentStyle={{ background: "#1e1e1e", border: "1px solid #444" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="impedance"
                    stroke="#ff7b00"
                    dot={false}
                    name="Impedance (Ω)"
                    strokeWidth={1.5}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="placeholder">Run a simulation to see impedance</div>
            )}
          </div>

          <div className="panel plot-panel" style={{ gridColumn: "1 / 3" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <ChartTitle title="Horn Profile" />
              <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={showCrossSections}
                  onChange={(e) => setShowCrossSections(e.target.checked)}
                />
                Cross-sections (every 10 cm)
              </label>
            </div>
            <HornShape
              hornYaml={hornYaml}
              driverYaml={driverYaml}
              resultAvailable={result !== null}
              showCrossSections={showCrossSections}
            />
          </div>

          <div className="panel plot-panel">
            <ChartTitle title="Throat Acoustic Impedance" />
            <AcousticImpedancePanel result={result} />
          </div>

          <div className="panel plot-panel">
            <ChartTitle title="Driver Excursion" />
            {result ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} onClick={handleChartClick}>
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
                  <YAxis stroke="#aaa" fontSize={11} />
                  <Tooltip
                    formatter={(v: number) => [`${v.toFixed(4)} mm`, "Excursion"]}
                    contentStyle={{ background: "#1e1e1e", border: "1px solid #444" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="excursion"
                    stroke="#a855f7"
                    dot={false}
                    name="Excursion (mm)"
                    strokeWidth={1.5}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="placeholder">Run a simulation to see excursion</div>
            )}
          </div>

          <div className="panel plot-panel">
            <ChartTitle title="Cone Velocity" />
            {result ? (
              <ConeVelocityPanel
                chartData={chartData as Array<{ freq: number; cone_velocity: number | null }>}
                fmin={fmin}
                fmax={fmax}
                onChartClick={handleChartClick}
              />
            ) : (
              <div className="placeholder">Run a simulation to see cone velocity</div>
            )}
          </div>

          <div className="panel plot-panel">
            <ChartTitle title="Particle Velocity" />
            {result ? (
              <ParticleVelocityPanel
                chartData={
                  chartData as Array<{
                    freq: number;
                    particle_velocity_throat: number | null;
                    particle_velocity_mouth: number | null;
                    particle_velocity_port: number | null;
                  }>
                }
                fmin={fmin}
                fmax={fmax}
                onChartClick={handleChartClick}
              />
            ) : (
              <div className="placeholder">Run a simulation to see particle velocity</div>
            )}
          </div>

          <div className="panel plot-panel">
            <ChartTitle title="Cone Acceleration" />
            {result ? (
              <ConeAccelerationPanel
                chartData={chartData as Array<{ freq: number; cone_acceleration: number | null }>}
                fmin={fmin}
                fmax={fmax}
                onChartClick={handleChartClick}
              />
            ) : (
              <div className="placeholder">Run a simulation to see cone acceleration</div>
            )}
          </div>

          <div className="panel plot-panel">
            <ChartTitle title="Diaphragm Pressure" />
            {result ? (
              <DiaphragmPressurePanel
                chartData={
                  chartData as Array<{
                    freq: number;
                    diaphragm_pressure_total: number | null;
                    diaphragm_pressure_horn_side: number | null;
                    diaphragm_pressure_direct_side: number | null;
                  }>
                }
                fmin={fmin}
                fmax={fmax}
                onChartClick={handleChartClick}
              />
            ) : (
              <div className="placeholder">Run a simulation to see diaphragm pressure</div>
            )}
          </div>

          <div className="panel plot-panel">
            <ChartTitle title="Directivity — Polar Pattern & Beamwidth" />
            <DirectivityPlot
              hornYaml={hornYaml}
              resultAvailable={result !== null}
              offAxisSpl={result?.off_axis_spl ?? null}
              radiationAngle={result?.radiation_angle ?? null}
              directionIndex={result?.direction_index ?? null}
            />
          </div>

          <div className="panel plot-panel">
            <ChartTitle title="System Efficiency" />
            {result?.efficiency_pct ? (
              <EfficiencyPanel chartData={chartData} fmin={fmin} fmax={fmax} onChartClick={handleChartClick} />
            ) : (
              <div className="placeholder">Run a simulation to see system efficiency</div>
            )}
          </div>

          <div className="panel plot-panel">
            <ChartTitle title="Driver Power" />
            {result && result.electrical_input_power ? (
              <DriverPowerPanel chartData={chartData as Array<{ freq: number; electrical_input_power: number | null }>} fmin={fmin} fmax={fmax} onChartClick={handleChartClick} />
            ) : (
              <div className="placeholder">Run a simulation to see driver power</div>
            )}
          </div>

          <div className="panel plot-panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <ChartTitle title="Group Delay" style={{ margin: 0 }} />
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px" }}>
                <span style={{ color: "var(--text2)" }}>Display:</span>
                <div style={{ display: "flex", background: "var(--bg2)", borderRadius: "6px", padding: "2px" }}>
                  <button
                    style={{
                      background: groupDelayMode === "ms" ? "var(--accent)" : "transparent",
                      color: groupDelayMode === "ms" ? "#000" : "var(--text2)",
                      border: "none",
                      borderRadius: "4px",
                      padding: "2px 10px",
                      cursor: "pointer",
                      fontSize: "11px",
                      fontWeight: 600,
                    }}
                    onClick={() => setGroupDelayMode("ms")}
                  >
                    ms
                  </button>
                  <button
                    style={{
                      background: groupDelayMode === "per_period" ? "var(--accent)" : "transparent",
                      color: groupDelayMode === "per_period" ? "#000" : "var(--text2)",
                      border: "none",
                      borderRadius: "4px",
                      padding: "2px 10px",
                      cursor: "pointer",
                      fontSize: "11px",
                      fontWeight: 600,
                    }}
                    onClick={() => setGroupDelayMode("per_period")}
                    title="τ_g × f = group delay × frequency (per-wavelength units)"
                  >
                    τ_g × f
                  </button>
                </div>
              </div>
            </div>
            {groupDelayMode === "per_period" && (
              <p style={{ fontSize: "10px", color: "var(--text2)", margin: "0 0 6px 0" }}>
                τ_g × f = group delay × frequency · dimensionless (per-wavelength units)
              </p>
            )}
            {result?.group_delay_ms ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} onClick={handleChartClick}>
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
                    label={{
                      value: groupDelayMode === "per_period" ? "τ_g × f (dimensionless)" : "Group Delay (ms)",
                      angle: -90,
                      position: "insideLeft",
                      fill: "#aaa",
                      fontSize: 10,
                    }}
                  />
                  <Tooltip
                    formatter={(v: number) => [
                      groupDelayMode === "per_period"
                        ? `${v.toFixed(4)} (dimensionless)`
                        : `${v.toFixed(3)} ms`,
                      groupDelayMode === "per_period" ? "τ_g × f" : "Group Delay",
                    ]}
                    contentStyle={{ background: "#1e1e1e", border: "1px solid #444" }}
                  />
                  {groupDelayMode === "ms" && (
                    <Line
                      type="monotone"
                      dataKey="futtrup_gdlimit"
                      stroke="#f85149"
                      strokeDasharray="5 5"
                      strokeWidth={1.5}
                      dot={false}
                      name="Futtrup audible limit (ms)"
                      legendType="none"
                    />
                  )}
                  {groupDelayMode === "ms" && (
                    <Line
                      type="monotone"
                      dataKey="one_over_f_gd"
                      stroke="#22c55e"
                      strokeDasharray="5 5"
                      strokeWidth={1.5}
                      dot={false}
                      name="1/f reference (ms)"
                      legendType="none"
                    />
                  )}
                  {groupDelayMode === "per_period" && (
                    <ReferenceLine
                      y={1}
                      stroke="#22c55e"
                      strokeDasharray="5 5"
                      strokeWidth={1.5}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey={groupDelayMode === "per_period" ? "group_delay_per_period" : "group_delay"}
                    stroke="#22c55e"
                    dot={false}
                    name={groupDelayMode === "per_period" ? "τ_g × f" : "Group Delay (ms)"}
                    strokeWidth={1.5}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="placeholder">Run a simulation to see group delay</div>
            )}
          </div>

          {filteredResult && result && (
            <div className="panel plot-panel">
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                <ChartTitle title="Filtered SPL — Difference vs Baseline" style={{ margin: 0 }} />
                {showFilteredOverlay ? (
                  <span style={{ fontSize: "11px", color: "var(--accent)", background: "rgba(0,212,255,0.1)", padding: "2px 8px", borderRadius: "4px" }}>
                    Overlay active on main chart
                  </span>
                ) : (
                  <button
                    className="btn-outline btn-sm"
                    onClick={() => setShowFilteredSPL((v) => !v)}
                    title={showFilteredSPL ? "Showing filtered SPL — click to show unfiltered baseline" : "Showing unfiltered baseline — click to show filtered SPL"}
                  >
                    {showFilteredSPL ? "👁 Showing: Filtered" : "👁 Showing: Baseline"}
                  </button>
                )}
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart
                  data={result.freqs.map((f: number, i: number) => ({
                    freq: f,
                    baseline: result.spl[i],
                    filtered: filteredResult.spl[i],
                    diff: filteredResult.spl[i] - result.spl[i],
                  }))}
                >
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
                  <YAxis stroke="#aaa" fontSize={11} />
                  <Tooltip
                    formatter={(v: number, name: string) => [`${v.toFixed(2)} dB`, name]}
                    contentStyle={{ background: "#1e1e1e", border: "1px solid #444" }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="baseline"
                    stroke="#00d4ff"
                    dot={false}
                    name="Baseline SPL"
                    strokeWidth={1}
                    strokeDasharray="4 4"
                  />
                  <Line
                    type="monotone"
                    dataKey="filtered"
                    stroke="#ff4488"
                    dot={false}
                    name="Filtered SPL"
                    strokeWidth={1.5}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {filteredResult && result && (() => {
            const diffs = result.freqs.map((_f: number, i: number) =>
              filteredResult.spl[i] - result.spl[i]
            );
            const maxAbs = Math.max(...diffs.map(Math.abs), 3);
            const chartData = result.freqs.map((f: number, i: number) => ({
              freq: f,
              diff: diffs[i],
            }));

            const exportFilteredResponse = () => {
              const header = "Frequency (Hz),SPL (dB),Phase (deg),Group Delay (ms),Impedance (Ohms)";
              const rows = result.freqs.map((f: number, i: number) =>
                [
                  f,
                  filteredResult.spl[i].toFixed(4),
                  filteredResult.phase[i].toFixed(4),
                  filteredResult.groupDelayMs[i].toFixed(4),
                  filteredResult.impedance[i].toFixed(4),
                ].join(",")
              );
              const csv = [header, ...rows].join("\n");
              const blob = new Blob([csv], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "filtered_response.csv";
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            };

            const exportDelta = () => {
              const header = "Frequency (Hz),Delta SPL (dB)";
              const rows = result.freqs.map((f: number, i: number) =>
                [f, diffs[i].toFixed(4)].join(",")
              );
              const csv = [header, ...rows].join("\n");
              const blob = new Blob([csv], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "filter_delta.csv";
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            };

            return (
              <div className="panel plot-panel">
                <ChartTitle title="Filter Delta (filtered − baseline)" />
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart
                    data={chartData}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                    <XAxis
                      dataKey="freq"
                      type="number"
                      scale="log"
                      ticks={LOG_TICK_VALUES}
                    domain={[fmin, fmax]}
                      tickFormatter={(v) => {
                        if (v >= 1000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
                        return `${Math.round(v)}`;
                      }}
                      stroke="#aaa"
                      fontSize={11}
                    />
                    <YAxis
                      stroke="#aaa"
                      fontSize={11}
                      domain={[-maxAbs * 1.2, maxAbs * 1.2]}
                      tickFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`}
                    />
                    <Tooltip
                      formatter={(v: number) => [`${v >= 0 ? "+" : ""}${v.toFixed(2)} dB`, "Delta"]}
                      contentStyle={{ background: "#1e1e1e", border: "1px solid #444" }}
                      labelFormatter={(v) => `${Number(v).toFixed(0)} Hz`}
                    />
                    <ReferenceLine y={0} stroke="#e3b341" strokeWidth={1.5} strokeDasharray="4 2" />
                    <Line
                      type="monotone"
                      dataKey="diff"
                      stroke="#22c55e"
                      dot={false}
                      name="Filter delta"
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
                <p style={{ fontSize: "11px", color: "var(--text2)", margin: "4px 0 0" }}>
                  Green = filtering louder than baseline
                  {diffs.some((d) => d > 0) && " · Max boost: "}
                  {diffs.some((d) => d > 0) && (
                    <strong style={{ color: "#22c55e" }}>
                      +{Math.max(...diffs).toFixed(1)} dB
                    </strong>
                  )}
                  {diffs.some((d) => d < 0) && " · Max cut: "}
                  {diffs.some((d) => d < 0) && (
                    <strong style={{ color: "#f85149" }}>
                      {Math.min(...diffs).toFixed(1)} dB
                    </strong>
                  )}
                  {" · "}
                  <button onClick={exportFilteredResponse} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "11px", padding: "0" }}>Export Filtered Response</button>
                  {" · "}
                  <button onClick={exportDelta} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "11px", padding: "0" }}>Export Delta</button>
                </p>
              </div>
            );
          })()}

          {/* Baseline vs Current Difference Panel */}
          {activeBaseline && result && (() => {
            const diffs = result.freqs.map((f: number, i: number) => {
              const idx = activeBaseline.frequencies.findIndex((ff, ii) =>
                ii > 0 && ff >= f && activeBaseline.frequencies[ii - 1] <= f
              );
              let base: number;
              if (idx === -1) {
                base = activeBaseline.spl[activeBaseline.spl.length - 1];
              } else if (idx === 0) {
                base = activeBaseline.spl[0];
              } else {
                const t = (f - activeBaseline.frequencies[idx - 1]) /
                  (activeBaseline.frequencies[idx] - activeBaseline.frequencies[idx - 1]);
                base = activeBaseline.spl[idx - 1] +
                  t * (activeBaseline.spl[idx] - activeBaseline.spl[idx - 1]);
              }
              return result.spl[i] - base;
            });
            const maxAbs = Math.max(...diffs.map(Math.abs), 0.5);
            const diffChartData = result.freqs.map((f: number, i: number) => ({
              freq: f,
              diff: diffs[i],
            }));
            const rmsDiff = Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / diffs.length);
            return (
              <div className="panel plot-panel" style={{ gridColumn: "1 / 3" }}>
                <ChartTitle title="Baseline vs Current — Difference (current − baseline)" />
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={diffChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                    <XAxis
                      dataKey="freq"
                      type="number"
                      scale="log"
                      ticks={LOG_TICK_VALUES}
                    domain={[fmin, fmax]}
                      tickFormatter={(v) => {
                        if (v >= 1000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
                        return `${Math.round(v)}`;
                      }}
                      stroke="#aaa"
                      fontSize={11}
                    />
                    <YAxis
                      stroke="#aaa"
                      fontSize={11}
                      domain={[-maxAbs * 1.2, maxAbs * 1.2]}
                      tickFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`}
                    />
                    <Tooltip
                      formatter={(v: number) => [`${v >= 0 ? "+" : ""}${v.toFixed(2)} dB`, "Delta"]}
                      contentStyle={{ background: "#1e1e1e", border: "1px solid #444" }}
                      labelFormatter={(v) => `${Number(v).toFixed(0)} Hz`}
                    />
                    <ReferenceLine y={0} stroke="#e3b341" strokeWidth={1.5} strokeDasharray="4 2" />
                    <Line
                      type="monotone"
                      dataKey="diff"
                      stroke="#e3b341"
                      dot={false}
                      name="Δ SPL (dB)"
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
                <p style={{ fontSize: "11px", color: "var(--text2)", marginTop: "4px" }}>
                  Baseline: <strong style={{ color: "var(--text)" }}>{activeBaseline.name}</strong>
                  {" · "}RMS difference: <strong style={{ color: "#e3b341" }}>±{rmsDiff.toFixed(2)} dB</strong>
                  {diffs.some((d) => d > 0) && " · Max louder: "}
                  {diffs.some((d) => d > 0) && (
                    <strong style={{ color: "#22c55e" }}>
                      +{Math.max(...diffs).toFixed(1)} dB
                    </strong>
                  )}
                  {diffs.some((d) => d < 0) && " · Max quieter: "}
                  {diffs.some((d) => d < 0) && (
                    <strong style={{ color: "#f85149" }}>
                      {Math.min(...diffs).toFixed(1)} dB
                    </strong>
                  )}
                  {" · "}
                  <button
                    onClick={toggleOverlay}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--accent)",
                      cursor: "pointer",
                      fontSize: "11px",
                      padding: "0",
                    }}
                  >
                    {showBaselineOverlay ? "Hide overlay" : "Show overlay"}
                  </button>
                </p>
              </div>
            );
          })()}

        {/* Frequency Sampling Tool */}
        {result && samplerVisible && samplerState && (
          <FrequencySampler
            result={result}
            driverYaml={driverYaml}
            hornYaml={hornYaml}
            samplerState={samplerState}
            onClose={() => {
              setSamplerVisible(false);
              setSamplerState(null);
            }}
          />
        )}

        {/* Keyboard Shortcut Help */}
        {shortcutHelpVisible && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
            }}
            onClick={() => setShortcutHelpVisible(false)}
          >
            <div
              style={{
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "24px 32px",
                minWidth: 320,
                maxWidth: 480,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h3 style={{ margin: 0, color: "var(--text-primary)" }}>⌨ Keyboard Shortcuts</h3>
                <button
                  onClick={() => setShortcutHelpVisible(false)}
                  style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 18 }}
                >
                  ✕
                </button>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {[
                    ["?", "Show / hide this help"],
                    ["Ctrl+C", "Save current result as baseline"],
                    ["Ctrl+B", "Toggle baseline overlay"],
                    ["D", "Toggle frequency sampler (when result exists)"],
                    ["F3", "Toggle frequency sampler (when result exists)"],
                    ["Esc", "Close sampler or this help"],
                  ].map(([key, desc]) => (
                    <tr key={key} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 0", paddingRight: 16 }}>
                        <kbd style={{
                          background: "var(--bg-input)",
                          border: "1px solid var(--border)",
                          borderRadius: 4,
                          padding: "2px 8px",
                          fontFamily: "monospace",
                          fontSize: 13,
                          color: "var(--accent)",
                        }}>{key}</kbd>
                      </td>
                      <td style={{ padding: "8px 0", color: "var(--text-secondary)", fontSize: 13 }}>{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
    </ErrorBoundary>
  );
}
