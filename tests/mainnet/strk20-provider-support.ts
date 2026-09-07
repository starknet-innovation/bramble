/**
 * Provider-wire helpers for the opt-in STRK20 mainnet lifecycle. Diagnostics
 * retain only RPC method names and proof presence/counts, never proof contents.
 */
import type { Page, Request } from "@playwright/test";

const TRANSACTION_HASH = /^0x0[0-8][0-9a-f]{62}$/;

/** Minimal page-facing wallet request accepted by the live dapp. */
export type LiveProviderRequest = {
  readonly params?: unknown;
  readonly type: string;
};

/**
 * Returns a non-secret summary of a proxied Starknet RPC request. Proof data,
 * calldata, signatures, values, and endpoints are never returned.
 */
export const proofEnvelopeSummary = (request: Request): string | null => {
  if (request.method() !== "POST" || !request.url().includes("/strk20-e2e/rpc/")) {
    return null;
  }
  try {
    const body = request.postDataJSON() as {
      readonly method?: unknown;
      readonly params?: {
        readonly invoke_transaction?: {
          readonly proof?: unknown;
          readonly proof_facts?: unknown;
        };
        readonly request?: readonly {
          readonly proof?: unknown;
          readonly proof_facts?: unknown;
        }[];
      };
    };
    if (typeof body.method !== "string" || !body.method.startsWith("starknet_")) {
      return null;
    }
    const transactions = body.params?.request
      ? body.params.request
      : body.params?.invoke_transaction
        ? [body.params.invoke_transaction]
        : [];
    const summaries = transactions.map((transaction) => {
      const facts = Array.isArray(transaction.proof_facts) ? transaction.proof_facts.length : 0;
      const proof = typeof transaction.proof === "string" && transaction.proof.length > 0;
      return `proof=${proof ? "yes" : "no"} facts=${facts}`;
    });
    return `${body.method} ${summaries.length === 0 ? "transaction=n/a" : summaries.join("/")}`;
  } catch {
    return null;
  }
};

/** Sends one request through the injected provider and preserves safe error data. */
export const requestLiveProvider = (page: Page, request: LiveProviderRequest): Promise<unknown> =>
  page.evaluate(async (input) => {
    const wallet = (
      globalThis as typeof globalThis & {
        readonly starknet_bramble?: {
          readonly request: (value: LiveProviderRequest) => Promise<unknown>;
        };
      }
    ).starknet_bramble;
    if (!wallet) {
      throw new Error("Bramble provider unavailable");
    }
    try {
      return await wallet.request(input);
    } catch (error) {
      const detail = (error as { readonly data?: unknown } | null)?.data;
      throw new Error(
        typeof detail === "string"
          ? detail
          : error instanceof Error
            ? error.message
            : "request failed",
      );
    }
  }, request);

/** Connects the live dapp to the extension's injected provider. */
export const connectLiveProvider = (page: Page): Promise<readonly string[]> =>
  page.evaluate(async () => {
    const wallet = (
      globalThis as typeof globalThis & {
        readonly starknet_bramble?: { readonly enable: () => Promise<readonly string[]> };
      }
    ).starknet_bramble;
    if (!wallet) {
      throw new Error("Bramble provider unavailable");
    }
    return wallet.enable();
  });

/** Reads a canonical Starknet transaction hash from a provider result. */
export const liveTransactionHash = (result: unknown): string => {
  if (
    typeof result !== "object" ||
    result === null ||
    !("transaction_hash" in result) ||
    typeof result.transaction_hash !== "string" ||
    !TRANSACTION_HASH.test(result.transaction_hash)
  ) {
    throw new Error("Wallet returned an invalid transaction result");
  }
  return result.transaction_hash;
};
