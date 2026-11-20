/**
 * The fee blocks of the activity fixture: `receiptFee` (what `readReceiptFee` reads from a
 * receipt reply, and what `getTransactionFees` yields for it through starknet.js) and
 * `reconcile` (which rows `reconcileScope` reads a receipt fee for, and what it stores).
 */
import type { WalletPreferences } from "@bramble/settings/preferences";
import { createRpcProvider } from "@bramble/starknet/provider";
import {
  getTransactionFees,
  readReceiptFee,
  type TransactionStatusInput,
  type TransactionStatusReport,
} from "@bramble/starknet/rpc";
import { type ActivityEntry, memoryActivityLog } from "@bramble/transactions/activity";
import type { RpcProvider } from "starknet";
import {
  type ReconcileDeps,
  reconcileScope,
} from "../../apps/extension/src/background/transactions/tx-reconcile";
import {
  FIELD_PRIME,
  HASH,
  LARGEST_FELT,
  ONE_HUNDREDTH,
  SCOPE,
  SUBMITTED_AT,
  stored,
} from "./shared";

/** A JSON-RPC reply without its envelope (`id`, `jsonrpc`). */
type Reply = { readonly result: unknown } | { readonly error: unknown };

const receipt = (actualFee: unknown, execution = "SUCCEEDED"): Record<string, unknown> => ({
  actual_fee: actualFee,
  block_hash: "0x1",
  block_number: 1,
  events: [],
  execution_resources: { l1_data_gas: 0, l1_gas: 0, l2_gas: 0 },
  execution_status: execution,
  finality_status: "ACCEPTED_ON_L2",
  messages_sent: [],
  transaction_hash: HASH,
  type: "INVOKE",
  ...(execution === "REVERTED" ? { revert_reason: "out of gas" } : {}),
});

const fee = (amount: unknown, unit: unknown = "FRI"): Reply => ({
  result: receipt({ amount, unit }),
});

const RECEIPT_REPLIES: readonly { readonly name: string; readonly reply: Reply }[] = [
  { name: "a STRK-paid fee", reply: fee(ONE_HUNDREDTH) },
  { name: "an ETH-paid fee", reply: fee(ONE_HUNDREDTH, "WEI") },
  { name: "a zero fee", reply: fee("0x0") },
  { name: "padded upper-case hex", reply: fee("0x002386F26FC10000") },
  { name: "decimal text", reply: fee("10000000000000000") },
  { name: "the largest felt", reply: fee(LARGEST_FELT) },
  { name: "past the field", reply: fee(FIELD_PRIME) },
  { name: "a number amount", reply: fee(5) },
  { name: "an unknown unit", reply: fee(ONE_HUNDREDTH, "STRK") },
  { name: "a lower-case unit", reply: fee(ONE_HUNDREDTH, "fri") },
  { name: "a bare felt fee", reply: { result: receipt(ONE_HUNDREDTH) } },
  { name: "no fee", reply: { result: receipt(undefined) } },
  {
    name: "a reverted transaction's fee",
    reply: { result: receipt({ amount: "0x64", unit: "FRI" }, "REVERTED") },
  },
  { name: "not found", reply: { error: { code: 29, message: "Transaction hash not found" } } },
  { name: "a null result", reply: { result: null } },
];

