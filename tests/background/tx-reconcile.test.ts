/**
 * Background reconciliation invariants.
 *
 * The Send flow now advances on a pre-confirmation, so the guarantee that
 * replaces "the user watched it land" lives here: with the side panel closed,
 * the background keeps polling every scope — not just the active account — and
 * writes the eventual outcome back, including a notice when a transaction the
 * user already moved past turns out to have failed.
 */
import { describe, expect, test } from "bun:test";
import { UNRESOLVED_WINDOW_MS } from "../../src/background/tx-observation";
import {
  type ReconcileDeps,
  reconcileObserved,
  reconcileScope,
} from "../../src/background/tx-reconcile";
import type { TransactionStatusReport } from "../../src/starknet/rpc";
import { type ActivityEntry, memoryActivityLog } from "../../src/storage/activity-store";
import type { WalletPreferences } from "../../src/storage/preferences-store";

const ACCOUNT = "SN_MAIN:0x1";
const OTHER_ACCOUNT = "SN_MAIN:0x9";

const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  schemaVersion: 1,
  tokens: [],
};

const found = (
  status: TransactionStatusReport["status"],
  finalizedOnL1 = false,
): TransactionStatusReport => ({ finalizedOnL1, found: true, status });

const makeDeps = (
  entries: readonly ActivityEntry[],
  reports: Readonly<Record<string, TransactionStatusReport>>,
): { readonly deps: ReconcileDeps; readonly polled: string[][] } => {
  const activity = memoryActivityLog();
  const polled: string[][] = [];
  // The in-memory log stamps records itself, so seed each fixture through
  // updateStatuses on a recorded row to keep the stored shape honest.
  for (const seed of entries) {
    void activity.record(seed);
    void activity.updateStatuses(
      {
        [seed.hash]: {
          ...(seed.finalizedOnL1 === undefined ? {} : { finalizedOnL1: seed.finalizedOnL1 }),
          ...(seed.notFoundCount === undefined ? {} : { notFoundCount: seed.notFoundCount }),
          status: seed.status,
        },
      },
      { accountId: seed.accountId, networkId: seed.networkId },
    );
  }
  return {
    deps: {
      activity,
      preferencesStore: {
        async read() {
          return preferences;
        },
      },
      runtimeRpc: {
        async getTransactionStatuses({
          hashes,
        }: {
          readonly hashes: readonly string[];
        }): Promise<Readonly<Record<string, TransactionStatusReport>>> {
          polled.push([...hashes]);
          return Object.fromEntries(
            hashes.flatMap((hash) => {
              const report = reports[hash];
              return report ? [[hash, report] as const] : [];
            }),
          );
        },
      } as unknown as ReconcileDeps["runtimeRpc"],
    },
    polled,
  };
};

const entry = (overrides: Partial<ActivityEntry> = {}): ActivityEntry => ({
  accountId: ACCOUNT,
  hash: "0xabc",
  kind: "transfer",
  networkId: "SN_MAIN",
  status: "preconfirmed",
  submittedAt: 0,
  summary: "Sent 1 STRK",
  ...overrides,
});

const statusOf = async (deps: ReconcileDeps, hash: string): Promise<ActivityEntry | undefined> =>
  (await deps.activity.list()).find((stored) => stored.hash === hash);

