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

interface DriverPowerPanelProps {
  chartData: Array<{
    freq: number;
    electrical_input_power: number | null;
  }>;
  fmin: number;
  fmax: number;
  onChartClick?: (data: unknown, index: unknown, event: React.MouseEvent) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export default function DriverPowerPanel({ chartData, fmin, fmax, onChartClick }: DriverPowerPanelProps) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={chartData} onClick={onChartClick as any}>
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
          scale="log"
          domain={["auto", "auto"]}
          tickFormatter={(v) => {
            if (v >= 1) return v.toFixed(2);
            if (v >= 0.01) return v.toFixed(3);
            return v.toExponential(1);
          }}
          label={{ value: "Driver Power (W)", angle: -90, position: "insideLeft", fill: "#aaa", fontSize: 11 }}
        />
        <Tooltip
          formatter={(v: number) => {
            if (v >= 0.01) return [`${v.toFixed(4)} W`, "Driver Power"];
            return [`${v.toExponential(3)} W`, "Driver Power"];
          }}
          contentStyle={{ background: "#1e1e1e", border: "1px solid #444" }}
        />
        <Legend />
        <Line
          type="monotone"
          dataKey="electrical_input_power"
          stroke="#f97316"
          dot={false}
          name="Driver Power (W)"
          strokeWidth={1.5}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
