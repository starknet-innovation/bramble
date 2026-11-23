/**
 * The log blocks of the allowances fixture: `retention` (`keepLargest`, `trimToTotal`), `log`
 * (the persistent store's writes, value by value), `recording` (`recordApproveAllowances` over
 * a submitted batch), `outcomes` (the listing's `revokeOutcomes`) and `revoke`
 * (`allowanceTarget` and the `approve(spender, 0)` built for it).
 */

import type { Json } from "@bramble/core/json";
import { buildErc20ApproveCall } from "@bramble/starknet/rpc";
import { createMemoryStore } from "@bramble/store/kv";
import { type ActivityEntry, isActivityEntry } from "@bramble/transactions/activity";
import {
  ALLOWANCE_STORE_KEY,
  type AllowanceDelta,
  type AllowanceInput,
  type AllowanceRecord,
  allowanceScope,
  allowanceTarget,
  createAllowanceStore,
  type RevokeOutcome,
} from "@bramble/transactions/allowance-store";
import type { Call } from "starknet";
import type { WalletOpsDeps } from "../../apps/extension/src/background/accounts/wallet-ops";
import { revokeOutcomes } from "../../apps/extension/src/background/portfolio/allowance-ops";
import { recordApproveAllowances } from "../../apps/extension/src/background/portfolio/allowance-recording";
// Not a package export: eviction ranking is read here only to pin the port.
import {
  type AllowanceRankToken,
  keepLargest,
  rankingFor,
  trimToTotal,
} from "../../packages/features/transactions/src/allowances/allowance-retention";
import {
  ACCOUNT_ID,
  ASSETS,
  BRIDGE,
  clean,
  DEX,
  HASH,
  LENDER,
  MULTISIG_ID,
  NETWORK,
  NFT,
  OTHER_HASH,
  OTHER_ID,
  record,
  STRK,
  UINT256_MAX,
  UNKNOWN,
  UNLIMITED,
  USDC,
} from "./shared";

const RANK_TOKENS: readonly AllowanceRankToken[] = [
  { address: STRK, decimals: 18, networkId: NETWORK },
  { address: `0x0${USDC.slice(2)}`, decimals: 6, networkId: NETWORK },
  { address: UNKNOWN, decimals: 256, networkId: NETWORK },
];

const spender = (n: number): string => `0x${(0x5000 + n).toString(16)}`;

const RETENTION: readonly {
  readonly name: string;
  readonly records: readonly AllowanceRecord[];
  readonly limit: number;
  readonly total?: true;
  readonly tokens: readonly AllowanceRankToken[];
}[] = [
  {
    limit: 2,
    name: "untracked: raw amounts, unlimited last",
    records: [
      record(UNKNOWN, spender(1), UNLIMITED),
      record(UNKNOWN, spender(2), "10"),
      record(UNKNOWN, spender(3), "30"),
      record(UNKNOWN, spender(4), "20"),
    ],
    tokens: [],
  },
  {
    limit: 3,
    name: "tracked by whole tokens: 5 USDC outranks 1 STRK, untracked first out",
    records: [
      record(USDC, spender(1), "5000000"),
      record(STRK, spender(2), "1000000000000000000"),
      record(UNKNOWN, spender(3), "99999999999999999999"),
      record(STRK, spender(4), "999999999999999999"),
      record(UNKNOWN, spender(5), UNLIMITED),
    ],
    tokens: RANK_TOKENS,
  },
  {
    limit: 2,
    name: "equal risk: the oldest written goes",
    records: [
      record(STRK, spender(1), "7"),
      record(STRK, spender(2), "7"),
      record(STRK, spender(3), "7"),
    ],
    tokens: RANK_TOKENS,
  },
  {
    limit: 1,
    name: "a token claiming 256 decimals ranks as untracked",
    records: [record(UNKNOWN, spender(1), "1"), record(STRK, spender(2), "1")],
    tokens: RANK_TOKENS,
  },
  {
    limit: 5,
    name: "the total: the fullest scopes give up records first",
    records: [
      record(STRK, spender(1), "1"),
      record(STRK, spender(2), "2", {}, MULTISIG_ID),
      record(STRK, spender(3), "3"),
      record(STRK, spender(4), "4", {}, OTHER_ID),
      record(STRK, spender(5), "5"),
      record(STRK, spender(6), "6", {}, MULTISIG_ID),
      record(STRK, spender(7), "7"),
      record(STRK, spender(8), "8", {}, MULTISIG_ID),
    ],
    tokens: [],
    total: true,
  },
];

