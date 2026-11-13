import { txFailureText } from "@xian-tech/web-kit";

/**
 * The message to show for a failed transaction. web-kit explains an
 * "Out of chi." failure (the state changed between the exact chi estimate
 * and execution); other failures pass through.
 */
export function txFailureMessage(failure: unknown): string {
  return txFailureText(failure instanceof Error ? failure.message : String(failure));
}
