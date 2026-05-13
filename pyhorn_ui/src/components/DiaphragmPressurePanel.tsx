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

interface DiaphragmPressurePanelProps {
  chartData: Array<{
    freq: number;
    diaphragm_pressure_total: number | null;
    diaphragm_pressure_horn_side: number | null;
    diaphragm_pressure_direct_side: number | null;
  }>;
  fmin: number;
  fmax: number;
  onChartClick?: (data: unknown, index: unknown, event: React.MouseEvent) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts CategoricalChartFunc has incompatible signature; safe in practice
const anyCast = (fn: any) => fn;

export default function DiaphragmPressurePanel({
  chartData,
  fmin,
  fmax,
  onChartClick,
}: DiaphragmPressurePanelProps) {
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
            value: "Diaphragm Pressure (Pa)",
            angle: -90,
            position: "insideLeft",
            fill: "#aaa",
            fontSize: 11,
          }}
        />
        <Tooltip
          formatter={(v: number) => [`${v.toExponential(3)} Pa`, "Pressure"]}
          contentStyle={{ background: "#1e1e1e", border: "1px solid #444" }}
          labelFormatter={(f) => `${Number(f).toFixed(1)} Hz`}
        />
        <Legend />
        <Line
          type="monotone"
          dataKey="diaphragm_pressure_total"
          stroke="#f97316"
          dot={false}
          name="Total (Pa)"
          strokeWidth={1.5}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="diaphragm_pressure_horn_side"
          stroke="#06b6d4"
          dot={false}
          name="Horn Side (Pa)"
          strokeWidth={1.5}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="diaphragm_pressure_direct_side"
          stroke="#a855f7"
          dot={false}
          name="Direct Side (Pa)"
          strokeWidth={1.5}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
