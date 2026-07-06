import {
  copyToClipboard,
  shortAddress as sharedShortAddress,
  toNumber
} from "@xian-tech/web-kit";

export function shortAddress(addr: string | null | undefined, chars = 6): string {
  return sharedShortAddress(addr, chars, chars);
}

export { copyToClipboard, toNumber };

const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });

export function formatCompact(value: number | string | bigint): string {
  const n = toNumber(value);
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) < 1000) return formatNumber(n, 4);
  return COMPACT.format(n);
}

export function formatNumber(value: number | string | bigint, maxDecimals = 6): string {
  const n = toNumber(value);
  if (!Number.isFinite(n)) return "0";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  const decimals =
    abs >= 1000
      ? Math.min(2, maxDecimals)
      : abs >= 1
        ? Math.min(4, maxDecimals)
        : abs >= 0.0001
          ? Math.min(6, maxDecimals)
          : Math.min(8, maxDecimals);
  return n.toLocaleString("en-US", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0
  });
}

/**
 * Plain decimal string (no grouping separators, no exponent) that survives
 * Number() re-parsing — required for anything written into an amount input.
 * formatNumber() is display-only: its locale grouping ("1,234.5") parses to NaN.
 *
 * Truncates instead of rounding: a "Max" value that rounded up past the real
 * balance would fail the balance check it was meant to satisfy.
 */
export function toDecimalInput(value: number | string | bigint, maxDecimals = 8): string {
  const n = toNumber(value);
  if (!Number.isFinite(n) || n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e21) {
    // toFixed switches to exponent notation up here; integers only.
    return n.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 0 });
  }
  // Below 1, extend precision so leading zeros don't swallow small amounts.
  const places =
    abs >= 1
      ? maxDecimals
      : Math.min(18, maxDecimals + Math.max(0, -Math.floor(Math.log10(abs))));
  let fixed = n.toFixed(18);
  const dot = fixed.indexOf(".");
  if (dot !== -1) {
    fixed = fixed
      .slice(0, dot + 1 + places)
      .replace(/0+$/, "")
      .replace(/\.$/, "");
  }
  return fixed === "" || fixed === "-" ? "0" : fixed;
}

/**
 * Fixed-width price rendering for charts and tickers: constant decimal
 * counts per magnitude band keep axis labels and OHLC readouts from
 * jittering as values tick, unlike formatNumber which trims zeros.
 */
export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (abs >= 1) return value.toFixed(4);
  if (abs >= 0.0001) return value.toFixed(6);
  return value.toExponential(2);
}

export function formatPercent(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

export function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

export function isValidContractName(name: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]*$/.test(name);
}

export function formatAge(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
