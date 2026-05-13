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

interface EfficiencyPanelProps {
  chartData: Array<{
    freq: number;
    efficiency_pct: number | null;
  }>;
  fmin: number;
  fmax: number;
  onChartClick?: (data: unknown, index: unknown, event: React.MouseEvent) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export default function EfficiencyPanel({ chartData, fmin, fmax, onChartClick }: EfficiencyPanelProps) {
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
          domain={[0, "auto"]}
          tickFormatter={(v) => `${v.toFixed(1)}`}
          label={{ value: "Efficiency (%)", angle: -90, position: "insideLeft", fill: "#aaa", fontSize: 11 }}
        />
        <Tooltip
          formatter={(v: number) => [`${v.toFixed(4)} %`, "System Efficiency"]}
          contentStyle={{ background: "#1e1e1e", border: "1px solid #444" }}
        />
        <Legend />
        <Line
          type="monotone"
          dataKey="efficiency_pct"
          stroke="#f97316"
          dot={false}
          name="System Efficiency (%)"
          strokeWidth={1.5}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
