import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface TrendPoint {
  date: string;
  count: number;
}

interface DashboardLineChartProps {
  data: TrendPoint[];
}

export default function DashboardLineChart({ data }: DashboardLineChartProps) {
  if (data.length === 0) {
    return <p className="dashboard-chart-empty">No request data in the last 14 days.</p>;
  }

  return (
    <div className="dashboard-line-chart-wrap">
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--color-text-muted)" />
          <YAxis tick={{ fontSize: 11 }} stroke="var(--color-text-muted)" />
          <Tooltip
            contentStyle={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
            }}
            formatter={(value: number) => [value, 'Requests']}
            labelFormatter={(label) => `Date: ${label}`}
          />
          <Line
            type="monotone"
            dataKey="count"
            stroke="var(--color-primary)"
            strokeWidth={2}
            dot={{ fill: 'var(--color-primary)' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
