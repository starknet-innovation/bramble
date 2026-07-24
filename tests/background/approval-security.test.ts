/**
 * Approval state-machine security regressions: one atomic claimant, live
 * phishing rechecks, exact account/network binding, and private-payload digest
 * verification before any executor is reached.
 */
import { describe, expect, test } from "bun:test";
import { createApprovalContext } from "../../src/background/approval-context";
import {
  type ApprovalDecisionDeps,
  handleApprovalDecision,
} from "../../src/background/approval-decisions";
import { createApprovalQueue } from "../../src/background/approvals";
import { createUnlockSession } from "../../src/background/session";
import { memoryActivityLog } from "../../src/storage/activity-store";
import { memoryAllowanceStore } from "../../src/storage/allowance-store";
import { defaultWalletPreferences } from "../../src/storage/preferences-store";
import type { AccountRef } from "../../src/storage/vault-schema";

const ORIGIN = "https://secure-dapp.example";
const PASSPHRASE = "correct horse battery staple";
const account: AccountRef = {
  address: "0x1234",
  classHash: "0x5678",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234",
  networkId: "SN_MAIN",
  publicKeyX: "0x9abc",
  publicKeyY: "0xdef0",
};

const decision = (id: string, type: "wallet.approveOrigin" | "wallet.denyOrigin") => ({
  id,
  type,
});

const makeDeps = ({
  activeNetworkId = "SN_MAIN",
  blocked = false,
  onUpsert = async () => undefined,
  submit = async () => ({ calls: [], transactionHash: "0x1" }),
}: {
  readonly activeNetworkId?: "SN_MAIN" | "SN_SEPOLIA";
  readonly blocked?: boolean;
  readonly onUpsert?: () => Promise<void>;
  readonly submit?: () => Promise<{
    readonly calls: readonly never[];
    readonly transactionHash: string;
  }>;
} = {}) => {
  const approvals = createApprovalQueue();
  const session = createUnlockSession();
  session.unlock(PASSPHRASE);
  const settled: unknown[] = [];
  let submissions = 0;
  const deps = {
    activity: memoryActivityLog(),
    allowanceStore: memoryAllowanceStore(),
    approvals,
    guard: { isBlocked: () => blocked },
    preferencesStore: {
      async read() {
        return { ...defaultWalletPreferences(), activeNetworkId };
      },
      async upsertToken() {
        await onUpsert();
        return { ...defaultWalletPreferences(), activeNetworkId };
      },
    },
    runtimeRpc: {
      async submitInvokeTransaction() {
        submissions += 1;
        return submit();
      },
    },
    session,
    waiters: {
      pending: () => 0,
      register: async () => ({ error: "unused" }),
      settle: (_id: string, response: unknown) => settled.push(response),
    },
    wallet: {
      async getGrantedAccounts() {
        return [account];
      },
    },
  } as unknown as ApprovalDecisionDeps;
  return { approvals, deps, settled, submissions: () => submissions };
};

describe("approval execution security", () => {
  test("only one concurrent approve can claim and execute an approval", async () => {
    let release: (() => void) | undefined;
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    let writes = 0;
    const { approvals, deps } = makeDeps({
      onUpsert: async () => {
        writes += 1;
        await pause;
      },
    });
    const { id } = approvals.requestWatchAsset({
      origin: ORIGIN,
      token: {
        address: "0x1",
        decimals: 18,
        name: "Token",
        networkId: "SN_MAIN",
        symbol: "TKN",
      },
    });

    const first = handleApprovalDecision(
      deps,
      "wallet.approveOrigin",
      decision(id, "wallet.approveOrigin"),
    );
    const second = handleApprovalDecision(
      deps,
      "wallet.approveOrigin",
      decision(id, "wallet.approveOrigin"),
    );
    expect(await second).toEqual({ error: "approval not found" });
    release?.();
    expect(await first).toMatchObject({ ok: true, pending: [] });
    expect(writes).toBe(1);
  });

  test("a newly blocked origin is refused at execution time", async () => {
    let writes = 0;
    const { approvals, deps, settled } = makeDeps({
      blocked: true,
      onUpsert: async () => {
        writes += 1;
      },
    });
    const { id } = approvals.requestWatchAsset({
      origin: ORIGIN,
      token: {
        address: "0x1",
        decimals: 18,
        name: "Token",
        networkId: "SN_MAIN",
        symbol: "TKN",
      },
    });

    await expect(
      handleApprovalDecision(deps, "wallet.approveOrigin", decision(id, "wallet.approveOrigin")),
    ).resolves.toEqual({ error: "origin blocked" });
    expect(writes).toBe(0);
    expect(settled).toEqual([{ error: "origin blocked" }]);
  });

  test("refuses active-network drift before submitting a bound invoke", async () => {
    const calls = [{ calldata: [], contractAddress: "0x2", entrypoint: "transfer" }];
    const context = await createApprovalContext(account, { calls });
    const { approvals, deps, submissions } = makeDeps({ activeNetworkId: "SN_SEPOLIA" });
    const { id } = approvals.requestInvoke({
      calls,
      context,
      flags: [],
      origin: ORIGIN,
      summaries: ["Transfer"],
    });

    await expect(
      handleApprovalDecision(deps, "wallet.approveOrigin", decision(id, "wallet.approveOrigin")),
    ).resolves.toEqual({ error: "approval context changed" });
    expect(submissions()).toBe(0);
  });

  test("refuses a held payload that does not match the reviewed digest", async () => {
    const reviewed = [{ calldata: [], contractAddress: "0x2", entrypoint: "transfer" }];
    const substituted = [{ calldata: ["0xdead"], contractAddress: "0x3", entrypoint: "approve" }];
    const context = await createApprovalContext(account, { calls: reviewed });
    const { approvals, deps, submissions } = makeDeps();
    const { id } = approvals.requestInvoke({
      calls: substituted,
      context,
      flags: [],
      origin: ORIGIN,
      summaries: ["Substituted"],
    });

    await expect(
      handleApprovalDecision(deps, "wallet.approveOrigin", decision(id, "wallet.approveOrigin")),
    ).resolves.toEqual({ error: "approval payload changed" });
    expect(submissions()).toBe(0);
  });
});
