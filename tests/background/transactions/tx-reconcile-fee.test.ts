/**
 * The fee paid, recorded from the receipt (GitHub 463).
 *
 * Reconciliation reads a transaction's receipt fee once it reaches an outcome
 * the chain executed, and only for rows this wallet submitted: the sender pays
 * a receipt's fee, so on a discovered incoming transfer it is someone else's.
 * A missing or failed read records nothing, and a recorded fee is never read
 * or replaced again. A sponsored deployment (#431) never gets one.
 */
import { describe, expect, test } from "bun:test";
import type { WalletPreferences } from "@bramble/settings/preferences";
import type { TransactionFee, TransactionStatusReport } from "@bramble/starknet/rpc";
import { type ActivityEntry, memoryActivityLog } from "@bramble/transactions/activity";
import { defaultRuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { L1_FINALITY_WINDOW_MS } from "../../../apps/extension/src/background/transactions/tx-observation";
import {
  type ReconcileDeps,
  reconcileObserved,
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

type FeeAnswer = Readonly<Record<string, TransactionFee>> | "throws" | "absent";

const harness = async (
  seeds: readonly ActivityEntry[],
  status: TransactionStatusReport["status"],
  initialFees: FeeAnswer,
) => {
  let fees = initialFees;
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
  return {
    activity,
    deps,
    feeReads,
    setFees: (next: FeeAnswer) => {
      fees = next;
    },
  };
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

  test("is never read for a sponsored deployment, whose fee the sponsor paid", async () => {
    const sponsored = entry({
      feePayer: "sponsor",
      kind: "deploy",
      summary: "Deploy account contract",
    });
    const { activity, deps, feeReads } = await harness([sponsored], "accepted", { "0xabc": FEE });
    await reconcileScope(deps, SCOPE, NOW, true);
    expect(feeReads).toEqual([]);
    const row = await stored(activity);
    expect(row?.status).toBe("accepted");
    expect(row?.feePaid).toBeUndefined();
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

describe("fee backfill for rows no longer observed", () => {
  test("reads a reverted wallet row again on a later slow pass when the first read failed", async () => {
    const { activity, deps, feeReads, setFees } = await harness([entry()], "reverted", "throws");
    await reconcileScope(deps, SCOPE, NOW, true);
    expect((await stored(activity))?.status).toBe("reverted");
    expect((await stored(activity))?.feePaid).toBeUndefined();

    setFees({ "0xabc": FEE });
    await reconcileObserved(deps, "slow", NOW);

    expect(feeReads).toEqual([["0xabc"], ["0xabc"]]);
    expect((await stored(activity))?.feePaid).toEqual(FEE);
    expect((await stored(activity))?.status).toBe("reverted");
  });

  test("reads an L1-final wallet row with no fee on a user refresh", async () => {
    const final = entry({ finalizedOnL1: true, status: "accepted" });
    const { activity, deps, feeReads } = await harness([final], "accepted", { "0xabc": FEE });
    await reconcileScope(deps, SCOPE, NOW, true);
    expect(feeReads).toEqual([["0xabc"]]);
    expect((await stored(activity))?.feePaid).toEqual(FEE);
  });

  test("does not run on fast passes", async () => {
    const { deps, feeReads } = await harness([entry({ status: "reverted" })], "reverted", {
      "0xabc": FEE,
    });
    await reconcileObserved(deps, "fast", NOW);
    await reconcileScope(deps, SCOPE, NOW, false);
    expect(feeReads).toEqual([]);
  });

  test("skips rows past the observation window and rows the wallet did not submit", async () => {
    const old = entry({ status: "reverted", submittedAt: NOW - L1_FINALITY_WINDOW_MS - 1 });
    const { origin: _origin, ...discovered } = entry({ hash: "0xdef", status: "reverted" });
    const { deps, feeReads } = await harness([old, discovered], "reverted", { "0xabc": FEE });
    await reconcileObserved(deps, "slow", NOW);
    expect(feeReads).toEqual([]);
  });

  test("reads at most eight rows per pass", async () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      entry({ hash: `0x${(index + 1).toString(16)}`, status: "reverted" }),
    );
    const { deps, feeReads } = await harness(rows, "reverted", {});
    await reconcileObserved(deps, "slow", NOW);
    expect(feeReads.flat()).toHaveLength(8);
  });
});