describe("background reconciliation", () => {
  test("promotes a pre-confirmed transaction to accepted on the fast cadence", async () => {
    const { deps, polled } = makeDeps([entry()], { "0xabc": found("accepted") });
    await reconcileObserved(deps, "fast", 1_000);
    expect(polled).toEqual([["0xabc"]]);
    expect((await statusOf(deps, "0xabc"))?.status).toBe("accepted");
  });

  test("keeps watching an accepted transaction on the slow cadence until L1 proof", async () => {
    const { deps, polled } = makeDeps([entry({ status: "accepted" })], {
      "0xabc": found("accepted", true),
    });
    // The fast tier must not touch it — that is the whole point of two tiers.
    await reconcileObserved(deps, "fast", 1_000);
    expect(polled).toEqual([]);
    await reconcileObserved(deps, "slow", 1_000);
    expect((await statusOf(deps, "0xabc"))?.finalizedOnL1).toBe(true);
    // L1-final is terminal: no further polling on any cadence.
    await reconcileObserved(deps, "slow", 2_000);
    expect(polled).toEqual([["0xabc"]]);
  });

  test("records a notice when an accepted transaction later reverts", async () => {
    const { deps } = makeDeps([entry({ status: "accepted" })], { "0xabc": found("reverted") });
    await reconcileObserved(deps, "slow", 1_000);
    const stored = await statusOf(deps, "0xabc");
    expect(stored?.status).toBe("reverted");
    expect(stored?.failureNotice).toBe("pending");
  });

  test("retires an unresolved transaction that never lands and owes one notice", async () => {
    const { deps, polled } = makeDeps([entry()], {});
    await reconcileObserved(deps, "fast", UNRESOLVED_WINDOW_MS);
    const stored = await statusOf(deps, "0xabc");
    // The wallet does not know the outcome, so the status is left alone.
    expect(stored?.status).toBe("preconfirmed");
    expect(stored?.failureNotice).toBe("pending");
    expect(polled).toEqual([]);
  });

  test("reconciles every account scope, not only the active one", async () => {
    const { deps } = makeDeps([entry(), entry({ accountId: OTHER_ACCOUNT, hash: "0xdef" })], {
      "0xabc": found("accepted"),
      "0xdef": found("accepted"),
    });
    await reconcileObserved(deps, "fast", 1_000);
    expect((await statusOf(deps, "0xabc"))?.status).toBe("accepted");
    expect((await statusOf(deps, "0xdef"))?.status).toBe("accepted");
  });

  test("leaves a transaction untouched when the node answers nothing for it", async () => {
    const { deps } = makeDeps([entry()], {});
    await reconcileObserved(deps, "fast", 1_000);
    expect((await statusOf(deps, "0xabc"))?.status).toBe("preconfirmed");
  });

  // A node outage must never look like a disappearance: the transaction simply
  // stays under observation for the next tick.
  test("leaves a transaction untouched when the status query rejects", async () => {
    const { deps } = makeDeps([entry()], {});
    const offline: ReconcileDeps = {
      ...deps,
      runtimeRpc: {
        async getTransactionStatuses() {
          throw new Error("fetch failed");
        },
      } as unknown as ReconcileDeps["runtimeRpc"],
    };
    await reconcileObserved(offline, "fast", 1_000);
    const stored = await statusOf(offline, "0xabc");
    expect(stored?.status).toBe("preconfirmed");
    expect(stored?.notFoundCount).toBeUndefined();
  });

  test("serializes panel and alarm reads so a stale third miss cannot overwrite acceptance", async () => {
    const activity = memoryActivityLog();
    await activity.record(entry());
    await activity.updateStatuses(
      { "0xabc": { notFoundCount: 2, status: "preconfirmed" } },
      { accountId: ACCOUNT, networkId: "SN_MAIN" },
    );
    const firstRpcStarted = Promise.withResolvers<void>();
    const releaseFirstRpc = Promise.withResolvers<void>();
    let rpcCalls = 0;
    const deps: ReconcileDeps = {
      activity,
      preferencesStore: {
        async read() {
          return preferences;
        },
      },
      runtimeRpc: {
        async getTransactionStatuses() {
          rpcCalls += 1;
          if (rpcCalls === 1) {
            firstRpcStarted.resolve();
            await releaseFirstRpc.promise;
            return { "0xabc": found("accepted") };
          }
          return {
            "0xabc": { finalizedOnL1: false, found: false, status: "pending" },
          };
        },
      } as unknown as ReconcileDeps["runtimeRpc"],
    };

    const panel = reconcileScope(deps, { accountId: ACCOUNT, networkId: "SN_MAIN" }, 1_000);
    await firstRpcStarted.promise;
    const alarm = reconcileObserved(deps, "fast", 1_000);
    releaseFirstRpc.resolve();
    await Promise.all([panel, alarm]);

    const stored = await statusOf(deps, "0xabc");
    expect(rpcCalls).toBe(1);
    expect(stored?.status).toBe("accepted");
    expect(stored?.notFoundCount).toBe(0);
    expect(stored?.failureNotice).toBeUndefined();
  });

  test("returns local activity while a background RPC is stalled", async () => {
    const activity = memoryActivityLog();
    await activity.record(entry());
    const rpcStarted = Promise.withResolvers<void>();
    const releaseRpc = Promise.withResolvers<void>();
    const deps: ReconcileDeps = {
      activity,
      preferencesStore: {
        async read() {
          return preferences;
        },
      },
      runtimeRpc: {
        async getTransactionStatuses() {
          rpcStarted.resolve();
          await releaseRpc.promise;
          return {};
        },
      } as unknown as ReconcileDeps["runtimeRpc"],
    };

    const alarm = reconcileObserved(deps, "fast", 1_000);
    await rpcStarted.promise;
    const panel = reconcileScope(deps, { accountId: ACCOUNT, networkId: "SN_MAIN" }, 1_000);
    const outcome = await Promise.race([
      panel.then((entries) => ({ entries, settled: true as const })),
      (async () => {
        for (let turn = 0; turn < 10; turn += 1) {
          await Promise.resolve();
        }
        return { entries: [], settled: false as const };
      })(),
    ]);
    expect(outcome.settled).toBe(true);
    expect(outcome.entries.map((stored) => stored.hash)).toEqual(["0xabc"]);

    releaseRpc.resolve();
    await alarm;
  });
});
