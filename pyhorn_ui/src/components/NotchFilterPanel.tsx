/**
 * NotchFilterPanel — UI for suppressing TMM artifact notches in the SPL response.
 *
 * Background: The TMM solver produces narrow notches at artifact frequencies
 * (e.g., 1847, 2508, 2732, 2852, 2969 Hz for the Hiro geometry) due to
 * numerical standing-wave effects in the horn path. These are not physical
 * resonances — they are computational artifacts.
 *
 * The notch filter applies Gaussian-profile suppression at user-specified centre
 * frequencies with a configurable Q factor (higher Q = narrower notch).
 *
 * Backend: POST /simulate accepts notch_filter, notch_frequencies[], notch_q.
 *          Response includes spl_notched[] alongside the regular spl[].
 */

import { useState, useCallback } from "react";

interface NotchFilterPanelProps {
  /** Current comma-separated frequencies string (e.g., "1847, 2508, 2732") */
  frequencies: string;
  onFrequenciesChange: (v: string) => void;
  /** Q factor for the notch filters (higher = narrower) */
  q: number;
  onQChange: (v: number) => void;
  /** Whether the notch filter is active */
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  /** Called to trigger a re-simulation with updated notch params */
  onApply: () => void;
  disabled?: boolean;
}

const Q_MIN = 1;
const Q_MAX = 50;

// Artifact frequencies for the Hiro geometry (known TMM numerical artifacts)
const KNOWN_ARTIFACTS_HZ = [1847, 2508, 2732, 2852, 2969];

export default function NotchFilterPanel({
  frequencies,
  onFrequenciesChange,
  q,
  onQChange,
  enabled,
  onEnabledChange,
  onApply,
  disabled = false,
}: NotchFilterPanelProps) {
  const [localFreq, setLocalFreq] = useState(frequencies);

  const parseFreqs = (text: string): number[] => {
    return text
      .split(",")
      .map((s) => parseFloat(s.trim()))
      .filter((n) => !isNaN(n) && n > 0);
  };

  const parsedFreqs = parseFreqs(frequencies);

  const handleApplyPreset = useCallback(
    (preset: number[]) => {
      const text = preset.join(", ");
      setLocalFreq(text);
      onFrequenciesChange(text);
    },
    [onFrequenciesChange]
  );

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalFreq(e.target.value);
    onFrequenciesChange(e.target.value);
  };

  const handleQSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    onQChange(parseFloat(e.target.value));
  };

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "6px",
        padding: "10px 12px",
        marginBottom: "10px",
        background: "var(--bg2)",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
            disabled={disabled}
          />
          <span style={{ fontWeight: 600, fontSize: "12px" }}>� notch Filter</span>
        </label>
        <span style={{ fontSize: "10px", color: "var(--text2)", marginLeft: "auto" }}>
          suppresses TMM artifact notches
        </span>
      </div>

      {enabled && (
        <>
          {/* Frequency input */}
          <div style={{ marginBottom: "8px" }}>
            <label style={{ fontSize: "11px", color: "var(--text2)", display: "block", marginBottom: "3px" }}>
              Centre frequencies (Hz) — comma-separated
            </label>
            <input
              type="text"
              value={localFreq}
              onChange={handleTextChange}
              placeholder="e.g. 1847, 2508, 2732"
              disabled={disabled}
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "var(--bg1)",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                color: "var(--text)",
                fontSize: "12px",
                padding: "4px 6px",
                fontFamily: "monospace",
              }}
            />
            {parsedFreqs.length > 0 && (
              <p style={{ fontSize: "10px", color: "var(--text2)", margin: "2px 0 0 0" }}>
                {parsedFreqs.length} notch{parsedFreqs.length !== 1 ? "es" : ""} ·{" "}
                {parsedFreqs.map((f) => (f >= 1000 ? `${(f / 1000).toFixed(1)}k` : `${f}`)).join(", ")} Hz
              </p>
            )}
          </div>

          {/* Preset buttons */}
          <div style={{ display: "flex", gap: "4px", marginBottom: "8px", flexWrap: "wrap" }}>
            <button
              className="btn-outline btn-sm"
              onClick={() => handleApplyPreset(KNOWN_ARTIFACTS_HZ)}
              title="Apply known Hiro artifact frequencies"
              disabled={disabled}
              style={{ fontSize: "10px", padding: "2px 6px" }}
            >
              🎯 Hiro artifacts
            </button>
            <button
              className="btn-outline btn-sm"
              onClick={() => handleApplyPreset([1847])}
              disabled={disabled}
              style={{ fontSize: "10px", padding: "2px 6px" }}
            >
              1847 Hz
            </button>
            <button
              className="btn-outline btn-sm"
              onClick={() => { setLocalFreq(""); onFrequenciesChange(""); }}
              disabled={disabled}
              style={{ fontSize: "10px", padding: "2px 6px" }}
              title="Clear all frequencies"
            >
              Clear
            </button>
          </div>

          {/* Q factor slider */}
          <div style={{ marginBottom: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={{ fontSize: "11px", color: "var(--text2)" }}>Q factor</label>
              <span style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--accent)" }}>
                {q.toFixed(1)}
              </span>
            </div>
            <input
              type="range"
              min={Q_MIN}
              max={Q_MAX}
              step={0.5}
              value={q}
              onChange={handleQSlider}
              disabled={disabled}
              style={{ width: "100%" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", color: "var(--text2)" }}>
              <span>wide ({Q_MIN})</span>
              <span>narrow ({Q_MAX})</span>
            </div>
          </div>

          {/* Apply button */}
          <button
            className="btn-primary btn-sm"
            onClick={onApply}
            disabled={disabled || parsedFreqs.length === 0}
            style={{ width: "100%" }}
          >
            Apply Notches
          </button>

          {/* Info */}
          <p style={{ fontSize: "10px", color: "var(--text2)", margin: "6px 0 0 0", lineHeight: 1.4 }}>
            Notches suppress{" "}
            <span style={{ color: "var(--accent)" }}>TMM artifact frequencies</span> only — not
            physical resonances. Higher Q = narrower suppression. Use the{" "}
            <em>Frequency Sampler</em> (F3) to identify artifact notches vs real dips.
          </p>
        </>
      )}
    </div>
  );
}