type Op =
  | { readonly op: "record"; readonly input: AllowanceInput; readonly hash?: string }
  | { readonly op: "applyDelta"; readonly delta: AllowanceDelta }
  | { readonly op: "remove"; readonly id: string }
  | {
      readonly op: "settle";
      readonly readings: readonly { readonly amount: string; readonly id: string }[];
      readonly outcomes: readonly RevokeOutcome[];
    };

const input = (
  token: string,
  who: string,
  amount: string,
  accountId = ACCOUNT_ID,
): AllowanceInput => ({
  accountId,
  amount,
  networkId: NETWORK,
  spender: who,
  token,
});
const add = (token: string, who: string, amount: string, hash?: string): Op => ({
  delta: {
    direction: "add",
    input: input(token, who, amount),
    ...(hash ? { transactionHash: hash } : {}),
  },
  op: "applyDelta",
});
const subtract = (token: string, who: string, amount: string, hash?: string): Op => ({
  delta: {
    direction: "subtract",
    input: input(token, who, amount),
    ...(hash ? { transactionHash: hash } : {}),
  },
  op: "applyDelta",
});
const id = (token: string, who: string): string => `${ACCOUNT_ID}:${token}:${who}`;

// A full scope: 50 untracked grants of 1..50, oldest first, and one other scope's.
const FULL_SCOPE: readonly AllowanceRecord[] = [
  ...Array.from({ length: 50 }, (_, n) => record(UNKNOWN, spender(n), String(n + 1))),
  record(UNKNOWN, spender(1), "1", {}, OTHER_ID),
];

const LOGS: readonly {
  readonly name: string;
  readonly seed?: unknown;
  readonly ops: readonly Op[];
}[] = [
  {
    name: "approve, increase, decrease to zero from an exact base marks a revoke",
    ops: [
      { hash: OTHER_HASH, input: input(STRK, DEX, "100"), op: "record" },
      add(STRK, DEX, "50"),
      subtract(STRK, DEX, "200", HASH),
    ],
  },
  {
    name: "deltas with no base are lower bounds; a sum saturates at 2^256 - 1",
    ops: [
      add(STRK, BRIDGE, "40"),
      subtract(STRK, BRIDGE, "100", HASH),
      subtract(USDC, DEX, "5"),
      add(USDC, LENDER, UINT256_MAX),
      add(USDC, LENDER, "1"),
      add(USDC, "0xnope", "1"),
      add(USDC, LENDER, "-1"),
    ],
  },
  {
    name: "a revoke: failed clears, accepted with a reading takes it, zero removes",
    ops: [
      { input: input(STRK, DEX, "0"), op: "record" },
      { input: input(STRK, DEX, "1000"), op: "record" },
      { hash: `0x00${HASH.slice(2).toUpperCase()}`, input: input(STRK, DEX, "0"), op: "record" },
      { op: "settle", outcomes: [{ hash: HASH, status: "failed" }], readings: [] },
      { hash: OTHER_HASH, input: input(STRK, DEX, "0"), op: "record" },
      { op: "settle", outcomes: [{ hash: OTHER_HASH, status: "accepted" }], readings: [] },
      {
        op: "settle",
        outcomes: [{ hash: OTHER_HASH, status: "accepted" }],
        readings: [{ amount: "500", id: id(STRK, DEX) }],
      },
      { op: "settle", outcomes: [], readings: [{ amount: "0", id: id(STRK, DEX) }] },
    ],
  },
  {
    name: "conflicting outcomes for one hash settle as failed",
    ops: [
      { input: input(STRK, DEX, "9"), op: "record" },
      { hash: HASH, input: input(STRK, DEX, "0"), op: "record" },
      {
        op: "settle",
        outcomes: [
          { hash: HASH, status: "accepted" },
          { hash: HASH, status: "failed" },
        ],
        readings: [{ amount: "4", id: id(STRK, DEX) }],
      },
    ],
  },
  {
    name: "a zero reading drops a zero lower bound, not an exact grant",
    ops: [
      subtract(STRK, DEX, "1"),
      { input: input(USDC, DEX, "3"), op: "record" },
      {
        op: "settle",
        outcomes: [],
        readings: [
          { amount: "0", id: id(STRK, DEX) },
          { amount: "0", id: id(USDC, DEX) },
        ],
      },
      { op: "settle", outcomes: [], readings: [{ amount: "8", id: id(USDC, DEX) }] },
      { id: id(USDC, DEX), op: "remove" },
    ],
  },
  {
    name: "past the per-scope cap the least risky goes, the new grant competing",
    ops: [
      { input: input(UNKNOWN, DEX, "1000"), op: "record" },
      { input: input(UNKNOWN, BRIDGE, "1"), op: "record" },
    ],
    seed: FULL_SCOPE,
  },
  {
    name: "invalid stored records are dropped on the next write",
    ops: [{ id: id(STRK, LENDER), op: "remove" }],
    seed: [record(STRK, DEX, "1"), { ...record(STRK, BRIDGE, "2"), lowerBound: false }, "junk"],
  },
  {
    name: "a value that is not an array reads as empty",
    ops: [add(STRK, DEX, "1")],
    seed: { a: 1 },
  },
];

