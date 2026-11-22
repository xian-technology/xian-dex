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
  type LogicalRange,
  type MouseEventParams,
  type UTCTimestamp,
  type WhitespaceData
} from "lightweight-charts";

import { candleTimeline, prependRange, type Candle, type CandlePoint } from "../lib/candles";
import { formatCompact, formatPrice } from "../lib/format";

interface Props {
  candles: Candle[];
  // Pair, interval, orientation and RPC identify the series.
  datasetKey: string;
  interval: number;
  loading: boolean;
  error: boolean;
  baseSymbol: string;
  onLoadOlder: () => void;
}

const INITIAL_BARS = 120; // default zoom: most recent bars
const LOAD_OLDER_THRESHOLD = 12;
const RIGHT_PAD_BARS = 5;
const PRICE_SCALE_TOP_MARGIN = 0.08;
const PRICE_SCALE_MAX_BOTTOM_MARGIN = 0.24;

function priceScaleBottomMargin(candles: Candle[]): number {
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  for (const candle of candles) {
    min = Math.min(min, candle.low);
    max = Math.max(max, candle.high);
  }
  if (!Number.isFinite(min) || min <= 0 || max <= 0) {
    return 0;
  }

  // Price-scale margins extend the numerical range as well as the pixels.
  // Cap the lower padding before it can cross zero on a steep sell-off.
  const zeroSafeMargin = (min * (1 - PRICE_SCALE_TOP_MARGIN)) / max;
  return Math.min(PRICE_SCALE_MAX_BOTTOM_MARGIN, zeroSafeMargin * 0.9);
}

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

export function formatCandleTime(time: number, showSeconds = false): string {
  return new Date(time * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: showSeconds ? "2-digit" : undefined,
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

export function CandleChart({
  candles, datasetKey, interval, loading, error, baseSymbol, onLoadOlder
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const appliedRef = useRef<{ key: string; first: number; last: number } | null>(null);
  const [hover, setHover] = useState<HoverBar | "gap" | null>(null);
  const points = useMemo(() => candleTimeline(candles, interval), [candles, interval]);

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
        scaleMargins: {
          top: PRICE_SCALE_TOP_MARGIN,
          bottom: PRICE_SCALE_MAX_BOTTOM_MARGIN
        }
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
        timeFormatter: (time: UTCTimestamp) => formatCandleTime(time as number)
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
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
      visible: false,
      borderVisible: false,
      ticksVisible: false
    });

    const onCrosshair = (param: MouseEventParams) => {
      if (param.time == null) {
        setHover(null);
        return;
      }
      const bar = param.seriesData.get(priceSeries) as CandlestickData | WhitespaceData | undefined;
      if (!bar || !("open" in bar)) {
        setHover("gap");
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

    chart.priceScale("right").applyOptions({
      scaleMargins: {
        top: PRICE_SCALE_TOP_MARGIN,
        bottom: priceScaleBottomMargin(candles)
      }
    });

    const toBar = (point: CandlePoint): CandlestickData | WhitespaceData => {
      const time = point.time as UTCTimestamp;
      return "open" in point
        ? { time, open: point.open, high: point.high, low: point.low, close: point.close }
        : { time };
    };
    const toVolume = (point: CandlePoint): HistogramData | WhitespaceData => {
      const time = point.time as UTCTimestamp;
      return "open" in point
        ? { time, value: point.volumeBase, color: withAlpha(point.close >= point.open ? palette.up : palette.down, 0.32) }
        : { time };
    };

    const first = points[0]?.time;
    const last = points.at(-1)?.time;
    const applied = appliedRef.current;
    const sameDataset = applied?.key === datasetKey;
    if (sameDataset && first === applied.first && last !== undefined && last >= applied.last) {
      for (const point of points) {
        if (point.time < applied.last) continue;
        priceSeries.update(toBar(point));
        volumeSeries.update(toVolume(point));
      }
    } else {
      const scale = chart.timeScale();
      const range = sameDataset ? scale.getVisibleLogicalRange() : null;
      priceSeries.setData(points.map(toBar));
      volumeSeries.setData(points.map(toVolume));
      if (range && applied) {
        scale.setVisibleLogicalRange(prependRange(points, applied.first, range));
      } else if (points.length > INITIAL_BARS) {
        scale.setVisibleLogicalRange({
          from: points.length - INITIAL_BARS,
          to: points.length + RIGHT_PAD_BARS
        });
      } else {
        scale.fitContent();
      }
      setHover(null);
    }
    appliedRef.current = first !== undefined && last !== undefined ? { key: datasetKey, first, last } : null;
  }, [candles, datasetKey, palette, points]);

  useEffect(() => {
    const scale = chartRef.current?.timeScale();
    if (!scale) return;
    let previous = scale.getVisibleLogicalRange()?.from;
    function onRange(range: LogicalRange | null) {
      const from = range?.from;
      const movedLeft = from != null && previous != null && from < previous;
      previous = from;
      if (movedLeft && from <= LOAD_OLDER_THRESHOLD) onLoadOlder();
    }
    scale.subscribeVisibleLogicalRangeChange(onRange);
    return () => scale.unsubscribeVisibleLogicalRangeChange(onRange);
  }, [datasetKey, onLoadOlder]);

  const lastCandle = candles.length > 0 ? candles[candles.length - 1] : null;
  const legend = hover === "gap" ? null :
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
          <span className="candle-legend-time">{formatCandleTime(legend.time)}</span>
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
      {hover === "gap" && <div className="candle-legend muted">No trades in this gap</div>}
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
