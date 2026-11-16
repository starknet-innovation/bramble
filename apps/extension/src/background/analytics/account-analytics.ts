/** Request-bound account pseudonyms. No active-account fallback or secret material. */
import { isRecord } from "@bramble/core/json";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { canonicalFelt } from "@bramble/wallet-model/networks";

/** Public inventory projected inside the background; absent provenance stays unknown. */
export type AnalyticsAccounts = {
  readonly accounts: readonly AccountRef[];
  readonly provenance: Readonly<Record<string, "created" | "imported">>;
};

/** Bounded account metadata accepted by the gateway. Never used for authorization. */
export type AccountAnalytics = {
  readonly id: string;
  readonly provenance: "created" | "imported" | "unknown";
};

const field = (value: unknown, key: string): unknown => (isRecord(value) ? value[key] : undefined);
const felt = (value: unknown): string | null =>
  typeof value === "string" ? canonicalFelt(value) : null;
const firstParam = (params: unknown): unknown => (Array.isArray(params) ? params[0] : params);
// ERC20 balanceOf's sole argument is the owner; other calldata can contain recipients.
const BALANCE_OF = "0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e89";
const callSubject = (params: unknown): unknown => {
  const call = Array.isArray(params) ? params[0] : field(params, "request");
  const calldata = field(call, "calldata");
  if (
    felt(field(call, "entry_point_selector")) === BALANCE_OF &&
    Array.isArray(calldata) &&
    calldata.length === 1
  )
    return calldata[0];
  return field(call, "contract_address");
};
const paymasterSubject = (params: unknown): unknown => {
  const transaction = field(firstParam(params), "transaction");
  return (
    field(field(transaction, "invoke"), "user_address") ??
    field(field(transaction, "deployment"), "address")
  );
};
const subject = (request: unknown): unknown => {
  const params = field(request, "params");
  switch (field(request, "method")) {
    case "starknet_getNonce":
    case "starknet_getClassHashAt":
      return Array.isArray(params) ? params[1] : field(params, "contract_address");
    case "starknet_call":
      return callSubject(params);
    case "starknet_addInvokeTransaction": {
      const first = firstParam(params);
      return field(field(first, "invoke_transaction") ?? first, "sender_address");
    }
    case "paymaster_buildTransaction":
    case "paymaster_executeTransaction":
      return paymasterSubject(params);
    default:
      return null;
  }
};

const requestBody = async (input: RequestInfo | URL, init?: RequestInit): Promise<unknown> => {
  const body = init?.body ?? (input instanceof Request ? await input.clone().text() : null);
  if (typeof body !== "string" || body.length > 1_048_576) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
};

const rpcAccount = async (
  inventory: AnalyticsAccounts,
  url: URL,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<AccountRef | undefined> => {
  const network = /\/(mainnet|sepolia)(?:\/|$)/.exec(url.pathname)?.[1];
  const networkId =
    network === "mainnet" ? "SN_MAIN" : network === "sepolia" ? "SN_SEPOLIA" : undefined;
  if (networkId === undefined) return undefined;
  const decoded = await requestBody(input, init);
  const requests: readonly unknown[] = Array.isArray(decoded) ? decoded : [decoded];
  const resolved = requests.map(subject).map(felt);
  // One unresolved member makes the whole batch's account context ambiguous.
  if (resolved.length === 0 || resolved.includes(null)) return undefined;
  const subjects = new Set(resolved);
  if (subjects.size !== 1) return undefined;
  return inventory.accounts.find(
    (entry) => entry.networkId === networkId && subjects.has(entry.address),
  );
};

/**
 * Resolves one owned request subject. Opaque SDK traffic has no transport-bound
 * account context; it is always omitted, including after timed-out operations.
 */
export const requestAccountAnalytics = async (
  inventory: AnalyticsAccounts,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<AccountAnalytics | null> => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.pathname === "/api/strk20" || url.pathname.startsWith("/api/strk20/")) return null;
  const account = await rpcAccount(inventory, url, input, init);
  if (account === undefined) return null;
  const identity = new TextEncoder().encode(
    `mc-account:v1:${account.networkId}:${account.address}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", identity);
  return {
    id: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    provenance: inventory.provenance[account.id] ?? "unknown",
  };
};
