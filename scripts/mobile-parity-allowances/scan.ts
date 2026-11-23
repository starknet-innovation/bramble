/**
 * The chain blocks of the allowances fixture: `scan` (`scanExternalAllowances`, over
 * `collectExternalAllowances`) and `tracked` (`readTrackedAllowances`, over
 * `collectTrackedAllowances`), each over a small fake node, recorded as the transcript of every
 * call the extension made, in order, with the node's answer, then the result (or `transport`
 * when a transport failure ended the read, for the caller to fail over).
 *
 * Each call is recorded as the extension hands it to starknet.js's `RpcProvider` (one endpoint,
 * no failover): `getBlockNumber`, `getEvents` with its filter as sent (bounds wrapped as
 * `{ block_number }`, an absent bound or token omitted), and `callContract` with the call and its
 * `blockIdentifier`. Those arguments are what starknet.js puts on the wire unchanged.
 *
 * The node pages events oldest-first, two to a page whatever `chunk_size` asks (a node may send
 * fewer), filters by key position and block range as `starknet_getEvents` does, and answers
 * `allowance` from a table. An answer is `{ result }`, `{ error }` (a JSON-RPC error: a node's
 * refusal, which skips the token or pair) or `{ transport }` (thrown as a transport failure).
 */

import { resetRpcEndpointCooldownsForTests } from "@bramble/starknet/provider";
import { APPROVAL_EVENT_KEY } from "@bramble/transactions/allowance-discovery";
import {
  type AllowanceEvent,
  readTrackedAllowances,
  scanExternalAllowances,
  type TrackedAllowancePair,
} from "@bramble/transactions/allowance-scan";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import type { Call, RpcProvider } from "starknet";
import { ADDRESS, BRIDGE, DEX, LENDER, MULTISIG_ID, STRK, UNKNOWN, USDC } from "./shared";

const PAGE = 2;
const OWNER = ADDRESS;

type Event = AllowanceEvent & { readonly block: number };
type Answer =
  | { readonly result: unknown }
  | { readonly error: object }
  | { readonly transport: string };

const cairo1 = (owner: string, spender: string, block: number): Event => ({
  block,
  data: ["0x64", "0x0"],
  keys: [APPROVAL_EVENT_KEY, owner, spender],
});
const legacy = (owner: string, spender: string, block: number): Event => ({
  block,
  data: [owner, spender, "0x64", "0x0"],
  keys: [APPROVAL_EVENT_KEY],
});
// `count` approvals by strangers, one block apart from `first`.
const strangers = (count: number, first: number, make: typeof legacy): Event[] =>
  Array.from({ length: count }, (_, n) =>
    make(`0x${(0x9000 + n).toString(16)}`, `0x${(0x7000 + n).toString(16)}`, first + n),
  );

type Node = {
  readonly head: number;
  // Each token's log, oldest first.
  readonly logs: Readonly<Record<string, readonly Event[]>>;
  // Live allowance `[low, high]` by canonical spender; anything else reads as zero.
  readonly amounts?: Readonly<Record<string, readonly string[]>>;
  // Replaces the node's answer to the calls it matches.
  readonly fault?: (method: string, params: Record<string, unknown>) => Answer | undefined;
};

const same = (a: unknown, b: unknown): boolean =>
  typeof a === "string" && typeof b === "string" && canonicalFelt(a) === canonicalFelt(b);

/** `starknet_getEvents`'s filter as the provider receives it. */
type EventFilter = {
  readonly address: string;
  readonly keys: readonly (readonly string[])[];
  readonly from_block?: { readonly block_number: number };
  readonly to_block?: { readonly block_number: number };
  readonly continuation_token?: string;
};

const events = (node: Node, filter: EventFilter) => {
  const from = filter.from_block?.block_number ?? 0;
  const to = filter.to_block?.block_number ?? node.head;
  const matching = (node.logs[canonicalFelt(filter.address) ?? ""] ?? []).filter(
    (event) =>
      event.block >= from &&
      event.block <= to &&
      filter.keys.every(
        (group, position) =>
          group.length === 0 || group.some((key) => same(key, event.keys[position])),
      ),
  );
  const start = Number(filter.continuation_token ?? "0");
  const page = matching.slice(start, start + PAGE).map(({ data, keys }) => ({ data, keys }));
  return start + PAGE < matching.length
    ? { continuation_token: String(start + PAGE), events: page }
    : { events: page };
};