const runLog = async (seed: unknown, ops: readonly Op[]) => {
  const kv = createMemoryStore();
  if (seed !== undefined) await kv.set(ALLOWANCE_STORE_KEY, seed as Json);
  const store = createAllowanceStore({ store: kv });
  const steps: unknown[] = [];
  for (const op of ops) {
    if (op.op === "record") await store.record(op.input, op.hash);
    if (op.op === "applyDelta") await store.applyDelta(op.delta);
    if (op.op === "remove") await store.remove(op.id);
    if (op.op === "settle") await store.settleRevocations(op.readings, op.outcomes);
    steps.push({ ...op, stored: (await kv.get(ALLOWANCE_STORE_KEY)) ?? null });
  }
  return steps;
};

const call = (contractAddress: string, entrypoint: string, calldata: readonly string[]): Call => ({
  calldata: [...calldata],
  contractAddress,
  entrypoint,
});

const RECORDINGS: readonly {
  readonly name: string;
  readonly seed: readonly AllowanceRecord[];
  readonly calls: readonly Call[];
  readonly owner: string;
}[] = [
  {
    calls: [
      call(STRK, "approve", [DEX, "0x3e8", "0x0"]),
      call(UNKNOWN, "increase_allowance", [DEX, "0x10", "0x0"]),
      call(UNKNOWN, "increaseAllowance", [DEX, "0x10", "0x0"]),
      call(USDC, "decrease_allowance", [DEX, "0x0", "0x0"]),
      call(NFT, "approve", [DEX, "0x7", "0x0"]),
      call(STRK, "transfer", [DEX, "0x1", "0x0"]),
      call(STRK, "Approve", [BRIDGE, "0x1", "0x0"]),
      call(STRK, "approve", [BRIDGE, "0x1", "0x100000000000000000000000000000000"]),
      call(STRK, "approve", [BRIDGE]),
      call(USDC, "decreaseAllowance", [LENDER, "0x5", "0x0"]),
    ],
    name: "a dapp's batch: what each call files",
    owner: ACCOUNT_ID,
    seed: [record(USDC, LENDER, "20")],
  },
  {
    calls: [call(`0x0${STRK.slice(2)}`, "approve", [`0x00${DEX.slice(2)}`, "0x0", "0x0"])],
    name: "the revoke itself marks the grant with its hash",
    owner: ACCOUNT_ID,
    seed: [record(STRK, DEX, UNLIMITED)],
  },
  {
    calls: [call(STRK, "approve", [DEX, "0x5", "0x0"])],
    name: "a multisig execution files under the multisig's scope",
    owner: MULTISIG_ID,
    seed: [],
  },
];

const runRecording = async (
  seed: readonly AllowanceRecord[],
  calls: readonly Call[],
  owner: string,
) => {
  const kv = createMemoryStore();
  await kv.set(ALLOWANCE_STORE_KEY, clean(seed) as Json);
  await recordApproveAllowances({
    assets: ASSETS,
    calls,
    owner: { accountId: owner, networkId: NETWORK },
    store: createAllowanceStore({ store: kv }),
    transactionHash: HASH,
  });
  return (await kv.get(ALLOWANCE_STORE_KEY)) ?? null;
};

const activity = (
  hash: string,
  status: ActivityEntry["status"],
  extra: { readonly [K in keyof ActivityEntry]?: ActivityEntry[K] | undefined } = {},
) =>
  clean({
    accountId: ACCOUNT_ID,
    hash,
    kind: "invoke",
    networkId: NETWORK,
    origin: "wallet",
    status,
    submittedAt: 1_752_501_900_000,
    summary: "Revoke approval",
    ...extra,
  }) as ActivityEntry;

