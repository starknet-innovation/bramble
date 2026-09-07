/**
 * Immutable approval-context binding. Security-sensitive approvals carry the
 * exact account, network, chain, and a SHA-256 digest of the private execution
 * payload that was reviewed.
 */
import { WalletError } from "@bramble/core/errors";
import { bytesToHex } from "@bramble/core/hex";
import { JSON_BUDGETS, type Json, normalizeFeltBigints } from "@bramble/core/json";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { ApprovalContext } from "@bramble/wallet-protocol/extension-responses";

/**
 * Exact account, network, chain, and payload digest frozen into an approval.
 */
export type { ApprovalContext } from "@bramble/wallet-protocol/extension-responses";

const canonicalJson = (value: Json): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Readonly<Record<string, Json>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key] ?? null)}`)
    .join(",")}}`;
};

/**
 * Computes a deterministic SHA-256 digest after bounded, accessor-safe JSON
 * normalization. Invalid, cyclic, or over-budget payloads fail closed.
 */
export const digestApprovalPayload = async (payload: unknown): Promise<string> => {
  const normalized = normalizeFeltBigints(payload, JSON_BUDGETS.contractClass);
  if (normalized === undefined) {
    throw new WalletError("Invalid approval payload");
  }
  const bytes = new TextEncoder().encode(canonicalJson(normalized));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${bytesToHex(new Uint8Array(digest))}`;
};

/**
 * Creates the account/network/chain binding for a private approval payload.
 */
export const createApprovalContext = async (
  account: Pick<AccountRef, "id" | "networkId">,
  payload: unknown,
): Promise<ApprovalContext> => ({
  accountId: account.id,
  chainId: STARKNET_NETWORKS[account.networkId].chainId,
  networkId: account.networkId,
  payloadDigest: await digestApprovalPayload(payload),
});

/**
 * Recomputes and constant-shape compares the held payload with its review
 * context. A malformed payload returns false instead of reaching execution.
 */
export const approvalPayloadMatchesContext = async (
  context: ApprovalContext,
  payload: unknown,
): Promise<boolean> => {
  try {
    return (await digestApprovalPayload(payload)) === context.payloadDigest;
  } catch {
    return false;
  }
};
