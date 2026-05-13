import { useState, useCallback, useEffect } from "react";

// ─── Le Cléac'h Crossover Schematic (ASCII) ─────────────────────────────────
// 2nd-order (12 dB/oct) acoustic crossover topology by André Le Cléac'h.
// Reference: audible group-delay limit ≈ 5 ms (Claus Futtrup).
const SCHEMATIC_ASCII = `
 Le Cléac'h Crossover — 2nd Order (12 dB/oct)
 ─────────────────────────────────────────────
 Input ──┬──L──┬──►──┬──►──┬──►── Woofer
         │     │     │     │
         C     │    [LP]   │
               │           │
         ◄─────┴───────────┘
         (low-pass section)

 Input ──┬──C──┬──►──┬──►──┬──►── Tweeter
         │     │     │     │
         L     │    [HP]   │
               │           │
         ◄─────┴───────────┘
         (high-pass section)

 Components (2nd-order Butterworth target):
   LP:  L = Rl / (2π·fc)    C = 1 / (2π·fc·Rl)
   HP:  C = 1 / (2π·fc·Rt)  L = Rt / (2π·fc)

 Where: Rl = woofer Z@fc, Rt = tweeter Z@fc, fc = crossover freq
`.trim();

export type FilterType = "lowpass" | "highpass" | "bandpass" | "peakingEQ" | "highshelf" | "lowshelf" | "le_cleach";

export interface FilterBand {
  enabled: boolean;
  type: FilterType;
  frequency: number; // Hz
  q: number;
  gain_db: number; // dB
  order: number; // 1=6dB/oct, 2=12dB/oct, 3=18dB/oct, 4=24dB/oct
}

export interface FilterPreset {
  name: string;
  bands: FilterBand[];
}

export interface FilterWizardProps {
  frequencies: number[];
  baselineSpl: number[];
  excursion: number[];
  impedance: number[];
  groupDelayMs: number[];
  /** Group delay per period (dimensionless = τ_g × f), one value per frequency. */
  groupDelayPerPeriod?: number[];
  onFilteredResult: (filtered: {
    spl: number[];
    phase: number[];
    excursion: number[];
    impedance: number[];
    groupDelayMs: number[];
    gdPerPeriod: number[];
  }) => void;
  /** Called when the user wants to show/hide filtered SPL on the main chart */
  onToggleOverlay?: (show: boolean) => void;
  overlayVisible?: boolean;
}

const FILTER_TYPES: { value: FilterType; label: string }[] = [
  { value: "lowpass", label: "Low-pass" },
  { value: "highpass", label: "High-pass" },
  { value: "bandpass", label: "Band-pass" },
  { value: "peakingEQ", label: "Peaking EQ" },
  { value: "highshelf", label: "High-shelf" },
  { value: "lowshelf", label: "Low-shelf" },
  { value: "le_cleach", label: "Le Cléac'h HP" },
];

const DEFAULT_BAND = (): FilterBand => ({
  enabled: false,
  type: "peakingEQ",
  frequency: 1000,
  q: 1.0,
  gain_db: 0,
  order: 2,
});

const STORAGE_KEY = "pyhorn_filter_presets";
const MAX_PRESETS = 4;

function loadPresets(): FilterPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

function savePresetsToStorage(presets: FilterPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // localStorage unavailable or quota exceeded — silently skip
  }
}