/** A provider whose node answers every receipt read with `reply`. */
const cannedNode =
  (reply: Reply) =>
  (nodeUrl: string): RpcProvider =>
    createRpcProvider(nodeUrl, {
      baseFetch: (async (_input: unknown, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as {
          readonly id: number;
          readonly method: string;
        };
        const answer = request.method === "starknet_specVersion" ? { result: "0.9.0" } : reply;
        return new Response(JSON.stringify({ id: request.id, jsonrpc: "2.0", ...answer }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }) as never,
    });

const URLS = ["https://parity.invalid/rpc"];

// A read that rejects records nothing, as reconciliation's `.catch(() => ({}))` does.
const providerFee = async (reply: Reply): Promise<unknown> => {
  const read = getTransactionFees({ hashes: [HASH], rpcUrls: URLS }, cannedNode(reply));
  return (await read.catch(() => undefined))?.[HASH] ?? null;
};

// The fee `readReceiptFee` reads from the reply's result; an error reply has no receipt.
const replyFee = (reply: Reply) => ("result" in reply ? readReceiptFee(reply.result) : undefined);

export const computeReceiptFees = async () => {
  const cases = [];
  for (const { name, reply } of RECEIPT_REPLIES) {
    cases.push({
      feePaid: replyFee(reply) ?? null,
      name,
      reply,
      throughProvider: await providerFee(reply),
    });
  }
  return cases;
};

const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  schemaVersion: 1,
  tokens: [],
};

const RECONCILE_CASES: readonly {
  readonly name: string;
  readonly row: ActivityEntry;
  readonly status: TransactionStatusReport["status"];
  readonly reply: Reply;
}[] = [
  { name: "an accepted send", reply: fee(ONE_HUNDREDTH), row: stored(), status: "accepted" },
  { name: "a reverted send still paid", reply: fee("0x64"), row: stored(), status: "reverted" },
  {
    name: "an accepted deployment",
    reply: fee("0x64"),
    row: stored({
      amount: undefined,
      counterparty: undefined,
      direction: undefined,
      kind: "deploy",
      summary: "Deploy account contract",
      token: undefined,
      tokenAddress: undefined,
    }),
    status: "accepted",
  },
  { name: "an ETH-paid send", reply: fee(ONE_HUNDREDTH, "WEI"), row: stored(), status: "accepted" },
  {
    name: "a pre-confirmed send has no receipt yet",
    reply: fee(ONE_HUNDREDTH),
    row: stored(),
    status: "preconfirmed",
  },
  {
    name: "a pending send has no receipt yet",
    reply: fee(ONE_HUNDREDTH),
    row: stored(),
    status: "pending",
  },
  {
    name: "a rejected send never executed",
    reply: fee(ONE_HUNDREDTH),
    row: stored(),
    status: "rejected",
  },
  {
    name: "a discovered row's fee is its sender's",
    reply: fee(ONE_HUNDREDTH),
    row: stored({ origin: undefined }),
    status: "accepted",
  },
  {
    name: "a recorded fee is final",
    reply: fee("0x64"),
    row: stored({ feePaid: { amount: ONE_HUNDREDTH, unit: "FRI" } }),
    status: "accepted",
  },
  {
    name: "an unusable receipt records nothing",
    reply: { result: receipt(ONE_HUNDREDTH) },
    row: stored(),
    status: "accepted",
  },
  {
    name: "a missing receipt records nothing",
    reply: { error: { code: 29, message: "Transaction hash not found" } },
    row: stored(),
    status: "accepted",
  },
];

const reconcileOne = async (
  row: ActivityEntry,
  status: TransactionStatusReport["status"],
  reply: Reply,
) => {
  const activity = memoryActivityLog();
  await activity.replaceScope?.([row], SCOPE);
  let receiptRead = false;
  const report: TransactionStatusReport = { finalizedOnL1: false, found: true, seen: true, status };
  const runtimeRpc = {
    async getTransactionFees({ hashes }: TransactionStatusInput) {
      receiptRead = true;
      const paid = replyFee(reply);
      return Object.fromEntries(paid === undefined ? [] : hashes.map((hash) => [hash, paid]));
    },
    async getTransactionStatuses({ hashes }: { readonly hashes: readonly string[] }) {
      return Object.fromEntries(hashes.map((hash) => [hash, report]));
    },
  } as unknown as ReconcileDeps["runtimeRpc"];
  const [after] = await reconcileScope(
    { activity, preferencesStore: { read: async () => preferences }, runtimeRpc },
    SCOPE,
    SUBMITTED_AT + 1_000,
  );
  return { feePaid: after?.feePaid ?? null, receiptRead, status: after?.status ?? null };
};

export const computeReconcile = async () => {
  const cases = [];
  for (const { name, reply, row, status } of RECONCILE_CASES) {
    cases.push({ name, observed: status, reply, row, ...(await reconcileOne(row, status, reply)) });
  }
  return cases;
};
