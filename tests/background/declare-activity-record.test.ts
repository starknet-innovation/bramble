/**
 * MCW-V09-120: an approved dapp declare must leave a local trace.
 *
 * Every other submitted transaction — transfer, invoke, deploy, swap, multisig
 * — is journalled in the activity log, which is what makes it visible in the
 * feed and the CSV export and what background reconciliation follows to
 * acceptance or revert. The declare executor submitted and returned without
 * recording anything, so a user-approved, fee-paying declare was invisible and
 * a reverted one raised no notice.
 *
 * These pin the recording, its deterministic summary (activity summaries are
 * load-bearing: multisig dedup guards match on them exactly), and that a
 * failing log never turns a submitted declare into a reported failure.
 */
import { describe, expect, test } from "bun:test";
import type { ActivityLog } from "@mc-wallet/transactions/activity";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import type { RuntimeRpc } from "../../apps/extension/src/background/runtime/runtime-rpc";
import { unavailablePreferencesStore } from "../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import {
  type DeclareExecuteDeps,
  executeDeclareApproval,
} from "../../apps/extension/src/background/transactions/declare-ops";

const origin = "https://dapp.example";
const passphrase = "correct horse battery staple";

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const declare = {
  classHash: "0x5abc",
  compiledClassHash: "0x6def",
  contractClass: { entry_points_by_type: { EXTERNAL: [] }, sierra_program: ["0x1"] },
};

const reviewedApproval = {
  declare,
  origin,
  reviewedFee: { overallFee: "1", unit: "FRI" },
} as const;

const walletStub = {
  async getGrantedAccounts() {
    return [account];
  },
  async signHash() {
    return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
  },
} as unknown as DeclareExecuteDeps["wallet"];

type Recorded = Parameters<ActivityLog["record"]>[0];

const recordingActivity = (onRecord: (entry: Recorded) => void, fail = false): ActivityLog =>
  ({
    async record(entry: Recorded) {
      onRecord(entry);
      if (fail) {
        throw new Error("activity store unavailable");
      }
    },
  }) as unknown as ActivityLog;

const executeDeps = (overrides: Partial<DeclareExecuteDeps> = {}): DeclareExecuteDeps => {
  const session = createUnlockSession();
  session.unlock(passphrase);
  return {
    activity: recordingActivity(() => undefined),
    preferencesStore: unavailablePreferencesStore,
    runtimeRpc: {
      async submitDeclareTransaction() {
        return { classHash: "0x7ce", transactionHash: "0x7cd" };
      },
    } as unknown as RuntimeRpc,
    session,
    wallet: walletStub,
    ...overrides,
  };
};

describe("executeDeclareApproval activity", () => {
  test("records the submitted declare against the signing account and network", async () => {
    const entries: Recorded[] = [];
    const deps = executeDeps({
      activity: recordingActivity((entry) => entries.push(entry)),
    });

    const result = await executeDeclareApproval(deps, reviewedApproval);

    expect(result).toEqual({ classHash: "0x7ce", ok: true, transactionHash: "0x7cd" });
    expect(entries).toEqual([
      {
        accountId: account.id,
        hash: "0x7cd",
        kind: "declare",
        networkId: "SN_MAIN",
        summary: "Declare contract class 0x5abc",
      },
    ]);
  });

  test("falls back to the compiled class hash when the request carries no class hash", async () => {
    const entries: Recorded[] = [];
    const deps = executeDeps({
      activity: recordingActivity((entry) => entries.push(entry)),
    });

    await executeDeclareApproval(deps, {
      declare: { compiledClassHash: declare.compiledClassHash, contractClass: {} },
      origin,
      reviewedFee: reviewedApproval.reviewedFee,
    });

    expect(entries[0]?.summary).toBe("Declare contract class 0x6def");
  });

  // The wallet's own multisig flow dedups pending work by matching activity
  // summaries exactly ("Declare multisig class") and by a " at 0x…" deploy
  // marker. A dapp declare must not collide with either.
  test("uses a summary no multisig dedup guard matches", async () => {
    const entries: Recorded[] = [];
    const deps = executeDeps({
      activity: recordingActivity((entry) => entries.push(entry)),
    });

    await executeDeclareApproval(deps, reviewedApproval);

    const summary = entries[0]?.summary ?? "";
    expect(summary).not.toBe("Declare multisig class");
    expect(summary).not.toContain(" at 0x");
  });

  test("never records anything when the submission fails", async () => {
    const entries: Recorded[] = [];
    const deps = executeDeps({
      activity: recordingActivity((entry) => entries.push(entry)),
      runtimeRpc: {
        async submitDeclareTransaction(): Promise<never> {
          throw new Error("Class already declared");
        },
      } as unknown as RuntimeRpc,
    });

    await expect(executeDeclareApproval(deps, reviewedApproval)).resolves.toEqual({
      error: "This contract class is already declared on the selected network.",
    });
    expect(entries).toEqual([]);
  });

  // The declare is already on chain once the node answers, so a storage failure
  // must not be reported back to the dapp as a failed declaration.
  test("still reports success when the activity write fails", async () => {
    const deps = executeDeps({
      activity: recordingActivity(() => undefined, true),
    });

    await expect(executeDeclareApproval(deps, reviewedApproval)).resolves.toEqual({
      classHash: "0x7ce",
      ok: true,
      transactionHash: "0x7cd",
    });
  });
});
