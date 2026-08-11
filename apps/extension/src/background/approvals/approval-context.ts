/**
 * Immutable approval-context binding. Security-sensitive approvals carry the
 * exact account, network, chain, and a SHA-256 digest of the private execution
 * payload that was reviewed.
 */
import { WalletError } from "@mc-wallet/core/errors";
import { JSON_BUDGETS, type Json, normalizeFeltBigints } from "@mc-wallet/core/json";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { STARKNET_NETWORKS, type StarknetNetworkId } from "@mc-wallet/wallet-model/networks";

/**
 * Exact wallet and payload context attached to a security-sensitive approval.
 */
export type ApprovalContext = {
  readonly accountId: string;
  readonly chainId: string;
  readonly networkId: StarknetNetworkId;
  readonly payloadDigest: string;
};

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

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

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
  return `sha256:${toHex(new Uint8Array(digest))}`;
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
