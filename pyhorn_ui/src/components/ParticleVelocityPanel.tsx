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

interface ParticleVelocityPanelProps {
  chartData: Array<{
    freq: number;
    particle_velocity_throat: number | null;
    particle_velocity_mouth: number | null;
    particle_velocity_port: number | null;
  }>;
  fmin: number;
  fmax: number;
  onChartClick?: (data: unknown, index: unknown, event: React.MouseEvent) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts CategoricalChartFunc has incompatible signature; safe in practice
const anyCast = (fn: any) => fn;

export default function ParticleVelocityPanel({
  chartData,
  fmin,
  fmax,
  onChartClick,
}: ParticleVelocityPanelProps) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={chartData} onClick={anyCast(onChartClick)}>
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
          tickFormatter={(v) => `${v.toExponential(1)}`}
          label={{
            value: "Particle Velocity (m/s)",
            angle: -90,
            position: "insideLeft",
            fill: "#aaa",
            fontSize: 11,
          }}
        />
        <Tooltip
          formatter={(v: number, name: string) => [
            `${v.toExponential(3)} m/s`,
            name,
          ]}
          contentStyle={{ background: "#1e1e1e", border: "1px solid #444" }}
          labelFormatter={(f) => `${Number(f).toFixed(1)} Hz`}
        />
        <Legend />
        <Line
          type="monotone"
          dataKey="particle_velocity_throat"
          stroke="#06b6d4"
          dot={false}
          name="Throat (m/s)"
          strokeWidth={1.5}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="particle_velocity_mouth"
          stroke="#f97316"
          dot={false}
          name="Mouth (m/s)"
          strokeWidth={1.5}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="particle_velocity_port"
          stroke="#22c55e"
          dot={false}
          name="Port (m/s)"
          strokeWidth={1.5}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
