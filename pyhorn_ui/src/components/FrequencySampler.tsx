import { SimulationResult } from "../types/simulation";

export interface SamplerState {
  freq: number;    // clicked frequency (Hz)
  freqIdx: number; // nearest index in arrays
  x: number;       // screen X (px)
  y: number;       // screen Y (px)
}

interface FrequencySamplerProps {
  result: SimulationResult;
  driverYaml: string;
  hornYaml: string;
  samplerState: SamplerState | null;
  onClose: () => void;
}

// Linear interpolation at frequency f from known frequencies/values
function interpolate(freq: number, freqs: number[], values: number[]): number {
  if (freqs.length === 0) return 0;
  if (freq <= freqs[0]) return values[0];
  if (freq >= freqs[freqs.length - 1]) return values[values.length - 1];
  for (let i = 0; i < freqs.length - 1; i++) {
    if (freq >= freqs[i] && freq <= freqs[i + 1]) {
      const t = (freq - freqs[i]) / (freqs[i + 1] - freqs[i]);
      return values[i] + t * (values[i + 1] - values[i]);
    }
  }
  return values[0];
}

function parseYamlNum(yaml: string, key: string): number | null {
  const m = yaml.match(new RegExp(`^\\s*${key}\\s*:\\s*([\\d.e+-]+)`, "mi"));
  return m ? parseFloat(m[1]) : null;
}

function parseHornSegments(hornYaml: string): number {
  const m = hornYaml.match(/^\s*n_segments\s*:\s*(\d+)/mi);
  return m ? parseInt(m[1]) : 1;
}

