import { useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
  LineStyle,
  TickMarkType,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type UTCTimestamp
} from "lightweight-charts";

import type { Candle } from "../lib/candles";
import { formatCompact, formatPrice } from "../lib/format";

interface Props {
  candles: Candle[];
  // Identity of the series (pair + interval + orientation + RPC). When it
  // changes the chart is rebuilt and re-fitted; while it is stable, new
  // data is applied as incremental tail updates so the viewport and the
  // open candle animate in place instead of flickering through setData.
  datasetKey: string;
  loading: boolean;
  error: boolean;
  baseSymbol: string;
}

const INITIAL_BARS = 120; // default zoom: most recent bars
const RIGHT_PAD_BARS = 5;

function cssColor(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function formatLegendTime(time: number): string {
  return new Date(time * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

// The chart engine renders timestamps as UTC; format tick marks and the
// crosshair label in the viewer's local time instead of shifting the data.
function tickMarkFormatter(time: UTCTimestamp, type: TickMarkType): string {
  const d = new Date((time as number) * 1000);
  switch (type) {
    case TickMarkType.Year:
      return d.toLocaleDateString("en-US", { year: "numeric" });
    case TickMarkType.Month:
      return d.toLocaleDateString("en-US", { month: "short" });
    case TickMarkType.DayOfMonth:
      return d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
    default:
      return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
}

interface HoverBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function CandleChart({ candles, datasetKey, loading, error, baseSymbol }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const appliedRef = useRef<{ key: string; first: number; last: number } | null>(null);
  const [hover, setHover] = useState<HoverBar | null>(null);

  const palette = useMemo(
    () => ({
      up: cssColor("--success", "#22c55e"),
      down: cssColor("--danger", "#ff4d6d"),
      text: cssColor("--muted", "#767889"),
      grid: "rgba(255, 255, 255, 0.045)",
      crosshair: "rgba(255, 255, 255, 0.25)",
      crosshairLabel: cssColor("--bg-3", "#1d1d2c"),
      font: getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim()
    }),
    []
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: palette.text,
        fontFamily: palette.font || undefined,
        fontSize: 11
      },
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid }
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: palette.crosshair,
          style: LineStyle.Dashed,
          labelBackgroundColor: palette.crosshairLabel
        },
        horzLine: {
          color: palette.crosshair,
          style: LineStyle.Dashed,
          labelBackgroundColor: palette.crosshairLabel
        }
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.08, bottom: 0.24 }
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: RIGHT_PAD_BARS,
        tickMarkFormatter
      },
      localization: {
        priceFormatter: formatPrice,
        timeFormatter: (time: UTCTimestamp) => formatLegendTime(time as number)
      },
      // Inertia when dragging the tape — panning glides to a stop.
      kineticScroll: { mouse: true, touch: true }
    });

    const priceSeries = chart.addSeries(CandlestickSeries, {
      upColor: palette.up,
      downColor: palette.down,
      borderUpColor: palette.up,
      borderDownColor: palette.down,
      wickUpColor: withAlpha(palette.up, 0.7),
      wickDownColor: withAlpha(palette.down, 0.7),
      priceFormat: { type: "custom", formatter: formatPrice, minMove: 1e-8 }
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 }
    });

    const onCrosshair = (param: MouseEventParams) => {
      if (param.time == null) {
        setHover(null);
        return;
      }
      const bar = param.seriesData.get(priceSeries) as CandlestickData | undefined;
      if (!bar) {
        setHover(null);
        return;
      }
      const vol = param.seriesData.get(volumeSeries) as HistogramData | undefined;
      setHover({
        time: bar.time as number,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: vol?.value ?? 0
      });
    };
    chart.subscribeCrosshairMove(onCrosshair);

    chartRef.current = chart;
    priceSeriesRef.current = priceSeries;
    volumeSeriesRef.current = volumeSeries;
    appliedRef.current = null;

    return () => {
      chart.unsubscribeCrosshairMove(onCrosshair);
      chart.remove();
      chartRef.current = null;
      priceSeriesRef.current = null;
      volumeSeriesRef.current = null;
      appliedRef.current = null;
    };
  }, [palette]);

  useEffect(() => {
    const chart = chartRef.current;
    const priceSeries = priceSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !priceSeries || !volumeSeries) return;

    const toBar = (c: Candle): CandlestickData => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    });
    const toVolume = (c: Candle): HistogramData => ({
      time: c.time as UTCTimestamp,
      value: c.volumeBase,
      color: withAlpha(c.close >= c.open ? palette.up : palette.down, 0.32)
    });

    const first = candles[0]?.time ?? 0;
    const last = candles[candles.length - 1]?.time ?? 0;
    const applied = appliedRef.current;
    const continuation =
      applied != null &&
      applied.key === datasetKey &&
      candles.length > 0 &&
      applied.last > 0 &&
      first === applied.first &&
      last >= applied.last;

    if (continuation) {
      for (const c of candles) {
        if (c.time < applied.last) continue;
        priceSeries.update(toBar(c));
        volumeSeries.update(toVolume(c));
      }
    } else {
      priceSeries.setData(candles.map(toBar));
      volumeSeries.setData(candles.map(toVolume));
      if (candles.length > INITIAL_BARS) {
        chart.timeScale().setVisibleLogicalRange({
          from: candles.length - INITIAL_BARS,
          to: candles.length + RIGHT_PAD_BARS
        });
      } else {
        chart.timeScale().fitContent();
      }
      setHover(null);
    }
    appliedRef.current = { key: datasetKey, first, last };
  }, [candles, datasetKey, palette]);

  const lastCandle = candles.length > 0 ? candles[candles.length - 1] : null;
  const legend: HoverBar | null =
    hover ??
    (lastCandle && {
      time: lastCandle.time,
      open: lastCandle.open,
      high: lastCandle.high,
      low: lastCandle.low,
      close: lastCandle.close,
      volume: lastCandle.volumeBase
    });
  const legendUp = legend != null && legend.close >= legend.open;
  const legendChange =
    legend != null && legend.open > 0 ? ((legend.close - legend.open) / legend.open) * 100 : 0;

  return (
    <div className="candle-chart">
      <div ref={containerRef} className="candle-chart-canvas" />
      {legend && (
        <div className="candle-legend mono">
          <span className="candle-legend-time">{formatLegendTime(legend.time)}</span>
          <span>
            O <b style={{ color: legendUp ? palette.up : palette.down }}>{formatPrice(legend.open)}</b>
          </span>
          <span>
            H <b style={{ color: legendUp ? palette.up : palette.down }}>{formatPrice(legend.high)}</b>
          </span>
          <span>
            L <b style={{ color: legendUp ? palette.up : palette.down }}>{formatPrice(legend.low)}</b>
          </span>
          <span>
            C <b style={{ color: legendUp ? palette.up : palette.down }}>{formatPrice(legend.close)}</b>
          </span>
          <span style={{ color: legendUp ? palette.up : palette.down }}>
            {legendChange >= 0 ? "+" : ""}
            {legendChange.toFixed(2)}%
          </span>
          <span className="candle-legend-vol">
            Vol {formatCompact(legend.volume)} {baseSymbol}
          </span>
        </div>
      )}
      {candles.length === 0 && (
        <div className="candle-chart-overlay muted small">
          {loading
            ? "Loading price history…"
            : error
              ? "Price history is unavailable on this RPC endpoint."
              : "No trades yet — candles appear after the first swap."}
        </div>
      )}
    </div>
  );
}