export default function FilterWizard({
  frequencies,
  baselineSpl,
  impedance,
  groupDelayMs,
  groupDelayPerPeriod,
  onFilteredResult,
  onToggleOverlay,
  overlayVisible = false,
}: FilterWizardProps) {
  const [bands, setBands] = useState<FilterBand[]>([
    DEFAULT_BAND(),
    DEFAULT_BAND(),
    DEFAULT_BAND(),
    DEFAULT_BAND(),
  ]);
  const [filterApplied, setFilterApplied] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterMagDb, setFilterMagDb] = useState<number[] | null>(null);
  // Group delay display mode: "ms" (standard) or "per_period" (dimensionless = τ_g × f)
  const [delayDisplayMode, setDelayDisplayMode] = useState<"ms" | "per_period">("ms");

  // Preset state
  const [presets, setPresets] = useState<FilterPreset[]>(loadPresets);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [presetName, setPresetName] = useState("");

  // Schematic toggle
  const [showSchematic, setShowSchematic] = useState(false);

  // Persist presets whenever they change
  useEffect(() => {
    savePresetsToStorage(presets);
  }, [presets]);

  const updateBand = useCallback((idx: number, patch: Partial<FilterBand>) => {
    setBands((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
    setFilterApplied(false);
    setFilterMagDb(null);
  }, []);

  const savePreset = useCallback(() => {
    const name = presetName.trim();
    if (!name) return;
    if (presets.length >= MAX_PRESETS) return; // shouldn't happen with UI guard
    const newPreset: FilterPreset = { name, bands: bands.map((b) => ({ ...b })) };
    setPresets((prev) => [...prev, newPreset]);
    setPresetName("");
    setShowSaveDialog(false);
  }, [presetName, bands, presets.length]);

  const loadPreset = useCallback(
    (preset: FilterPreset) => {
      // Map saved bands to current band slots (up to 4)
      const newBands = [
        DEFAULT_BAND(),
        DEFAULT_BAND(),
        DEFAULT_BAND(),
        DEFAULT_BAND(),
      ];
      preset.bands.slice(0, 4).forEach((b, i) => {
        newBands[i] = { ...b };
      });
      setBands(newBands);
      setFilterApplied(false);
      setFilterMagDb(null);
    },
    []
  );

  const deletePreset = useCallback((idx: number) => {
    setPresets((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const applyFilters = useCallback(async () => {
    setLocalError(null);
    const enabledBands = bands.filter((b) => b.enabled);
    if (enabledBands.length === 0) {
      setLocalError("Enable at least one filter band");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("http://localhost:8765/filter/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          frequencies,
          baseline_spl: baselineSpl,
          baseline_impedance: impedance,
          baseline_phase: frequencies.map(() => 0), // phase not available in result — use 0
          filter_bands: enabledBands.map(({ enabled, ...rest }) => rest),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setFilterMagDb(data.filter_magnitude_db ?? []);
      setFilterApplied(true);
      onFilteredResult({
        spl: data.filtered_spl,
        phase: data.filtered_phase,
        excursion: frequencies.map(() => 0), // not computed server-side
        impedance: data.filtered_impedance,
        groupDelayMs: frequencies.map(() => 0), // not computed server-side
        gdPerPeriod: frequencies.map(() => 0), // not computed server-side
      });
    } catch (e: unknown) {
      setLocalError(e instanceof Error ? e.message : "Filter application failed");
    } finally {
      setLoading(false);
    }
  }, [bands, frequencies, baselineSpl, impedance, onFilteredResult]);

  const clearFilters = useCallback(() => {
    setBands([DEFAULT_BAND(), DEFAULT_BAND(), DEFAULT_BAND(), DEFAULT_BAND()]);
    setFilterApplied(false);
    setFilterMagDb(null);
    setLocalError(null);
    onFilteredResult({
      spl: baselineSpl,
      phase: frequencies.map(() => 0),
      excursion: frequencies.map(() => 0),
      impedance,
      groupDelayMs: groupDelayMs,
      gdPerPeriod: groupDelayPerPeriod ?? frequencies.map((f, i) => (groupDelayMs[i] / 1000) * f),
    });
  }, [baselineSpl, impedance, frequencies, groupDelayMs, groupDelayPerPeriod, onFilteredResult]);

  const presetsFull = presets.length >= MAX_PRESETS;

  return (
    <div className="filter-wizard">
      {/* Preset Memory Section */}
      <div className="preset-section">
        <div className="preset-header">
          <span className="preset-title">Presets ({presets.length}/{MAX_PRESETS})</span>
          {!showSaveDialog && (
            <button
              className="btn-outline btn-sm"
              onClick={() => setShowSaveDialog(true)}
              disabled={presetsFull}
              title={presetsFull ? "All preset slots full" : "Save current bands as preset"}
            >
              💾 Save Preset
            </button>
          )}
        </div>

        {showSaveDialog && (
          <div className="preset-save-dialog">
            <input
              type="text"
              className="preset-name-input"
              placeholder="Preset name…"
              value={presetName}
              maxLength={24}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") savePreset();
                if (e.key === "Escape") {
                  setShowSaveDialog(false);
                  setPresetName("");
                }
              }}
              autoFocus
            />
            <button
              className="btn-primary btn-sm"
              onClick={savePreset}
              disabled={!presetName.trim()}
            >
              Save
            </button>
            <button
              className="btn-outline btn-sm"
              onClick={() => {
                setShowSaveDialog(false);
                setPresetName("");
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {presets.length === 0 && !showSaveDialog && (
          <p className="preset-empty">No presets saved yet.</p>
        )}

        {presets.length > 0 && (
          <div className="preset-list">
            {presets.map((p, idx) => (
              <div key={idx} className="preset-item">
                <button
                  className="preset-load-btn"
                  onClick={() => loadPreset(p)}
                  title="Load this preset"
                >
                  {p.name}
                </button>
                <button
                  className="preset-delete-btn"
                  onClick={() => deletePreset(idx)}
                  title="Delete preset"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <hr className="filter-divider" />

      {/* Le Cléac'h Schematic */}
      <div className="schematic-section">
        <button
          className="btn-outline btn-sm"
          onClick={() => setShowSchematic((v) => !v)}
          title="Toggle crossover schematic"
          style={{ fontFamily: "monospace" }}
        >
          {showSchematic ? "▼" : "▶"} Le Cléac'h Crossover Schematic
        </button>
        {showSchematic && (
          <pre className="schematic-art">{SCHEMATIC_ASCII}</pre>
        )}
      </div>

      <hr className="filter-divider" />

      {/* Delay Display Mode Toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
        <span style={{ fontSize: "12px", color: "var(--text2)" }}>Delay Display:</span>
        <div style={{ display: "flex", background: "var(--bg2)", borderRadius: "6px", padding: "2px" }}>
          <button
            style={{
              background: delayDisplayMode === "ms" ? "var(--accent)" : "transparent",
              color: delayDisplayMode === "ms" ? "#000" : "var(--text2)",
              border: "none",
              borderRadius: "4px",
              padding: "2px 10px",
              cursor: "pointer",
              fontSize: "11px",
              fontWeight: 600,
            }}
            onClick={() => setDelayDisplayMode("ms")}
            title="Group delay in milliseconds"
          >
            ms
          </button>
          <button
            style={{
              background: delayDisplayMode === "per_period" ? "var(--accent)" : "transparent",
              color: delayDisplayMode === "per_period" ? "#000" : "var(--text2)",
              border: "none",
              borderRadius: "4px",
              padding: "2px 10px",
              cursor: "pointer",
              fontSize: "11px",
              fontWeight: 600,
            }}
            onClick={() => setDelayDisplayMode("per_period")}
            title="τ_g × f — group delay normalised by signal period (dimensionless)"
          >
            τ·f
          </button>
        </div>
        {delayDisplayMode === "per_period" && (
          <span style={{ fontSize: "10px", color: "var(--text2)" }}>(dimensionless)</span>
        )}
      </div>

      {/* Filter Bands Section */}
      <div className="filter-bands">
        {bands.map((band, idx) => (
          <div
            key={idx}
            className={`filter-band-row ${band.enabled ? "enabled" : "disabled"}`}
          >
            <label className="band-toggle">
              <input
                type="checkbox"
                checked={band.enabled}
                onChange={(e) => updateBand(idx, { enabled: e.target.checked })}
              />
              <span>Band {idx + 1}</span>
            </label>

            {band.enabled && (
              <div className="band-controls">
                <div className="band-control">
                  <span className="ctrl-label">Type</span>
                  <select
                    value={band.type}
                    onChange={(e) =>
                      updateBand(idx, { type: e.target.value as FilterType })
                    }
                  >
                    {FILTER_TYPES.map((ft) => (
                      <option key={ft.value} value={ft.value}>
                        {ft.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="band-control">
                  <span className="ctrl-label">Freq (Hz)</span>
                  <input
                    type="number"
                    value={band.frequency}
                    min={1}
                    max={20000}
                    step={band.type === "highpass" || band.type === "lowpass" ? 10 : 1}
                    onChange={(e) =>
                      updateBand(idx, { frequency: parseFloat(e.target.value) || 1 })
                    }
                  />
                </div>

                <div className="band-control">
                  <span className="ctrl-label">Q</span>
                  <input
                    type="number"
                    value={band.q}
                    min={0.01}
                    max={20}
                    step={0.01}
                    onChange={(e) =>
                      updateBand(idx, { q: parseFloat(e.target.value) || 0.1 })
                    }
                  />
                </div>

                <div className="band-control">
                  <span className="ctrl-label">Gain (dB)</span>
                  <input
                    type="number"
                    value={band.gain_db}
                    min={-24}
                    max={24}
                    step={0.5}
                    onChange={(e) =>
                      updateBand(idx, { gain_db: parseFloat(e.target.value) || 0 })
                    }
                  />
                </div>

                <div className="band-control">
                  <span className="ctrl-label">Order</span>
                  <select
                    value={band.order}
                    onChange={(e) =>
                      updateBand(idx, { order: parseInt(e.target.value) })
                    }
                  >
                    <option value={1}>1st (6 dB/oct)</option>
                    <option value={2}>2nd (12 dB/oct)</option>
                    <option value={3}>3rd (18 dB/oct)</option>
                    <option value={4}>4th (24 dB/oct)</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {localError && <div className="error-box">{localError}</div>}

      <div className="filter-actions">
        <button
          onClick={applyFilters}
          className="btn-primary"
          disabled={loading || filterApplied}
        >
          {loading ? "⏳ Applying…" : filterApplied ? "✓ Applied" : "⚙ Apply Filters"}
        </button>
        <button onClick={clearFilters} className="btn-outline">
          Clear
        </button>
        {filterApplied && onToggleOverlay && (
          <button
            onClick={() => onToggleOverlay(!overlayVisible)}
            className={`btn-outline ${overlayVisible ? "btn-active" : ""}`}
            title={overlayVisible ? "Hide filtered SPL overlay on main chart" : "Show filtered SPL overlay on main chart"}
          >
            {overlayVisible ? "🙈 Hide Overlay" : "👁 Overlay on SPL"}
          </button>
        )}
      </div>

      {filterApplied && filterMagDb && (
        <p className="filter-summary" style={{ fontSize: "11px", color: "var(--text2)", marginTop: "6px" }}>
          Max filter gain:{" "}
          <strong style={{ color: "var(--accent)" }}>
            {Math.max(...filterMagDb).toFixed(1)} dB
          </strong>{" "}
          · Min:{" "}
          <strong style={{ color: "var(--accent)" }}>
            {Math.min(...filterMagDb).toFixed(1)} dB
          </strong>
        </p>
      )}
    </div>
  );
}
