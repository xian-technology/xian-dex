import { useMemo } from "react";

interface Props {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
}

export function Sparkline({
  values,
  width = 320,
  height = 80,
  stroke = "var(--accent)",
  fill = "rgba(34, 197, 94, 0.14)"
}: Props) {
  const { path, area, min, max } = useMemo(() => {
    if (values.length < 2) {
      return { path: "", area: "", min: 0, max: 0 };
    }
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const range = hi - lo || hi || 1;
    const stepX = width / (values.length - 1);
    const points = values.map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - lo) / range) * (height - 4) - 2;
      return [x, y] as const;
    });
    const linePath = points
      .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`)
      .join(" ");
    const areaPath = `${linePath} L${points[points.length - 1][0].toFixed(
      2
    )} ${height} L0 ${height} Z`;
    return { path: linePath, area: areaPath, min: lo, max: hi };
  }, [values, width, height]);

  if (!path) {
    return (
      <div className="sparkline-empty muted small">
        Not enough samples yet — collecting price history…
      </div>
    );
  }

  const last = values[values.length - 1];
  const first = values[0];
  const change = first > 0 ? ((last - first) / first) * 100 : 0;
  const changeColor = change >= 0 ? "var(--success)" : "var(--danger)";

  return (
    <div className="sparkline">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        style={{ display: "block" }}
      >
        <path d={area} fill={fill} />
        <path d={path} stroke={stroke} strokeWidth={1.5} fill="none" />
      </svg>
      <div className="sparkline-foot">
        <span className="muted small">low {formatTick(min)}</span>
        <span className="small" style={{ color: changeColor }}>
          {change >= 0 ? "+" : ""}
          {change.toFixed(2)}%
        </span>
        <span className="muted small">high {formatTick(max)}</span>
      </div>
    </div>
  );
}

function formatTick(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (abs >= 1) return value.toFixed(4);
  if (abs >= 0.0001) return value.toFixed(6);
  return value.toExponential(2);
}
