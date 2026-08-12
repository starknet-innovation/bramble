/**
 * Approval state-machine security regressions: one atomic claimant, live
 * phishing rechecks, exact account/network binding, and private-payload digest
 * verification before any executor is reached.
 */
import { describe, expect, test } from "bun:test";
import {
  memoryOriginHistory,
  type OriginHistoryStore,
} from "@mc-wallet/permissions/origin-history";
import { defaultWalletPreferences } from "@mc-wallet/settings/preferences";
import { memoryActivityLog } from "@mc-wallet/transactions/activity";
import { memoryAllowanceStore } from "@mc-wallet/transactions/allowance-store";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { createApprovalContext } from "../../../apps/extension/src/background/approvals/approval-context";
import {
  type ApprovalDecisionDeps,
  handleApprovalDecision,
} from "../../../apps/extension/src/background/approvals/approval-decisions";
import { enrichApprovals } from "../../../apps/extension/src/background/approvals/approval-insights";
import { createApprovalQueue } from "../../../apps/extension/src/background/approvals/approvals";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";

const ORIGIN = "https://secure-dapp.example";
const PASSPHRASE = "correct horse battery staple";
const REVIEWED_FEE = { overallFee: "1", unit: "FRI" as const };
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
const invokeDecision = (id: string) => ({
  id,
  reviewedFee: REVIEWED_FEE,
  type: "wallet.approveOrigin" as const,
});

const makeDeps = ({
  activeNetworkId = "SN_MAIN",
  blocked = false,
  granted = [account],
  originHistory = memoryOriginHistory(),
  onUpsert = async () => undefined,
  submit = async () => ({ calls: [], transactionHash: "0x1" }),
}: {
  readonly activeNetworkId?: "SN_MAIN" | "SN_SEPOLIA";
  readonly blocked?: boolean;
  /** What the origin may currently see; drives the account-drift cases. */
  readonly granted?: readonly AccountRef[];
  readonly originHistory?: OriginHistoryStore;
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
  const submitted: AccountRef[] = [];
  let submissions = 0;
  const deps = {
    activity: memoryActivityLog(),
    allowanceStore: memoryAllowanceStore(),
    approvals,
    guard: { isBlocked: () => blocked },
    originHistory,
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
      async submitInvokeTransaction(input: { readonly account: AccountRef }) {
        submissions += 1;
        submitted.push(input.account);
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
        return granted;
      },
    },
  } as unknown as ApprovalDecisionDeps;
  return { approvals, deps, settled, submitted, submissions: () => submissions };
};

describe("approval execution security", () => {
  test("keeps first-seen warnings stable until the user decides", async () => {
    let now = 1_000;
    const originHistory = memoryOriginHistory(() => now);
    const { approvals, deps } = makeDeps({ originHistory });
    const approval = approvals.request(ORIGIN);

    const warning = "First time this wallet has seen this site; you have no prior history with it.";
    expect((await enrichApprovals(approvals.list(), originHistory))[0]?.insights).toContain(
      warning,
    );
    now = 2_000;
    expect((await enrichApprovals(approvals.list(), originHistory))[0]?.insights).toContain(
      warning,
    );
    await handleApprovalDecision(
      deps,
      "wallet.denyOrigin",
      decision(approval.id, "wallet.denyOrigin"),
    );
    expect(await originHistory.firstSeen(ORIGIN)).toBe(2_000);
  });

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
      fee: {
        fee: REVIEWED_FEE,
        feeAffordability: "unknown",
        feeEstimateFailed: false,
        feeEstimatePending: false,
        requiresDeployment: false,
      },
      calls,
      context,
      flags: [],
      origin: ORIGIN,
      summaries: ["Transfer"],
    });

    await expect(
      handleApprovalDecision(deps, "wallet.approveOrigin", invokeDecision(id)),
    ).resolves.toEqual({ error: "approval context changed" });
    expect(submissions()).toBe(0);
  });

  test("refuses account drift and settles the held request instead of hanging", async () => {
    // Switching to an account the origin's grant does not cover disconnects it
    // mid-approval — ordinary user action now that a grant only ever exposes
    // the active account. The bound invoke must not submit, and the dapp's held
    // promise must be settled with the reason rather than left open forever.
    const calls = [{ calldata: [], contractAddress: "0x2", entrypoint: "transfer" }];
    const context = await createApprovalContext(account, { calls });
    const { approvals, deps, settled, submissions } = makeDeps({ granted: [] });
    const { id } = approvals.requestInvoke({
      fee: {
        fee: REVIEWED_FEE,
        feeAffordability: "unknown",
        feeEstimateFailed: false,
        feeEstimatePending: false,
        requiresDeployment: false,
      },
      calls,
      context,
      flags: [],
      origin: ORIGIN,
      summaries: ["Transfer"],
    });

    await expect(
      handleApprovalDecision(deps, "wallet.approveOrigin", invokeDecision(id)),
    ).resolves.toEqual({ error: "approval context changed" });
    expect(submissions()).toBe(0);
    expect(settled).toEqual([{ error: "approval context changed" }]);
  });

  test("executes a bound invoke against the approved account, not the first granted one", async () => {
    // Binding is by exact id, never by position: a resolver "simplified" to
    // granted[0] would sign the reviewed calls with a different account than
    // the approval card showed. Both accounts are on the active network, so
    // only the id match distinguishes them.
    const other: AccountRef = { ...account, address: "0x9999", id: "SN_MAIN:0x9999" };
    const calls = [{ calldata: [], contractAddress: "0x2", entrypoint: "transfer" }];
    const context = await createApprovalContext(account, { calls });
    const { approvals, deps, submitted } = makeDeps({ granted: [other, account] });
    const { id } = approvals.requestInvoke({
      fee: {
        fee: REVIEWED_FEE,
        feeAffordability: "unknown",
        feeEstimateFailed: false,
        feeEstimatePending: false,
        requiresDeployment: false,
      },
      calls,
      context,
      flags: [],
      origin: ORIGIN,
      summaries: ["Transfer"],
    });

    await expect(
      handleApprovalDecision(deps, "wallet.approveOrigin", invokeDecision(id)),
    ).resolves.toMatchObject({ ok: true });
    expect(submitted).toEqual([account]);
    expect(context.accountId).toBe(account.id);
  });

  test("refuses a held payload that does not match the reviewed digest", async () => {
    const reviewed = [{ calldata: [], contractAddress: "0x2", entrypoint: "transfer" }];
    const substituted = [{ calldata: ["0xdead"], contractAddress: "0x3", entrypoint: "approve" }];
    const context = await createApprovalContext(account, { calls: reviewed });
    const { approvals, deps, submissions } = makeDeps();
    const { id } = approvals.requestInvoke({
      fee: {
        fee: REVIEWED_FEE,
        feeAffordability: "unknown",
        feeEstimateFailed: false,
        feeEstimatePending: false,
        requiresDeployment: false,
      },
      calls: substituted,
      context,
      flags: [],
      origin: ORIGIN,
      summaries: ["Substituted"],
    });

    await expect(
      handleApprovalDecision(deps, "wallet.approveOrigin", invokeDecision(id)),
    ).resolves.toEqual({ error: "approval payload changed" });
    expect(submissions()).toBe(0);
  });
});
