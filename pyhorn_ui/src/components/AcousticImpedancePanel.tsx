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
import { SimulationResult } from "../types/simulation";

interface AcousticImpedancePanelProps {
  result: SimulationResult | null;
}

export default function AcousticImpedancePanel({ result }: AcousticImpedancePanelProps) {
  if (!result) {
    return (
      <div className="placeholder" style={{ height: 220 }}>
        No data — run a simulation first
      </div>
    );
  }

  const { freqs: frequencies, throat_impedance_real, throat_impedance_imag, throat_impedance_magnitude } = result;

  const hasReal = throat_impedance_real && throat_impedance_real.length > 0;
  const hasImag = throat_impedance_imag && throat_impedance_imag.length > 0;
  const hasMag = throat_impedance_magnitude && throat_impedance_magnitude.length > 0;

  if (!hasReal && !hasImag && !hasMag) {
    return (
      <div className="placeholder" style={{ height: 220 }}>
        No throat impedance data available from API
      </div>
    );
  }

  const chartData = frequencies.map((freq: number, i: number) => ({
    freq,
    real: throat_impedance_real?.[i] ?? null,
    imag: throat_impedance_imag?.[i] ?? null,
    magnitude: throat_impedance_magnitude?.[i] ?? null,
  }));

  const fmin = frequencies[0] ?? 20;
  const fmax = frequencies[frequencies.length - 1] ?? 5000;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
        <XAxis
          dataKey="freq"
          type="number"
          scale="log"
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
          tickFormatter={(v) => `${v.toFixed(1)}`}
          label={{ value: "Impedance (Ω)", angle: -90, position: "insideLeft", fill: "#aaa", fontSize: 11 }}
        />
        <Tooltip
          formatter={(v: number, name: string) => [`${v.toFixed(4)} Ω`, name]}
          contentStyle={{ background: "#1e1e1e", border: "1px solid #444" }}
          labelFormatter={(v) => `${Number(v).toFixed(1)} Hz`}
        />
        <Legend />
        {hasReal && (
          <>
            <ReferenceLine y={0} stroke="#555" strokeDasharray="3 3" />
            <Line
              type="monotone"
              dataKey="real"
              stroke="#f97316"
              dot={false}
              name="Real (Ω)"
              strokeWidth={1.5}
              connectNulls={false}
            />
          </>
        )}
        {hasImag && (
          <Line
            type="monotone"
            dataKey="imag"
            stroke="#2563eb"
            dot={false}
            name="Imaginary (Ω)"
            strokeWidth={1.5}
            connectNulls={false}
          />
        )}
        {hasMag && (
          <Line
            type="monotone"
            dataKey="magnitude"
            stroke="#22c55e"
            dot={false}
            name="Magnitude (Ω)"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            connectNulls={false}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
