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

interface ConeVelocityPanelProps {
  chartData: Array<{
    freq: number;
    cone_velocity: number | null;
  }>;
  fmin: number;
  fmax: number;
  onChartClick?: (data: unknown, index: unknown, event: React.MouseEvent) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts CategoricalChartFunc has incompatible signature; safe in practice
const anyCast = (fn: any) => fn;

export default function ConeVelocityPanel({
  chartData,
  fmin,
  fmax,
  onChartClick,
}: ConeVelocityPanelProps) {
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
            value: "Velocity (m/s)",
            angle: -90,
            position: "insideLeft",
            fill: "#aaa",
            fontSize: 11,
          }}
        />
        <Tooltip
          formatter={(v: unknown) => typeof v === "number" ? [`${v.toExponential(3)} m/s`, "Cone Velocity"] : ["—", "Cone Velocity"]}
          contentStyle={{ background: "#1e1e1e", border: "1px solid #444" }}
          labelFormatter={(f) => `${Number(f).toFixed(1)} Hz`}
        />
        <Legend />
        <Line
          type="monotone"
          dataKey="cone_velocity"
          stroke="#06b6d6"
          dot={false}
          name="Cone Velocity (m/s)"
          strokeWidth={1.5}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
