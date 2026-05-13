export interface SimulationResult {
  freqs: number[];
  spl: number[];
  impedance: number[];
  excursion: number[];
  ib_spl?: number[];
  horn_spl?: number[];
  off_axis_spl?: Record<string, number[]>; // angle in deg → SPL array keyed by angle string
  off_axis_angles?: number[];
  radiation_angle?: number | null;
  direction_index?: number[][]; // piston-based DI(f) in dB, same shape as off_axis_spl (n_freq × n_angles)
  // FDD model output (Hornresp pages 77, 92 — distinct from piston directivity)
  fdd_enabled?: boolean;
  fdd_di?: number[]; // FDD-model directivity index vs frequency (dB), same length as freqs
  group_delay_ms?: number[];
  group_delay_per_period?: number[];  // dimensionless = τ_g [s] × f [Hz]; Hornresp page 120 "Delay" option
  efficiency_pct?: number[];
  electrical_input_power?: number[];  // real electrical input power in watts; ref: Hornresp page 105
  numerical_artifacts?: number[];   // TMM artifact frequencies (Hz), from solver diagnostic
  segment_widths?: number[];         // segment discretization widths (m), for transparency
  phase_degrees?: number[];          // phase response in degrees at each frequency
  throat_impedance_real?: number[];
  throat_impedance_imag?: number[];
  throat_impedance_magnitude?: number[];
  cone_velocity?: number[];        // peak cone velocity in m/s; ref: Hornresp page 126
  cone_acceleration?: number[];   // peak cone acceleration in m/s²; ref: Hornresp page 127
  // Diaphragm pressure (Hornresp pages 124-125)
  diaphragm_pressure_total?: number[];      // total diaphragm pressure (Pa)
  diaphragm_pressure_horn_side?: number[];  // horn-side diaphragm pressure (Pa)
  diaphragm_pressure_direct_side?: number[]; // direct-radiated diaphragm pressure (Pa)
  // Notch-filtered SPL (spl with artifact notches suppressed by Gaussian-profile notches)
  spl_notched?: number[];
  // Particle velocity at throat/mouth/port (Hornresp page 106)
  particle_velocity_throat?: number[];  // particle velocity at throat (m/s)
  particle_velocity_mouth?: number[];    // particle velocity at mouth (m/s)
  particle_velocity_port?: number[];      // particle velocity at port (m/s)
}

export interface SimParams {
  driverYaml: string;
  hornYaml: string;
  fmin: number;
  fmax: number;
  nPoints: number;
}