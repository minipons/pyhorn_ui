/**
 * FDDModelPanel — UI for Hornresp's Frequency Dependent Directivity (FDD) model.
 *
 * Background: The piston-based directivity model (Levine/Inglis) gives a smooth,
 * monotonically-increasing directivity index with frequency. Hornresp's FDD model
 * (pages 77, 92) adds a user-configurable DI roll-on characterised by:
 *   DI(f) = D_max × [1 − exp(−(f/f_c)²)]
 *
 * This lets you model the directivity of a specific horn (e.g., a relatively
 * narrow low-frequency horn that opens up gradually) rather than an ideal piston.
 *
 * f_c  — characteristic transition frequency (Hz): DI ramps up from 0 toward D_max
 *        as frequency rises above f_c. Typical range: 200–1000 Hz.
 * D_max — maximum directivity index (dB): asymptotic DI ceiling. Typical: 3–8 dB.
 *
 * Backend: POST /simulate accepts fdd_mode, fdd_fc, fdd_dmax.
 *          Response includes fdd_enabled and fdd_di[] (DI vs frequency).
 */


import InfoTooltip from "./InfoTooltip";

interface FDDModelPanelProps {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  fc: number;
  onFcChange: (v: number) => void;
  dmax: number;
  onDmaxChange: (v: number) => void;
}

const FC_MIN = 50;
const FC_MAX = 2000;
const DMAX_MIN = 0;
const DMAX_MAX = 12;

export default function FDDModelPanel({
  enabled,
  onEnabledChange,
  fc,
  onFcChange,
  dmax,
  onDmaxChange,
}: FDDModelPanelProps) {
  const handleFcSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFcChange(parseFloat(e.target.value));
  };

  const handleDmaxSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    onDmaxChange(parseFloat(e.target.value));
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
          />
          <InfoTooltip content="Enable Hornresp's Frequency Dependent Directivity (FDD) model. Replaces the piston-based DI with DI(f) = D_max × [1 − exp(−(f/f_c)²)]. Distinct from the standard piston directivity model. Hornresp pages 77, 92.">
            <span style={{ fontWeight: 600, fontSize: "12px" }}>
              FDD Model
            </span>
          </InfoTooltip>
        </label>
        <span style={{ fontSize: "10px", color: "var(--text2)", marginLeft: "auto" }}>
          frequency-dependent directivity
        </span>
      </div>

      {enabled && (
        <>
          {/* f_c slider */}
          <div style={{ marginBottom: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "3px" }}>
              <InfoTooltip content="Characteristic transition frequency (Hz). DI ramps up from 0 toward D_max as frequency rises above f_c. Lower f_c = directivity rises earlier. Typical: 200–1000 Hz depending on horn size and mouth width.">
                <span style={{ fontSize: "11px", color: "var(--text2)" }}>f_c (Hz)</span>
              </InfoTooltip>
              <span style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--accent)" }}>
                {fc.toFixed(0)} Hz
              </span>
            </div>
            <input
              type="range"
              min={FC_MIN}
              max={FC_MAX}
              step={10}
              value={fc}
              onChange={handleFcSlider}
              style={{ width: "100%" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", color: "var(--text2)" }}>
              <span>{FC_MIN} Hz</span>
              <span>{FC_MAX} Hz</span>
            </div>
          </div>

          {/* D_max slider */}
          <div style={{ marginBottom: "6px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "3px" }}>
              <InfoTooltip content="Maximum directivity index (dB). Asymptotic DI ceiling. Higher D_max = more directional at high frequencies. Typical: 3–8 dB for mid-size horns. D_max = 0 disables the FDD model (uses piston DI only).">
                <span style={{ fontSize: "11px", color: "var(--text2)" }}>D_max (dB)</span>
              </InfoTooltip>
              <span style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--accent)" }}>
                {dmax.toFixed(1)} dB
              </span>
            </div>
            <input
              type="range"
              min={DMAX_MIN}
              max={DMAX_MAX}
              step={0.5}
              value={dmax}
              onChange={handleDmaxSlider}
              style={{ width: "100%" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", color: "var(--text2)" }}>
              <span>omni (0 dB)</span>
              <span>{DMAX_MAX} dB</span>
            </div>
          </div>

          {/* Info note */}
          <p style={{ fontSize: "10px", color: "var(--text2)", margin: "6px 0 0 0", lineHeight: 1.4 }}>
            FDD rolls on above f_c toward D_max. Replaces piston DI in directivity charts
            when enabled. Distinct from{" "}
            <span style={{ color: "var(--accent)" }}>1/f GD</span> and{" "}
            <span style={{ color: "var(--accent)" }}>Futtrup</span> reference lines.
          </p>
        </>
      )}
    </div>
  );
}
