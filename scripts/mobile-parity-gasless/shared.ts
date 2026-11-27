/**
 * Inputs every gasless block shares: the made-up accounts, the tracked mainnet tokens, the pinned
 * mainnet forwarder, a fixed clock, the gateway's typed data as starknet.js builds it, and a
 * scripted paymaster transport that records what the extension posted.
 */
import { GASLESS_FORWARDER_ADDRESS } from "@bramble/transactions/gasless-config";
import { GASLESS_RPC_ID } from "@bramble/transactions/gasless-rpc";
import { ARGENT_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/account-families";
import { DEFAULT_TRACKED_TOKENS } from "@bramble/wallet-model/networks";
import { type Call, OutsideExecutionVersion, outsideExecution } from "starknet";

const tracked = (symbol: string): string => {
  const found = DEFAULT_TRACKED_TOKENS.find(
    (token) => token.networkId === "SN_MAIN" && token.symbol === symbol,
  );
  if (!found) throw new Error(`no tracked mainnet ${symbol}`);
  return found.address;
};

/** Tracked mainnet token addresses, as the registry spells them (padded). */
export const USDC = tracked("USDC");
export const ETH = tracked("ETH");
export const STRK = tracked("STRK");

/** The pinned mainnet forwarder (`GASLESS_FORWARDER_ADDRESS`). */
export const FORWARDER = GASLESS_FORWARDER_ADDRESS.SN_MAIN ?? "";

/** A made-up forwarder for a Sepolia test route; the shipped Sepolia route has none. */
export const SEPOLIA_TEST_FORWARDER =
  "0x6f1e2d3c4b5a69788796a5b4c3d2e1f00112233445566778899aabbccddeeff";

/** A made-up Argent 0.4 account, deployed. */
export const ACCOUNT = "0x5dccf9cfdcabb9e4ef45814bda1b056bb23063d0e9b64e5a845e9dfb3d23f10";
export const ARGENT_ACCOUNT = {
  accountContractType: "argent" as const,
  address: ACCOUNT,
  classHash: ARGENT_ACCOUNT_CLASS_HASH,
  deployed: true,
};

/** A made-up payee. */
export const RECIPIENT = "0x5ef2de1a7ccc0e9ef8d1a1e6e9c4c2b5d6a7f8e9d0c1b2a3f4e5d6c7b8a9f01";

/** The fixed clock, unix seconds. */
export const NOW = 1_790_000_000;

/** The largest Stark field element, P - 1. */
export const MAX_FELT = `0x${(2n ** 251n + 17n * 2n ** 192n).toString(16)}`;

/** The gateway's `execute_before` for a build asked at {@link NOW}: the full ten minutes. */
const BEFORE = `0x${(NOW + 600).toString(16)}`;

/** A user's USDC transfer of `amount` base units to {@link RECIPIENT}. */
export const usdcTransfer = (amount = "0x10"): Call => ({
  calldata: [RECIPIENT, amount, "0x0"],
  contractAddress: USDC,
  entrypoint: "transfer",
});

/** The fee transfer the gateway appends: `amount` of `token` to `recipient`. */
export const feeTransfer = (amount = "0x3e8", token = USDC, recipient = FORWARDER): Call => ({
  calldata: [recipient, amount, "0x0"],
  contractAddress: token,
  entrypoint: "transfer",
});

/** The bounds and caller an outside execution is built with. */
export type Terms = {
  readonly after?: string;
  readonly before?: string;
  readonly caller?: string;
  readonly chainId?: string;
  readonly nonce?: string;
};

/** SNIP-9 v2 typed data for `calls`, as starknet.js (and so the extension's rebuild) builds it. */
export const outsideTypedData = (calls: readonly Call[], terms: Terms = {}) =>
  outsideExecution.getTypedData(
    terms.chainId ?? "SN_MAIN",
    {
      caller: terms.caller ?? FORWARDER,
      execute_after: terms.after ?? "0x1",
      execute_before: terms.before ?? BEFORE,
    },
    terms.nonce ?? "0x5",
    [...calls],
    OutsideExecutionVersion.V2,
  );

/** The fee block of a build reply, `suggested_max_fee_in_gas_token` set to `max`. */
export const quoteFee = (max = "0x7d0") => ({
  estimated_fee_in_gas_token: "0x3e8",
  estimated_fee_in_strk: "0x2386f26fc10000",
  gas_token_price_in_strk: "0x2540be400",
  suggested_max_fee_in_gas_token: max,
  suggested_max_fee_in_strk: "0x470de4df820000",
});

/** A `paymaster_buildTransaction` result carrying `typedData`. */
export const buildResult = (
  typedData: unknown,
  type: "deploy_and_invoke" | "invoke" = "invoke",
  max = "0x7d0",
) => ({
  fee: quoteFee(max),
  parameters: { fee_mode: { gas_token: USDC, mode: "default" }, version: "0x1" },
  type,
  typed_data: typedData,
});

/**
 * One scripted paymaster answer: a body served with `status` (and an optional declared
 * `contentLength`), `fill` bytes of "x" (an oversized stream, too large to inline), or a transport
 * failure.
 */
export type Reply =
  | { readonly status: number; readonly body: string; readonly contentLength?: string }
  | { readonly status: number; readonly fill: number }
  | { readonly throws: true };

/** A JSON-RPC success reply carrying `result`. */
export const rpcResult = (result: unknown): Reply => ({
  body: JSON.stringify({ id: GASLESS_RPC_ID, jsonrpc: "2.0", result }),
  status: 200,
});

/** A body that is `value` as JSON with `status`. */
export const jsonReply = (value: unknown, status = 200): Reply => ({
  body: JSON.stringify(value),
  status,
});

/** One request the extension posted to the paymaster. */
export type Sent = {
  readonly body: unknown;
  readonly contentType: string | null;
  readonly method: string;
  readonly url: string;
};

const respond = (reply: Reply): Response => {
  if ("throws" in reply) throw new TypeError("network down");
  if ("fill" in reply) return new Response("x".repeat(reply.fill), { status: reply.status });
  const headers: Record<string, string> =
    reply.contentLength === undefined ? {} : { "content-length": reply.contentLength };
  return new Response(reply.body, { headers, status: reply.status });
};

/** A paymaster transport answering from `replies` in order, recording each request in `sent`. */
export const scriptedHttp = (replies: readonly Reply[], sent: Sent[]) => {
  let next = 0;
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const text = typeof init?.body === "string" ? init.body : "";
    sent.push({
      body: JSON.parse(text),
      contentType: new Headers(init?.headers).get("content-type"),
      method: init?.method ?? "GET",
      url: String(input),
    });
    const reply = replies[next];
    next += 1;
    if (!reply) throw new Error("the script has no reply for this request");
    return respond(reply);
  };
};

/** What a thrown refusal looks like in the fixture: its class, code, sentence and retry flag. */
export const thrown = (error: unknown): object => {
  if (!(error instanceof Error)) return { error: String(error) };
  const record = error as Error & { code?: unknown; retryable?: unknown };
  return {
    code: typeof record.code === "string" ? record.code : null,
    message: error.message,
    name: error.name,
    retryable: typeof record.retryable === "boolean" ? record.retryable : null,
  };
};
