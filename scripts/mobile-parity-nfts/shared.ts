/**
 * What every block of the NFT fixture shares (see `./index.ts`): the made-up collections, the
 * published parity phrase's accounts, a JSON-RPC node that answers NFT reads by selector behind
 * the global `fetch` (the extension's NFT readers build their own providers, so the global
 * transport is where a fake node can sit), and a recording HTTP transport for the indexer,
 * Starkscan and metadata boundaries. Nothing reaches a network.
 */
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { resetRpcEndpointCooldownsForTests } from "@bramble/starknet/provider";
import { deriveAccount } from "@bramble/vault/accounts";
import type { DerivedAccountRef } from "@bramble/wallet-model/accounts";
import { canonicalFelt, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { byteArray, hash, logger, shortString } from "starknet";
import {
  reply as accountReply,
  type MobileNetworkId,
  type Recorder,
  TRANSACTION_MNEMONIC,
} from "../mobile-transactions-capture";

logger.setLogLevel("FATAL");

/** An ERC-721 collection with the OpenZeppelin snake_case surface. Made up. */
export const ERC721 = "0x7a11ce5e1f2d3c4b5a69788796a5b4c3d2e1f0a1b2c3d4e5f60718293a4b5c6";
/** A legacy ERC-721 that answers only the camelCase `ownerOf` and `tokenURI`. Made up. */
export const LEGACY721 = "0x3c0ffee1d2c3b4a5968778695a4b3c2d1e0f1a2b3c4d5e6f708192a3b4c5d6e";
/** An ERC-1155 collection: no `owner_of`, a `balance_of` and a `uri`. Made up. */
export const ERC1155 = "0x5ed1710a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c";
/** A contract that answers none of the NFT entrypoints. Made up. */
export const NOT_NFT = "0x6b0b0b0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5d";
/** A stranger who owns the tokens the account does not. Made up. */
export const STRANGER = "0x4d1e2c3b4a5968778695a4b3c2d1e0f1a2b3c4d5e6f708192a3b4c5d6e7f809";

/** JSON-clean: what a value is once written (no `undefined` keys). */
export const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** What a thrown refusal looks like in the fixture: its message. */
export const thrownMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A Cairo `ByteArray` reply for `text`, as a contract's `token_uri` returns it. */
export const byteArrayReply = (text: string): string[] => {
  const encoded = byteArray.byteArrayFromString(text);
  return [
    `0x${encoded.data.length.toString(16)}`,
    ...encoded.data.map((word) => `0x${BigInt(word).toString(16)}`),
    `0x${BigInt(encoded.pending_word).toString(16)}`,
    `0x${BigInt(encoded.pending_word_len).toString(16)}`,
  ];
};

/** A legacy `Array<felt252>` reply for `text`: a length, then one short string per piece. */
export const feltArrayReply = (text: string): string[] => {
  const pieces = shortString.splitLongString(text).map(shortString.encodeShortString);
  return [`0x${pieces.length.toString(16)}`, ...pieces];
};

/** A u256 reply `[low, high]`. */
export const u256Reply = (value: bigint): string[] => [
  `0x${(value & ((1n << 128n) - 1n)).toString(16)}`,
  `0x${(value >> 128n).toString(16)}`,
];

/** The published parity phrase's OpenZeppelin account `index` on `networkId`, with its key. */
export const parityAccount = async (networkId: MobileNetworkId, index: number) => {
  const kms = createKrustyKms(await import("@starknetfoundation/krusty-kms-wasm"));
  const derived = await deriveAccount(kms, {
    accountContractType: "openzeppelin",
    accountIndex: index,
    mnemonic: TRANSACTION_MNEMONIC,
    networkId,
  });
  return { account: derived.account as DerivedAccountRef, kms, privateKey: derived.privateKey };
};

/** A node answer: a result, a JSON-RPC error, or a transport failure. */
export type Answer = { readonly result: unknown } | { readonly error: unknown } | "transport";

/** What a contract answers, by entrypoint name; an entrypoint not listed is a contract error. */
export type Contracts = Readonly<Record<string, Readonly<Record<string, Answer>>>>;

/** The error a node gives for an entrypoint the contract does not have. */
const ENTRYPOINT_MISSING = { error: { code: 40, message: "Contract error" } } as const;

const ENTRYPOINTS = [
  "balanceOf",
  "balance_of",
  "ownerOf",
  "owner_of",
  "tokenURI",
  "token_uri",
  "uri",
] as const;
const BY_SELECTOR = new Map(ENTRYPOINTS.map((name) => [hash.getSelectorFromName(name), name]));

/** One JSON-RPC exchange as the node saw it (no id), and its answer. */
export type Exchange = {
  readonly method: string;
  readonly params: unknown;
  readonly reply: Answer;
};

const callAnswer = (contracts: Contracts, params: Record<string, unknown>): Answer => {
  const request = params["request"] as Record<string, unknown>;
  const contract = canonicalFelt(String(request["contract_address"])) ?? "";
  const entrypoint = BY_SELECTOR.get(String(request["entry_point_selector"]));
  const table = Object.entries(contracts).find(([address]) => canonicalFelt(address) === contract);
  return (entrypoint && table?.[1][entrypoint]) ?? ENTRYPOINT_MISSING;
};

/**
 * Runs `run` with the global `fetch` answered by a node: `starknet_call` from `contracts` by
 * selector, everything else (chain id, nonce, fee estimate, the invoke) as the transaction
 * capture's canned OpenZeppelin node answers for `account`. Every exchange is recorded.
 */
export const withNode = async <T>(
  contracts: Contracts,
  run: () => Promise<T>,
  account?: { readonly account: DerivedAccountRef; readonly recorder: Recorder },
): Promise<{ readonly exchanges: Exchange[]; readonly result: T | { error: string } }> => {
  resetRpcEndpointCooldownsForTests();
  const exchanges: Exchange[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as {
      readonly id: number;
      readonly method: string;
      readonly params?: Record<string, unknown>;
    };
    const params = request.params ?? {};
    const answer: Answer =
      request.method === "starknet_call"
        ? callAnswer(contracts, params)
        : account
          ? (account.recorder.inject?.(request.method, params) ??
            accountReply(
              account.recorder,
              request.method,
              params,
              account.account,
              STARKNET_NETWORKS[account.account.networkId as MobileNetworkId].chainId,
            ))
          : { error: { code: -32601, message: "Method not found" } };
    exchanges.push({ method: request.method, params: request.params ?? null, reply: answer });
    if (answer === "transport") throw new TypeError("fetch failed");
    return new Response(JSON.stringify({ id: request.id, jsonrpc: "2.0", ...answer }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }) as typeof fetch;
  try {
    return { exchanges, result: await run().catch((error) => ({ error: thrownMessage(error) })) };
  } finally {
    globalThis.fetch = original;
  }
};

/** An HTTP reply a recording transport gives: a body (JSON, or raw text), status and headers. */
export type HttpReply =
  | {
      readonly body: unknown;
      readonly raw?: true;
      readonly status?: number;
      readonly headers?: Readonly<Record<string, string>>;
      /** The URL the response claims to come from (a redirect the fetch followed). */
      readonly url?: string;
    }
  | "transport";

/** One HTTP request as sent (the deadline signal left out) and the reply it got. */
export type HttpExchange = {
  readonly request: { readonly url: string; readonly init: Record<string, unknown> };
  readonly reply: HttpReply;
};

/** A `fetch`-shaped transport answering each URL from `replies`, recording into `exchanges`. */
export const recordingHttp =
  (replies: (url: string) => HttpReply, exchanges: HttpExchange[]) =>
  async (url: string, init: RequestInit): Promise<Response> => {
    const { signal: _signal, ...rest } = init;
    const reply = replies(url);
    exchanges.push({ reply, request: { init: plain(rest) as Record<string, unknown>, url } });
    if (reply === "transport") throw new TypeError("fetch failed");
    const text = reply.raw ? String(reply.body) : JSON.stringify(reply.body);
    const response = new Response(text, {
      headers: { "content-type": "application/json", ...reply.headers },
      status: reply.status ?? 200,
    });
    if (reply.url !== undefined) Object.defineProperty(response, "url", { value: reply.url });
    return response;
  };
