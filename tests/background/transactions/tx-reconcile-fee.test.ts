/**
 * The fee paid, recorded from the receipt (GitHub 463).
 *
 * Reconciliation reads a transaction's receipt fee once it reaches an outcome
 * the chain executed, and only for rows this wallet submitted: the sender pays
 * a receipt's fee, so on a discovered incoming transfer it is someone else's.
 * A missing or failed read records nothing, and a recorded fee is never read
 * or replaced again.
 */
import { describe, expect, test } from "bun:test";
import type { WalletPreferences } from "@bramble/settings/preferences";
import type { TransactionFee, TransactionStatusReport } from "@bramble/starknet/rpc";
import { type ActivityEntry, memoryActivityLog } from "@bramble/transactions/activity";
import { defaultRuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import {
  type ReconcileDeps,
  reconcileScope,
} from "../../../apps/extension/src/background/transactions/tx-reconcile";

const ACCOUNT = "SN_MAIN:0x1";
const SCOPE = { accountId: ACCOUNT, networkId: "SN_MAIN" } as const;
const FEE: TransactionFee = { amount: "0x2386f26fc10000", unit: "FRI" };
const NOW = 1_700_000_100_000;

const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  schemaVersion: 1,
  tokens: [],
};

const entry = (overrides: Partial<ActivityEntry> = {}): ActivityEntry => ({
  accountId: ACCOUNT,
  hash: "0xabc",
  kind: "transfer",
  networkId: "SN_MAIN",
  origin: "wallet",
  status: "pending",
  submittedAt: NOW - 60_000,
  summary: "Sent 1 STRK",
  ...overrides,
});

const report = (status: TransactionStatusReport["status"]): TransactionStatusReport => ({
  finalizedOnL1: false,
  found: true,
  seen: true,
  status,
});

const harness = async (
  seeds: readonly ActivityEntry[],
  status: TransactionStatusReport["status"],
  fees: Readonly<Record<string, TransactionFee>> | "throws" | "absent",
) => {
  const activity = memoryActivityLog();
  // Seeded as stored rows, so the status and provenance are what the test says.
  await activity.replaceScope?.(seeds, SCOPE);
  const feeReads: string[][] = [];
  const runtimeRpc = {
    async getTransactionStatuses({ hashes }: { readonly hashes: readonly string[] }) {
      return Object.fromEntries(hashes.map((hash) => [hash, report(status)]));
    },
    ...(fees === "absent"
      ? {}
      : {
          async getTransactionFees({ hashes }: { readonly hashes: readonly string[] }) {
            feeReads.push([...hashes]);
            if (fees === "throws") {
              throw new Error("node unavailable");
            }
            return fees;
          },
        }),
  } as unknown as ReconcileDeps["runtimeRpc"];
  const deps: ReconcileDeps = {
    activity,
    preferencesStore: { read: async () => preferences },
    runtimeRpc,
  };
  return { activity, deps, feeReads };
};

const stored = async (activity: ReconcileDeps["activity"]): Promise<ActivityEntry | undefined> =>
  (await activity.list()).find((row) => row.hash === "0xabc");

describe("fee paid", () => {
  test("is recorded from the receipt once a wallet send is accepted", async () => {
    const { activity, deps, feeReads } = await harness([entry()], "accepted", { "0xabc": FEE });

    await reconcileScope(deps, SCOPE, NOW, true);

    expect(feeReads).toEqual([["0xabc"]]);
    expect((await stored(activity))?.feePaid).toEqual(FEE);
  });

  test("is recorded for a reverted wallet send, which still paid its fee", async () => {
    const { activity, deps } = await harness([entry()], "reverted", { "0xabc": FEE });
    await reconcileScope(deps, SCOPE, NOW, true);
    expect((await stored(activity))?.feePaid).toEqual(FEE);
  });

  test("is not read while the transaction is unresolved", async () => {
    const { activity, deps, feeReads } = await harness([entry()], "preconfirmed", {
      "0xabc": FEE,
    });
    await reconcileScope(deps, SCOPE, NOW, true);
    expect(feeReads).toEqual([]);
    expect((await stored(activity))?.feePaid).toBeUndefined();
  });

  test("is never read for a row the wallet did not submit", async () => {
    const discovered = entry({ status: "accepted", summary: "Received 1 STRK" });
    const { origin: _origin, ...withoutOrigin } = discovered;
    const { activity, deps, feeReads } = await harness([withoutOrigin], "accepted", {
      "0xabc": FEE,
    });
    await reconcileScope(deps, SCOPE, NOW, true);
    expect(feeReads).toEqual([]);
    expect((await stored(activity))?.feePaid).toBeUndefined();
  });

  test("stays missing when the read fails, and is read again on a later pass", async () => {
    const failing = await harness([entry()], "accepted", "throws");
    await reconcileScope(failing.deps, SCOPE, NOW, true);
    expect((await stored(failing.activity))?.feePaid).toBeUndefined();
    await reconcileScope(failing.deps, SCOPE, NOW, true);
    expect(failing.feeReads).toEqual([["0xabc"], ["0xabc"]]);
  });

  test("stays missing when no node answers with a usable fee", async () => {
    const { activity, deps } = await harness([entry()], "accepted", {});
    await reconcileScope(deps, SCOPE, NOW, true);
    expect((await stored(activity))?.feePaid).toBeUndefined();
  });

  test("is not read when the RPC wiring has no fee reader", async () => {
    const { activity, deps } = await harness([entry()], "accepted", "absent");
    await reconcileScope(deps, SCOPE, NOW, true);
    expect((await stored(activity))?.status).toBe("accepted");
    expect((await stored(activity))?.feePaid).toBeUndefined();
  });

  test("is read only once, and a later answer never replaces it", async () => {
    const { activity, deps, feeReads } = await harness([entry()], "accepted", { "0xabc": FEE });
    await reconcileScope(deps, SCOPE, NOW, true);
    await activity.updateStatuses(
      { "0xabc": { feePaid: { amount: "0x1", unit: "WEI" }, status: "accepted" } },
      SCOPE,
    );
    await reconcileScope(deps, SCOPE, NOW, true);

    expect(feeReads).toEqual([["0xabc"]]);
    expect((await stored(activity))?.feePaid).toEqual(FEE);
  });

  test("is wired into the worker's RPC, so production reconciliation reads it", () => {
    expect(typeof defaultRuntimeRpc.getTransactionFees).toBe("function");
  });
});