const reply = (node: Node, method: string, params: Record<string, unknown>): Answer => {
  const fault = node.fault?.(method, params);
  if (fault) return fault;
  if (method === "getBlockNumber") return { result: node.head };
  if (method === "getEvents") return { result: events(node, params as EventFilter) };
  const spender = canonicalFelt(String((params["calldata"] as string[])[1])) ?? "";
  return { result: node.amounts?.[spender] ?? ["0x0", "0x0"] };
};

/** The node as the extension's `RpcProvider`, recording each call and its answer in `transcript`. */
const recordingProvider = (node: Node, transcript: object[]): RpcProvider => {
  const answer = async (method: string, params: object) => {
    const answered = reply(node, method, params as Record<string, unknown>);
    transcript.push({ method, params, reply: answered });
    if ("transport" in answered) throw new Error(answered.transport);
    // A JSON-RPC error as starknet.js raises it: `baseError` carries the numeric code.
    if ("error" in answered)
      throw Object.assign(new Error("node refused"), { baseError: answered.error });
    return answered.result;
  };
  const provider = {
    callContract: (call: Call, blockIdentifier: unknown) =>
      answer("callContract", { ...call, blockIdentifier }),
    getBlockNumber: () => answer("getBlockNumber", {}),
    getEvents: (filter: EventFilter) => answer("getEvents", filter),
  };
  return provider as unknown as RpcProvider;
};

const URLS = ["https://node.invalid"];

/** `run` against `node` alone, its calls recorded, the endpoint fresh (no earlier cooldown). */
const capture = async <T>(node: Node, run: (provider: () => RpcProvider) => Promise<T>) => {
  resetRpcEndpointCooldownsForTests();
  const calls: object[] = [];
  const result = await outcome(() => run(() => recordingProvider(node, calls)));
  return { calls, result };
};

const outcome = async <T>(run: () => Promise<T>): Promise<T | { readonly transport: true }> =>
  run().catch(() => ({ transport: true as const }));

const AMOUNTS = {
  [DEX]: ["0x3e8", "0x0"],
  [BRIDGE]: ["0xffffffffffffffffffffffffffffffff", "0x0"],
  [LENDER]: ["0x0", "0x1"],
};
const REFUSED = { code: 24, message: "Block not found" };

