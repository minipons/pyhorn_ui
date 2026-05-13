import React from "react";
import InfoTooltip from "./InfoTooltip";

// ─── Chart metadata: descriptions for the help tooltips ────────────────────

export const CHART_DESCRIPTIONS: Record<string, {
  description: string;
  whatItMeans: string;
  goodBad: string;
}> = {
  "SPL Frequency Response": {
    description:
      "Sound Pressure Level vs frequency. The primary output metric of a loudspeaker — how loud the system plays at each frequency, measured at 1m / 2.83V (or the voltage used in your driver specs).",
    whatItMeans:
      "Height = loudness. The curve shows tonal balance: bass extends to the cutoff frequency fc, then rolls off. The midrange should be relatively flat. The high-frequency slope depends on compression driver breakup modes and horn directivity.",
    goodBad:
      "GOOD: smooth, flat response in-band; cutoff fc is clean with no group-delay ripple. BAD: large ±6 dB midrange bumps/holes indicate standing waves or misalignment; jaggedness means distortion or simulation artifacts. For domestic listening, ±3 dB from 80 Hz–16 kHz is excellent.",
  },

  Impedance: {
    description:
      "Electrical impedance vs frequency. The load the amplifier sees. Shows where the system is easy or hard to drive.",
    whatItMeans:
      "Peaks = resonance (fc for horns, fb for ported boxes). Deep valleys = crossover regions between subsystems. Magnitude tells you how much current flows at each frequency for a given voltage.",
    goodBad:
      "GOOD: smooth impedance curve; obvious horn resonance peak near fc; moderate difficulty (not too high, not too low). BAD: double peaks or irregularities suggest loose joints, air leaks, or box alignment issues. Extremely low impedance (<3 Ω) may require a high-current amp.",
  },

  "Driver Excursion": {
    description:
      "Peak cone excursion (mm) vs frequency at constant voltage (from your driver voltage spec). Shows how far the cone travels at each frequency.",
    whatItMeans:
      "Excursion is inversely proportional to frequency for a given SPL (lower frequencies require more displacement). Below fc, excursion rises rapidly — the horn no longer loads the driver effectively, and the cone can exceed Xmax.",
    goodBad:
      "GOOD: excursion stays well below Xmax across the band; horn cutoff fc is visible as the point where excursion starts rising. BAD: excursion approaches or exceeds Xmax anywhere in-band → risk of mechanical damage, drastically increased distortion, and port chuffing in vented systems. Add a high-pass filter if needed.",
  },

  "Cone Velocity": {
    description:
      "Peak cone velocity (m/s) vs frequency at constant voltage. How fast the cone moves at each frequency.",
    whatItMeans:
      "Velocity relates to excursion via v = 2πf·x. It's a more direct indicator of airspeed at the cone surface. Very high cone velocities indicate the driver is working hard and may be approaching its thermal or mechanical limits.",
    goodBad:
      "GOOD: velocity is moderate and smoothly varying. BAD: extremely high velocity at low frequencies → large excursion and distortion. Typical driver cone velocities stay below 0.5 m/s for most musical program material at moderate levels.",
  },

  "Cone Acceleration": {
    description:
      "Peak cone acceleration (m/s²) vs frequency at constant voltage. Rate of change of cone velocity.",
    whatItMeans:
      "Acceleration is proportional to force and inversely proportional to mass. High acceleration at high frequencies can indicate approaching breakup modes where the cone is no longer pistoning uniformly.",
    goodBad:
      "GOOD: smoothly decreasing acceleration with frequency in the piston range. BAD: sharp peaks or rises in acceleration at high frequencies → cone breakup, which creates distortion and beaming. An ideal moving-coil driver has a clean acceleration falloff until its first breakup resonance.",
  },

  "Particle Velocity": {
    description:
      "Air particle velocity (m/s) at three locations: throat (driver side), mouth (room side), and port (if applicable). Shows airspeed at key boundaries of the horn.",
    whatItMeans:
      "Throat particle velocity relates to back-pressure on the driver. Mouth particle velocity determines how much sound couples into the room. Port velocity is for vented alignments only. Mismatches between throat and mouth can indicate section mismatches or compression.",
    goodBad:
      "GOOD: throat and mouth velocities are consistent with SPL levels; no sudden jumps between segments. BAD: throat particle velocity exceeds ~5 m/s significantly → risk of intake turbulence and nonlinearity. Mouth velocity > ~5 m/s can cause air drag and compression. Typical horn mouth velocities stay below 5–10 m/s for efficient designs.",
  },

  "Diaphragm Pressure": {
    description:
      "Acoustic pressure on the driver diaphragm vs frequency. Total pressure, and the split between the horn-loaded (front) side and direct-radiated (rear) side. From Hornresp pages 124–125.",
    whatItMeans:
      "The front-side pressure is what the horn loads against. If the front and rear pressures are similar at low frequencies, the driver is poorly loaded and will see little net load from the horn. The pressure ratio tells you how much of the driver's effort goes into the horn vs bleeds to the rear.",
    goodBad:
      "GOOD: front (horn) side pressure dominates over rear side at low frequencies, especially near and below fc — this is proper horn loading. BAD: pressures are similar or rear dominates → the driver is essentially seesawing against itself; inefficient and high excursion. The total-to-horn-side ratio should be >2:1 near the cutoff frequency.",
  },

  "Throat Acoustic Impedance": {
    description:
      "Real (radiation resistance) and imaginary (reactance) parts of the acoustic impedance presented by the horn at the throat (driver side). Measured in Pa·s/m³ = ohms acoustically.",
    whatItMeans:
      "Real part = power delivered to the horn. Should be high when the horn is loading the driver efficiently. Imaginary part = reactive energy stored/stolen. Should cross zero near fc. Above cutoff, the real part should dominate.",
    goodBad:
      "GOOD: real part rises sharply above fc and stays high; imaginary part smoothly crosses zero near fc. This is textbook horn loading. BAD: real part is low or irregular → poor coupling; imaginary part doesn't cross zero cleanly → standing waves or poorly terminated geometry. The ideal horn throat looks like a resistive load above cutoff.",
  },

  "System Efficiency": {
    description:
      "Acoustic output power / electrical input power × 100 (%) at each frequency. What percentage of amplifier power is converted to acoustic power.",
    whatItMeans:
      "Efficiency shows where the system is most productive per watt. Horn-loaded systems can achieve 20–50% efficiency above cutoff, vastly more than sealed boxes (typically <5%). Below cutoff, efficiency collapses.",
    goodBad:
      "GOOD: efficiency rises to a peak near the low-frequency cutoff, then gently falls. High peak efficiency (>20%) is expected for a well-designed horn. BAD: peak efficiency is low (<10%) even above cutoff → poor loading, misalignment, or excessive losses. Note: efficiency = sensitivity × bandwidth; a narrow-band horn can show very high peak efficiency even if overall output is limited.",
  },

  "Driver Power": {
    description:
      "Electrical power (watts) delivered to the voice coil at each frequency for constant voltage. Shows how hard the amplifier must work.",
    whatItMeans:
      "Power peaks at the system's resonant frequency (where impedance is lowest) and generally decreases at higher frequencies. Useful for thermal budget calculations: sustained power handling must exceed the program's RMS level at your listening level.",
    goodBad:
      "GOOD: moderate, smoothly varying power consumption. Peaks are expected at resonance. BAD: excessive power at low frequencies (excursion-limited), or unexpectedly high power in specific bands (impedance dips). For domestic listening at normal levels, power rarely exceeds a few watts RMS. Peak program can demand 10× that.",
  },

  "Directivity — Polar Pattern & Beamwidth": {
    description:
      "Polar pattern: horn's radiation shape at a specific frequency — how sound spreads in different directions. Beamwidth: −6 dB coverage angle vs frequency.",
    whatItMeans:
      "At low frequencies (ka < 1, where ka = 2πf·mouth_radius / 343), the horn is omnidirectional. As frequency rises and ka grows, the horn becomes increasingly directional — sound narrows into a beam. This is why horns are used: controlled directivity reduces room reflections and increases room-independent output.",
    goodBad:
      "GOOD: smooth narrowing of beamwidth with frequency; consistent vertical and horizontal patterns. BAD: irregular beamwidth, strong sidelobes, or abrupt pattern changes → non-uniform horn expansion (steps, kinks) or multi-moded operation. Wide beamwidth at high frequencies (>90°) may mean the horn is too small to control directivity. Typical target: 90°–100° horizontal through the midrange.",
  },

  "Group Delay": {
    description:
      "Time delay (ms) of signal components at each frequency. Related to phase response: GD = dφ/df. Lower is better for transient response.",
    whatItMeans:
      "Group delay shows how uniformly different frequencies arrive at the listener. A flat group delay means all frequencies arrive at the same time = clean transients. The red dashed Futtrup limit line is the threshold below which delay is generally considered audibly transparent. The green 1/f line is the theoretical minimum for any physical system.",
    goodBad:
      "GOOD: group delay stays below the orange Futtrup limit across the band. Below ~200 Hz, some excess group delay is inevitable due to the horn's physical length (sound takes time to travel down the horn). BAD: large GD spikes anywhere, or GD that substantially exceeds the Futtrup limit → audibly bloated or 'slow' bass, impaired PRAT (perceived reproduced audio tempo). Peaks in GD often correspond to the cutoff frequency region.",
  },

  "Horn Profile": {
    description:
      "Side-view cross-section of the horn geometry — inner wall boundaries. Shows expansion profile shape and segment positions.",
    whatItMeans:
      "The profile determines the horn's frequency response, cutoff, and character. Exponential profiles have a single fc. Tractrix (catenoidal) gives constant-resistance loading. Hyperbolic profiles offer a middle ground. Stair-step approximations discretize the continuous profile into cylindrical sections.",
    goodBad:
      "GOOD: smooth continuous expansion from throat to mouth; no sudden steps or kinks; mouth area gives the desired loading at the target frequency. BAD: abrupt area jumps → reflections and response irregularities; throat too large → poor high-frequency coupling; mouth too small → strong beaming; mouth too large → poor low-frequency loading.",
  },

  "Filtered SPL — Difference vs Baseline": {
    description:
      "Filtered SPL curve overlaid on the unfiltered (baseline) response. Shows what the passive/active filter is doing to the response.",
    whatItMeans:
      "The pink line is the baseline, the red/pink solid line is the post-filter response. The difference is the filter's effect: boost/cut at specific frequencies.",
    goodBad:
      "GOOD: filter smooths bumps or fills nulls as intended. BAD: filter over-corrects creating new problems in adjacent bands. Always check that the correction doesn't create new issues.",
  },

  "Filter Delta (filtered − baseline)": {
    description:
      "Difference in dB at each frequency between the filtered and unfiltered responses. Positive = filter boosts that frequency; negative = filter cuts it.",
    whatItMeans:
      "This is the net effect of your filter. Look for large corrections — they may indicate the underlying simulation has issues that the filter is compensating for.",
    goodBad:
      "GOOD: small corrections (<3 dB), smooth curve. BAD: corrections >6 dB — large cuts often indicate a simulated problem rather than a real one. Large boosts risk driver excursion or amplifier clipping in those bands. Corrections should be distributed smoothly, not concentrated at one frequency.",
  },

  "Baseline vs Current — Difference (current − baseline)": {
    description:
      "Difference in dB between the currently loaded horn/driver configuration and a saved baseline. Shows how changes affect the response.",
    whatItMeans:
      "Compare two designs or two parameter sets. The curve shows exactly what changed and by how much. RMS difference is a single-number summary of how different the two responses are.",
    goodBad:
      "GOOD: small, smoothly distributed differences. BAD: large differences in narrow bands → something fundamental changed (throat area, cutoff, driver). The baseline comparison is a design refinement tool: each iteration should make targeted improvements without creating new problems.",
  },

  Spectrogram: {
    description:
      "Time–frequency heatmap of the SPL response. Runs a Short-Time Fourier Transform (STFT) on the impulse response to show how energy is distributed across time and frequency simultaneously.",
    whatItMeans:
      "The horizontal axis is time (ms after the impulse), the vertical axis is frequency (Hz). Color = SPL level (dB). Early arrivals (left) show the direct sound; later arrivals (right) show room reflections. Below fc, the response is sparse because the horn loads inefficiently.",
    goodBad:
      "GOOD: clean early arrival, sharp cutoff below fc, visible room reflections as trailing energy to the right. BAD: significant energy arriving before the direct sound (simulation artifact), excessive late energy suggesting long reverberation, or no visible cutoff (horn is too small or poorly loaded). Use the zoom controls to explore specific time/frequency regions.",
  },
};

