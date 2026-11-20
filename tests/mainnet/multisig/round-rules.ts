/**
 * Pure rules of the multisig privacy round: which wallet refusals a lagging
 * RPC node explains, and the canonical STRK transfer the sweep sends. Kept
 * apart from the browser driver and the chain helpers so offline unit tests
 * load no live-only code.
 */
import { isRecord } from "@bramble/core/json";
import { buildErc20TransferCall, formatTokenAmount } from "@bramble/starknet/rpc";
import {
  canonicalFelt,
  STRK_TOKEN_ADDRESS,
  STRK_TOKEN_DECIMALS,
} from "@bramble/wallet-model/networks";
import { num } from "starknet";

/** A background message: its type and whatever fields that type takes. */
export type WalletMessage = Readonly<Record<string, unknown>> & { readonly type: string };

// A pinned read a lagging node could not answer, and the wallet's wording for
// a signer-set read that failed the same way right after a deploy.
const LAGGING_NODE = /Block not found|signers aren't available yet/;
// Messages that broadcast. They are never repeated by this helper, though the
// wallet guards each against sending twice.
const BROADCASTS: ReadonlySet<string> = new Set([
  "wallet.deployArgentMultisig",
  "wallet.submitArgentMultisigIntent",
  "wallet.submitArgentMultisigStrk20Relay",
]);

/**
 * True when `reply` is a read a lagging node could not answer (a JSON-RPC 24,
 * "Block not found", or a signer set not yet readable) for a message that
 * does not broadcast. The shared RPC load-balances across nodes that can be a
 * block apart; the wallet re-pins three times, and a round makes enough pinned
 * reads that a short lag can still exhaust them. The read failed before the
 * message acted, so asking again is safe.
 */
export const isLaggingNode = (message: WalletMessage, reply: unknown): boolean => {
  const refusal = walletRefusal(reply);
  return refusal !== null && !BROADCASTS.has(message.type) && LAGGING_NODE.test(refusal);
};

/** The refusal text of a wallet reply, or null when the reply is not one. */
export const walletRefusal = (reply: unknown): string | null =>
  isRecord(reply) && typeof reply["error"] === "string" ? reply["error"] : null;

/** A call in the canonical shape the wallet freezes into a multisig transaction. */
export type CanonicalCall = {
  readonly calldata: readonly string[];
  readonly contractAddress: string;
  readonly entrypoint: string;
};

const canonical = (value: unknown): string => {
  const felt = canonicalFelt(num.toHex(value as Parameters<typeof num.toHex>[0]));
  if (felt === null) {
    throw new Error("A call field is not a felt.");
  }
  return felt;
};

/** One STRK transfer of `amount` FRI to `recipient`, with canonical felts. */
export const strkTransferCall = (recipient: string, amount: bigint): CanonicalCall => {
  const call = buildErc20TransferCall(STRK_TOKEN_ADDRESS, recipient, amount);
  return {
    calldata: (call.calldata as readonly unknown[]).map(canonical),
    contractAddress: canonical(call.contractAddress),
    entrypoint: call.entrypoint,
  };
};

/** STRK in FRI as the decimal figure a person would read. */
export const strkLabel = (raw: bigint): string => formatTokenAmount(raw, STRK_TOKEN_DECIMALS);