const SCANS: readonly {
  readonly name: string;
  readonly owner: string;
  readonly tokens: readonly string[];
  readonly node: Node;
}[] = [
  {
    name: "Cairo 1: the owner's approvals by key; a window of Cairo 1 events ends the walk",
    node: {
      amounts: AMOUNTS,
      head: 1_000_000,
      logs: {
        [STRK]: [
          cairo1(OWNER, DEX, 999_990),
          cairo1("0x9999", BRIDGE, 999_991),
          cairo1(OWNER, "0x77", 999_992),
          cairo1(OWNER, DEX, 999_993),
        ],
      },
    },
    owner: OWNER,
    tokens: [STRK],
  },
  {
    name: "legacy: walked back window by window to block 0, paged",
    node: {
      amounts: AMOUNTS,
      head: 450_000,
      logs: {
        [STRK]: [
          legacy(OWNER, LENDER, 10),
          ...strangers(2, 300_000, legacy),
          legacy(OWNER, BRIDGE, 400_000),
        ],
      },
    },
    owner: OWNER,
    tokens: [STRK],
  },
  {
    name: "past the last window the rest from block 0, cut short among legacy events",
    node: {
      amounts: AMOUNTS,
      head: 700_000,
      logs: { [STRK]: [legacy(OWNER, DEX, 5), ...strangers(6, 6, legacy)] },
    },
    owner: OWNER,
    tokens: [STRK],
  },
  {
    name: "the owner read runs out of pages; spenders are read once each",
    node: {
      amounts: AMOUNTS,
      head: 900_000,
      logs: {
        [STRK]: [
          ...Array.from({ length: 11 }, (_, n) => cairo1(OWNER, DEX, 800_000 + n)),
          ...strangers(1, 850_000, cairo1),
        ],
      },
    },
    owner: OWNER,
    tokens: [STRK],
  },
  {
    name: "a legacy window too busy for its pages",
    node: {
      amounts: AMOUNTS,
      head: 500_000,
      logs: { [STRK]: [legacy(OWNER, DEX, 450_000), ...strangers(6, 460_000, legacy)] },
    },
    owner: OWNER,
    tokens: [STRK],
  },
  {
    name: "a node error skips the token; invalid tokens are never asked about",
    node: {
      amounts: AMOUNTS,
      fault: (method, params) =>
        (method === "getEvents" && same(params["address"], UNKNOWN)) ||
        (method === "callContract" && same(params["contractAddress"], USDC))
          ? { error: REFUSED }
          : undefined,
      head: 10,
      logs: { [STRK]: [cairo1(OWNER, DEX, 3)], [USDC]: [cairo1(OWNER, BRIDGE, 4)] },
    },
    owner: OWNER,
    tokens: ["0x0", UNKNOWN, "token", USDC, `0x00${STRK.slice(2).toUpperCase()}`],
  },
  {
    name: "an owner that is not a felt reads nothing",
    node: { head: 10, logs: {} },
    owner: "0x0",
    tokens: [STRK],
  },
  {
    name: "a transport failure ends the scan for the next endpoint",
    node: {
      fault: (method) => (method === "getBlockNumber" ? { transport: "fetch failed" } : undefined),
      head: 10,
      logs: {},
    },
    owner: OWNER,
    tokens: [STRK],
  },
];

const pair = (
  token: string,
  spender: string,
  owner = OWNER,
  id = `pair:${token}:${spender}`,
): TrackedAllowancePair => ({
  id,
  owner,
  spender,
  token,
});

const TRACKED: readonly {
  readonly name: string;
  readonly pairs: readonly TrackedAllowancePair[];
  readonly node: Node;
}[] = [
  {
    name: "readings in pair order; a refused or malformed answer gives none",
    node: {
      amounts: { ...AMOUNTS, [canonicalFelt("0x51") ?? ""]: ["0x1"] },
      fault: (method, params) =>
        method === "callContract" && same(params["contractAddress"], UNKNOWN)
          ? { error: REFUSED }
          : undefined,
      head: 10,
      logs: {},
    },
    pairs: [
      pair(STRK, DEX),
      pair(STRK, BRIDGE, "0x0"),
      pair(UNKNOWN, DEX),
      pair(USDC, "0x51"),
      pair(USDC, "0x52", MULTISIG_ID.split(":")[1] ?? ""),
      pair(`0x0${USDC.slice(2)}`, LENDER, `0x00${OWNER.slice(2)}`),
    ],
  },
  {
    name: "a transport failure ends the read",
    node: { fault: () => ({ transport: "fetch failed" }), head: 10, logs: {} },
    pairs: [pair(STRK, DEX)],
  },
];

/** `scan` and `tracked`, one at a time (the endpoint cooldowns are shared). */
export const computeScans = async (): Promise<
  readonly (readonly [string, readonly object[]])[]
> => {
  const scans: object[] = [];
  for (const { name, node, owner, tokens } of SCANS) {
    const { calls, result } = await capture(node, (provider) =>
      scanExternalAllowances({ owner, rpcUrls: URLS, tokens }, provider),
    );
    scans.push({ calls, name, owner, result, tokens });
  }
  const tracked: object[] = [];
  for (const { name, node, pairs } of TRACKED) {
    const { calls, result } = await capture(node, (provider) =>
      readTrackedAllowances({ pairs, rpcUrls: URLS }, provider),
    );
    tracked.push({ calls, name, pairs, result });
  }
  return [
    ["scan", scans],
    ["tracked", tracked],
  ];
};