// ─── Reusable chart title with help tooltip ─────────────────────────────────

interface ChartTitleProps {
  title: string;
  style?: React.CSSProperties;
}

export default function ChartTitle({ title, style }: ChartTitleProps) {
  // Strip leading emoji + space prefix before lookup
  const cleanTitle = title.replace(/^[^\w\u0080-\uFFFF]+ /u, "");
  const meta = CHART_DESCRIPTIONS[cleanTitle];

  if (!meta) {
    // Fallback: plain title with a generic tooltip if title not found
    return (
      <h2 style={{ margin: "0 0 4px", fontSize: "13px", fontWeight: 600, color: "var(--text)", ...style }}>
        {title}
      </h2>
    );
  }

  const tooltipContent = (
    <div>
      <div style={{ marginBottom: "8px", fontSize: "12px", fontWeight: 600, color: "#e6edf3" }}>
        {title}
      </div>
      <div style={{ marginBottom: "8px", lineHeight: 1.5 }}>
        <span style={{ color: "#8b949e", marginRight: "4px" }}>📌</span>
        {meta.description}
      </div>
      <div style={{ marginBottom: "8px", lineHeight: 1.5 }}>
        <span style={{ color: "#8b949e", marginRight: "4px" }}>💡</span>
        {meta.whatItMeans}
      </div>
      <div style={{ lineHeight: 1.5 }}>
        <span style={{ color: "#8b949e", marginRight: "4px" }}>✅❌</span>
        {meta.goodBad}
      </div>
    </div>
  );

  return (
    <h2 style={{ margin: "0 0 4px", fontSize: "13px", fontWeight: 600, color: "var(--text)", ...style }}>
      {title}
      <InfoTooltip content={tooltipContent}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "16px",
            height: "16px",
            borderRadius: "50%",
            border: "1px solid var(--border, #30363d)",
            marginLeft: "6px",
            fontSize: "10px",
            color: "var(--text2, #8b949e)",
            cursor: "help",
            verticalAlign: "middle",
            userSelect: "none",
            fontFamily: "monospace",
            lineHeight: 1,
          }}
        >
          ?
        </span>
      </InfoTooltip>
    </h2>
  );
}
