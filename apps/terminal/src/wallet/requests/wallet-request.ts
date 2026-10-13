import { type Call, CallData } from "starknet";
import { WalletError } from "../../protocols/support/errors";
import { userErrorMessage } from "../../protocols/support/user-error";

/** A concise fact shown before the terminal hands a request to the wallet. */
type WalletRequestDetail = {
  readonly label: string;
  readonly value: string;
};

/** User-facing context for an executable Starknet transaction. */
export type WalletTransactionRequest = {
  readonly calls: readonly Call[];
  readonly description: string;
  readonly details?: readonly WalletRequestDetail[];
  /**
   * Re-verifies the call targets immediately before each wallet handoff,
   * including a retry. Discovery state read at quote time can go stale while
   * the user reviews, so a rejection here stops the request before the wallet
   * sees it; the thrown message is shown as the request's failure.
   */
  readonly handoffCheck?: () => Promise<void>;
  /**
   * `terminal` adds a second confirmation before opening the wallet. Use
   * `wallet` only when the initiating screen already presents the material
   * transaction facts and the connected wallet is the canonical review.
   */
  readonly reviewMode?: "terminal" | "wallet";
  readonly title: string;
  readonly warning?: string;
};

export type WalletRequestPreview = {
  readonly callCount?: number;
  readonly description: string;
  readonly details: readonly WalletRequestDetail[];
  readonly kind: "declaration" | "transaction";
  readonly title: string;
  readonly warning?: string;
};

export type WalletRequestView =
  | { readonly phase: "review"; readonly preview: WalletRequestPreview }
  | { readonly phase: "awaiting"; readonly preview: WalletRequestPreview }
  | {
      readonly phase: "failed";
      readonly preview: WalletRequestPreview;
      readonly message: string;
    }
  | {
      readonly phase: "submitted";
      readonly preview: WalletRequestPreview;
      readonly transactionHash: string;
    };

/**
 * Converts starknet.js calls to the wallet RPC's spec-shaped JSON payload.
 *
 * `CallData.compile()` arrays carry an enumerable `__compiled__` marker. Copying
 * each calldata array here removes that non-JSON property before the injected
 * provider applies its strict trust-boundary validation.
 */
export const walletInvokeParams = (
  calls: readonly Call[],
): {
  readonly invoke_transaction: readonly {
    readonly calldata: readonly string[];
    readonly contract_address: string;
    readonly entry_point: string;
  }[];
} => ({
  invoke_transaction: calls.map((call) => ({
    calldata: Array.from(CallData.compile(call.calldata ?? [])),
    contract_address: call.contractAddress,
    entry_point: call.entrypoint,
  })),
});

/** Extracts a submitted transaction hash without trusting the wallet response shape. */
export const walletTransactionHash = (value: unknown): string | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const hash = (value as Record<string, unknown>)["transaction_hash"];
  return typeof hash === "string" && hash.length > 0 ? hash : null;
};

/**
 * Turns wallet/provider failures into calm, actionable terminal copy.
 *
 * Only an error the wallet raised can be a decline. A `WalletError` is the
 * terminal's own (a handoff re-check, a price-anchor refusal), so it is never
 * read for decline words: a check that "refused" a route must not be reported
 * as the reader declining in the wallet. Everything else goes through
 * `userErrorMessage`, which keeps wallet and fact messages and hides plumbing.
 */
export const walletRequestError = (cause: unknown): string => {
  const fallback = "The wallet could not complete this request. You can safely try again.";
  if (!(cause instanceof WalletError)) {
    const message = cause instanceof Error ? cause.message : "";
    const code = (cause as { readonly code?: unknown } | null | undefined)?.code;
    if (code === 113 || /reject|denied|refus|cancel/i.test(message)) {
      return "The request was declined in the wallet. Nothing was submitted.";
    }
  }
  return userErrorMessage(cause, fallback);
};