const PENDING = [
  record(STRK, DEX, "5", { revokeHash: HASH, revoking: true }),
  record(USDC, DEX, "5", { revokeHash: OTHER_HASH, revoking: true }, MULTISIG_ID),
  record(STRK, BRIDGE, "5", { revoking: true }),
];
const OUTCOMES: readonly { readonly name: string; readonly entries: readonly ActivityEntry[] }[] = [
  { entries: [activity(HASH, "accepted")], name: "accepted" },
  {
    entries: [activity(HASH, "rejected"), activity(HASH, "reverted")],
    name: "rejected and reverted fail",
  },
  { entries: [activity(HASH, "pending"), activity(HASH, "preconfirmed")], name: "no outcome yet" },
  {
    entries: [activity(`0x0${HASH.slice(2)}`, "accepted")],
    name: "a padded hash is matched canonical",
  },
  {
    entries: [
      activity(HASH, "accepted", { origin: undefined }),
      activity(HASH, "accepted", {
        accountId: `SN_SEPOLIA:${ACCOUNT_ID.split(":")[1]}`,
        networkId: "SN_SEPOLIA",
      }),
      activity(HASH, "accepted", { accountId: MULTISIG_ID }),
      activity(OTHER_HASH, "reverted"),
      activity(OTHER_HASH, "accepted", { accountId: MULTISIG_ID }),
    ],
    name: "only this wallet's row, on this network, in the record's own scope",
  },
];

const REVOKE_IDS: readonly (readonly [string, string])[] = [
  ["an allowance found on chain", id(STRK, DEX)],
  ["padded and upper-case felts", `${ACCOUNT_ID}:0x0${STRK.slice(2).toUpperCase()}:0x00A11CE`],
  ["another account's id", `${OTHER_ID}:${STRK}:${DEX}`],
  ["a third part", `${id(STRK, DEX)}:0x1`],
  ["a zero spender", id(STRK, "0x0")],
  ["a token that is not a number", id("token", DEX)],
  ["no separator after the account", `${ACCOUNT_ID}${STRK}:${DEX}`],
];

/** `retention`, `log`, `recording`, `outcomes` and `revoke`. */
export const computeLog = async (): Promise<readonly (readonly [string, readonly object[]])[]> => [
  [
    "retention",
    RETENTION.map(({ limit, name, records, tokens, total }) => {
      const ranking = rankingFor(tokens);
      const kept = total
        ? trimToTotal(records, limit, allowanceScope, ranking)
        : keepLargest(records, limit, ranking);
      return {
        fn: total ? "trimToTotal" : "keepLargest",
        kept: kept.map((r) => r.id),
        limit,
        name,
        records,
        tokens,
      };
    }),
  ],
  [
    "log",
    await Promise.all(
      LOGS.map(async ({ name, ops, seed }) =>
        clean({ name, seed, steps: await runLog(seed, ops) }),
      ),
    ),
  ],
  [
    "recording",
    await Promise.all(
      RECORDINGS.map(async ({ calls, name, owner, seed }) =>
        clean({
          assets: ASSETS,
          calls,
          hash: HASH,
          name,
          owner,
          seed,
          stored: await runRecording(seed, calls, owner),
        }),
      ),
    ),
  ],
  [
    "outcomes",
    await Promise.all(
      OUTCOMES.map(async ({ entries, name }) => {
        // Rows as the activity log lists them: each one it would load.
        if (!entries.every(isActivityEntry)) throw new Error(`an invalid activity row in ${name}`);
        const deps = { activity: { list: async () => entries } } as unknown as WalletOpsDeps;
        return {
          entries,
          name,
          network: NETWORK,
          outcomes: await revokeOutcomes(deps, PENDING, NETWORK),
          records: PENDING,
        };
      }),
    ),
  ],
  [
    "revoke",
    REVOKE_IDS.map(([name, allowanceId]) => {
      const target = allowanceTarget(allowanceId, ACCOUNT_ID);
      const revoke = target ? buildErc20ApproveCall(target.token, target.spender, 0n) : null;
      return { accountId: ACCOUNT_ID, call: revoke, id: allowanceId, name, target };
    }),
  ],
];