function computeCutoffHz(hornYaml: string): number {
  const ta = parseYamlNum(hornYaml, "throat_area");
  const ma = parseYamlNum(hornYaml, "mouth_area");
  const L  = parseYamlNum(hornYaml, "path_length");
  const pt = (
    hornYaml.match(/^\s*profile_type\s*:\s*(.+)/mi)?.[1]
      ?.trim().replace(/^["']|["']$/g, "") ?? "exponential"
  ).toLowerCase();
  if (ta == null || ma == null || L == null || L === 0) return 0;
  const PI = Math.PI;
  let m = 0;
  if (pt === "exponential" || pt === "parabolic") {
    m = (1 / L) * Math.log(ma / ta);
  }
  if (m <= 0) return 0;
  return (m * 343) / (4 * PI);
}

export default function FrequencySampler({
  result,
  driverYaml,
  hornYaml,
  samplerState,
  onClose,
}: FrequencySamplerProps) {
  if (!samplerState || !result) return null;

  const {
    freqs, spl, impedance, excursion, group_delay_ms, efficiency_pct,
    radiation_angle, numerical_artifacts, phase_degrees,
    throat_impedance_real, throat_impedance_imag, throat_impedance_magnitude,
    cone_velocity, particle_velocity_throat, particle_velocity_mouth,
    particle_velocity_port, diaphragm_pressure_total,
    diaphragm_pressure_horn_side, diaphragm_pressure_direct_side,
    electrical_input_power, cone_acceleration,
  } = result;

  const voltage          = parseYamlNum(driverYaml, "voltage") ?? 2.83;
  const xmax             = parseYamlNum(driverYaml, "xmax") ?? 0.001;
  const fc               = computeCutoffHz(hornYaml);
  const isSingleSegment  = parseHornSegments(hornYaml) === 1;
  const f                = samplerState.freq;

  // Interpolate all metrics at the clicked frequency
  const i_spl      = interpolate(f, freqs, spl);
  const i_imp_mag  = interpolate(f, freqs, impedance);
  const i_exc_m    = interpolate(f, freqs, excursion);   // in meters
  const i_gd       = group_delay_ms ? interpolate(f, freqs, group_delay_ms) : null;
  const i_eff      = efficiency_pct  ? interpolate(f, freqs, efficiency_pct)  : null;
  const i_phase    = phase_degrees  ? interpolate(f, freqs, phase_degrees)  : null;
  const i_zr       = throat_impedance_real     ? interpolate(f, freqs, throat_impedance_real)     : null;
  const i_zi       = throat_impedance_imag     ? interpolate(f, freqs, throat_impedance_imag)     : null;
  const i_zmag     = throat_impedance_magnitude ? interpolate(f, freqs, throat_impedance_magnitude) : null;

  // Electrical input power: prefer result value, fall back to V²/|Z| derivation
  const i_elec_power = electrical_input_power
    ? interpolate(f, freqs, electrical_input_power)
    : i_imp_mag > 0 ? (voltage * voltage) / i_imp_mag : 0;
  // Acoustic output power
  const i_acou_power = i_eff != null ? (i_eff / 100) * i_elec_power : null;

  // Cone velocity (m/s): use result value when available
  const i_cone_vel = cone_velocity ? interpolate(f, freqs, cone_velocity) : null;

  // Cone acceleration (m/s²): a = (2πf)² · x  (x in m → a in m/s²)
  const i_accel = cone_acceleration
    ? interpolate(f, freqs, cone_acceleration)
    : Math.pow(2 * Math.PI * f, 2) * i_exc_m;

  // Particle velocities (m/s)
  const i_pv_throat = particle_velocity_throat ? interpolate(f, freqs, particle_velocity_throat) : null;
  const i_pv_mouth  = particle_velocity_mouth  ? interpolate(f, freqs, particle_velocity_mouth)  : null;
  const i_pv_port   = particle_velocity_port    ? interpolate(f, freqs, particle_velocity_port)    : null;

  // Diaphragm pressures (Pa)
  const i_dp_total = diaphragm_pressure_total      ? interpolate(f, freqs, diaphragm_pressure_total)      : null;
  const i_dp_horn  = diaphragm_pressure_horn_side ? interpolate(f, freqs, diaphragm_pressure_horn_side) : null;
  const i_dp_dir   = diaphragm_pressure_direct_side? interpolate(f, freqs, diaphragm_pressure_direct_side): null;

  // Check if this is the maximum SPL in the band
  const maxSpl   = Math.max(...spl);
  const isMaxSpl = Math.abs(i_spl - maxSpl) < 0.05;

  // Power vs displacement limiting
  const xmaxMm   = xmax * 1000;               // Xmax in mm
  const excMm    = Math.abs(i_exc_m * 1000);  // excursion in mm
  const excRatio = xmax > 0 ? excMm / xmaxMm : 0;
  const isDispLimited  = excRatio >= 0.8;
  const isPowerLimited = isMaxSpl && excRatio < 0.8;

  const freqLabel = f >= 1000 ? `${(f / 1000).toFixed(2)} kHz` : `${f.toFixed(1)} Hz`;

  // Build metric rows
  const rows: Array<{
    label: string;
    value: string;
    unit?: string;
    highlight?: boolean;
    badge?: string;
  }> = [
    { label: "Frequency",          value: freqLabel },
    {
      label: "SPL",
      value: i_spl.toFixed(1),
      unit: "dB",
      highlight: isMaxSpl,
      badge: isMaxSpl ? "★ MAX" : undefined,
    },
    { label: "Electrical Z",       value: i_imp_mag.toFixed(2), unit: "Ω" },
    ...(i_zmag != null
      ? [
          { label: "Throat Z (mag)", value: i_zmag.toFixed(2), unit: "Pa·s/m³" },
          ...(i_zr != null ? [{ label: "Throat Z (real)", value: i_zr.toFixed(2), unit: "Pa·s/m³" }] : []),
          ...(i_zi != null ? [{ label: "Throat Z (imag)", value: i_zi.toFixed(2), unit: "Pa·s/m³" }] : []),
        ]
      : []),
    {
      label: "Group Delay",
      value: i_gd != null ? i_gd.toFixed(3) : "—",
      unit: "ms",
    },
    ...(i_phase != null
      ? [{ label: "Phase Response", value: i_phase.toFixed(1), unit: "°" }]
      : []),
    ...(radiation_angle != null
      ? [{ label: "Radiation Angle", value: radiation_angle.toFixed(1), unit: "°" }]
      : []),
    { label: "Elec. Input Power",  value: i_elec_power.toFixed(3),  unit: "W" },
    ...(i_acou_power != null
      ? [{ label: "Acou. Output Power", value: i_acou_power.toFixed(4), unit: "W" }]
      : []),
    ...(i_eff != null
      ? [{ label: "System Efficiency", value: i_eff.toFixed(4), unit: "%" }]
      : []),
    { label: "Cone Excursion",     value: excMm.toFixed(3),         unit: "mm" },
    ...(i_cone_vel != null
      ? [{ label: "Cone Velocity", value: i_cone_vel.toFixed(4), unit: "m/s" }]
      : []),
    { label: "Cone Acceleration",  value: i_accel.toFixed(1),       unit: "m/s²" },
    ...(i_pv_throat != null
      ? [{ label: "Particle Vel (throat)", value: i_pv_throat.toFixed(5), unit: "m/s" }]
      : []),
    ...(i_pv_mouth != null
      ? [{ label: "Particle Vel (mouth)", value: i_pv_mouth.toFixed(5), unit: "m/s" }]
      : []),
    ...(i_pv_port != null
      ? [{ label: "Particle Vel (port)", value: i_pv_port.toFixed(5), unit: "m/s" }]
      : []),
    ...(i_dp_total != null
      ? [
          { label: "Diaphragm P (total)", value: i_dp_total.toFixed(2), unit: "Pa" },
          ...(i_dp_horn != null  ? [{ label: "Diaphragm P (horn)",  value: i_dp_horn.toFixed(2),  unit: "Pa" }] : []),
          ...(i_dp_dir != null   ? [{ label: "Diaphragm P (direct)", value: i_dp_dir.toFixed(2),   unit: "Pa" }] : []),
        ]
      : []),
  ];

  // Second-tone distortion: approximate for single-segment horns
  // THD ≈ (f/fc)² × k — empirical model; fc=0 means unknown
  if (isSingleSegment && fc > 0) {
    const thd = Math.min(99.9, Math.pow(f / fc, 2) * 15);
    rows.push({ label: "2nd Tone Distortion", value: thd.toFixed(2), unit: "%" });
  }

  // Numerical artifact detection — flag when sampled frequency is near a TMM artifact
  const NEAR_HZ = 60; // Hz tolerance for artifact proximity
  const nearArtifact = numerical_artifacts?.find((af) => Math.abs(af - f) <= NEAR_HZ);
  if (nearArtifact != null) {
    rows.push({
      label: "⚠ TMM Artifact",
      value: `~${Math.round(nearArtifact)} Hz`,
      highlight: false,
    });
  }

  // Panel positioning — keep within viewport
  const panelW = 268;
  const panelH = 480;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.min(samplerState.x + 16, vw - panelW - 8);
  const top  = Math.min(samplerState.y + 16, vh - panelH - 8);

  return (
    <>
      {/* Backdrop — click anywhere outside to dismiss */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: 999, background: "transparent" }}
        onClick={onClose}
      />
      <div
        className="frequency-sampler-overlay"
        style={{ left, top }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sampler-header">
          <span className="sampler-title">📍 Sample @ {freqLabel}</span>
          <button className="sampler-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="sampler-metrics">
          {rows.map((row) => (
            <div
              key={row.label}
              className={`sampler-metric-row${row.highlight ? " sampler-row-highlight" : ""}`}
            >
              <span className="sampler-metric-label">{row.label}</span>
              <span className="sampler-metric-value">
                {row.badge && <span className="sampler-badge">{row.badge}</span>}
                {row.value}
                {row.unit && <span className="sampler-unit"> {row.unit}</span>}
              </span>
            </div>
          ))}
        </div>

        {/* Power / Displacement limiting */}
        {isMaxSpl && (
          <div className={`sampler-limiting${isDispLimited ? " disp-limited" : isPowerLimited ? " power-limited" : ""}`}>
            {isDispLimited
              ? `⚠ Displacement-limited · Excursion ${excMm.toFixed(2)} mm → Xmax ${xmaxMm.toFixed(2)} mm`
              : isPowerLimited
              ? `✓ Power-limited · Max SPL at ${freqLabel}`
              : null}
          </div>
        )}
        {isMaxSpl && (
          <div className="sampler-xmax-info">
            V = {voltage.toFixed(2)} V · Xmax = {xmaxMm.toFixed(2)} mm
          </div>
        )}
      </div>
    </>
  );
}
