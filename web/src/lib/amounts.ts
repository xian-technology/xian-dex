import { fixed } from "@xian-tech/client";
import { fixedText, fixedUnits, minimumAmountOutV2 } from "@xian-tech/dex";

const SCALE = 10n ** 30n;

/** Decode V2 RPC balances without allowing a binary float into a transaction. */
export function chainAmount(value: unknown): string {
  if (value == null) return "0";
  if (typeof value === "string") return fixed(value).__fixed__;
  if (typeof value === "bigint" || Number.isSafeInteger(value)) {
    return fixed(String(value)).__fixed__;
  }
  throw new TypeError("Expected an exact chain amount");
}

/** Return the canonical positive input only when its token supports every digit. */
export function positiveAmount(text: string, precision?: number | null): string | null {
  try {
    const amount = fixed(text).__fixed__;
    if (fixedUnits(amount) > 0n && minimumAmountOutV2(amount, 0, precision ?? 30) === amount) {
      return amount;
    }
  } catch {
    // An input can be incomplete while the user is editing it.
  }
  return null;
}

/** Mirror the VM's fixed multiplication, division, and final token quantization. */
export function proportionalAmount(
  amount: string, reserve: string, total: string, precision?: number | null
): string | null {
  const denominator = fixedUnits(total);
  if (!denominator) return null;
  try {
    const product = fixedText(fixedUnits(amount) * fixedUnits(reserve) / SCALE);
    const result = fixedText(fixedUnits(product) * SCALE / denominator);
    return minimumAmountOutV2(result, 0, precision ?? 30);
  } catch {
    return null;
  }
}

/** Rates may exceed the VM amount range, so keep the integer part unbounded for display. */
export function displayRate(output: string, input: string): string {
  const out = fixedUnits(output);
  const amount = fixedUnits(input);
  if (amount <= 0n) return "—";
  const units = out * SCALE / amount;
  if (out && !units) return "< 1e-30";
  const whole = units / SCALE;
  const fraction = (units % SCALE).toString().padStart(30, "0").replace(/0+$/, "");
  return fraction ? whole + "." + fraction : String(whole);
}

/** Round a percent to the nearest basis point. Ties round up. */
export function slippageBpsFromPercent(text: string): number | null {
  try {
    const percent = fixedUnits(text);
    if (percent >= 0n && percent <= 50n * SCALE) {
      return Number((percent * 100n + SCALE / 2n) / SCALE);
    }
  } catch {
    // Keep the previous setting while editing incomplete or invalid text.
  }
  return null;
}
