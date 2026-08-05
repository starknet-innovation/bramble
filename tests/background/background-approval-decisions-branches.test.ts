/**
 * Per-branch early returns in the approve/reject decision handler. Two drivers:
 *  - a controlled ApprovalQueue double surfaces approvals whose held payload is
 *    missing, exercising the "approval not found" returns for every kind and
 *    the watch-asset missing-token guard, plus the invalid-input return;
 *  - the real queue with a locked session drives each executor to an error
 *    result so the error-result passthrough returns are hit.
 */
import { describe, expect, test } from "bun:test";
import {
  type ApprovalDecisionDeps,
  handleApprovalDecision,
} from "../../src/background/approval-decisions";
import {
  type ApprovalQueue,
  createApprovalQueue,
  type PendingApproval,
} from "../../src/background/approvals";
import { createUnlockSession } from "../../src/background/session";
import { DEFAULT_ORIGIN_GUARD } from "../../src/security/blocklist";
import { memoryAllowanceStore } from "../../src/storage/allowance-store";

const ORIGIN = "https://dapp.example";
const uuid = () => crypto.randomUUID();
const CONTEXT = {
  accountId: "SN_MAIN:0x1",
  chainId: "0x534e5f4d41494e",
  networkId: "SN_MAIN" as const,
  payloadDigest: `sha256:${"a".repeat(64)}`,
};

const throwing = (label: string) =>
  new Proxy(
    {},
    {
      get() {
        throw new Error(`${label} must not be called on the branch under test`);
      },
    },
  );

const waiters = () => {
  const settled: { id: string; response: unknown }[] = [];
  return {
    settled,
    waiter: {
      pending: () => 0,
      register: async () => ({ error: "unused" }),
      settle: (id: string, response: unknown) => {
        settled.push({ id, response });
      },
    },
  };
};

const baseDeps = (
  approvals: ApprovalQueue,
  overrides: Partial<ApprovalDecisionDeps> = {},
): ApprovalDecisionDeps =>
  ({
    activity: throwing("activity"),
    allowanceStore: memoryAllowanceStore(),
    approvals,
    guard: DEFAULT_ORIGIN_GUARD,
    preferencesStore: throwing("preferencesStore"),
    runtimeRpc: throwing("runtimeRpc"),
    session: createUnlockSession(),
    waiters: waiters().waiter,
    wallet: throwing("wallet"),
    ...overrides,
  }) as unknown as ApprovalDecisionDeps;

// A minimal ApprovalQueue double: get returns a single crafted approval and
// payload returns a fixed value; approve/deny/list track removal.
const doubleQueue = (approval: PendingApproval | null, payload: unknown): ApprovalQueue =>
  ({
    approve: () => approval,
    claim: () => (approval ? { approval, payload: payload as never } : null),
    deny: () => approval,
    get: () => approval,
    list: () => [],
    payload: () => payload,
    request: () => approval as PendingApproval,
    requestAddChain: () => approval as PendingApproval,
    requestDeclare: () => approval as PendingApproval,
    requestInvoke: () => approval as PendingApproval,
    requestSignTypedData: () => approval as PendingApproval,
    requestStrk20Invoke: () => approval as PendingApproval,
    requestSwitchChain: () => approval as PendingApproval,
    requestWatchAsset: () => approval as PendingApproval,
  }) as unknown as ApprovalQueue;

const approve = (id: string) => ({ id, type: "wallet.approveOrigin" as const });

describe("handleApprovalDecision invalid input / not-found", () => {
  test("rejects a malformed approve request", async () => {
    const deps = baseDeps(doubleQueue(null, null));
    await expect(
      handleApprovalDecision(deps, "wallet.approveOrigin", { type: "wallet.approveOrigin" }),
    ).resolves.toEqual({ error: "invalid approval request" });
  });

  test("returns approval-not-found when the id is unknown", async () => {
    const deps = baseDeps(doubleQueue(null, null));
    await expect(
      handleApprovalDecision(deps, "wallet.approveOrigin", approve(uuid())),
    ).resolves.toEqual({ error: "approval not found" });
  });

  test("rejects a malformed deny request", async () => {
    const deps = baseDeps(doubleQueue(null, null));
    await expect(
      handleApprovalDecision(deps, "wallet.denyOrigin", {
        id: "not-a-uuid",
        type: "wallet.denyOrigin",
      }),
    ).resolves.toEqual({ error: "invalid approval request" });
  });

  test("returns null for an unrelated message type", async () => {
    const deps = baseDeps(doubleQueue(null, null));
    expect(await handleApprovalDecision(deps, "wallet.other", {})).toBeNull();
  });
});

describe("handleApprovalDecision missing-payload guards", () => {
  const cases: { kind: PendingApproval["kind"]; payload: unknown }[] = [
    { kind: "watch-asset", payload: null },
    { kind: "invoke", payload: null },
    { kind: "strk20-invoke", payload: {} },
    { kind: "sign-typed-data", payload: {} },
    { kind: "switch-chain", payload: {} },
    { kind: "add-chain", payload: {} },
    { kind: "declare", payload: {} },
  ];

  for (const { kind, payload } of cases) {
    test(`${kind} approval with a missing payload returns approval-not-found`, async () => {
      const id = uuid();
      // watch-asset reaches its own missing-token guard (token undefined);
      // the others reach the missing-payload guard.
      const approval = { id, kind, origin: ORIGIN } as PendingApproval;
      const deps = baseDeps(doubleQueue(approval, payload));
      await expect(
        handleApprovalDecision(deps, "wallet.approveOrigin", approve(id)),
      ).resolves.toEqual({ error: "approval not found" });
    });
  }
});

describe("handleApprovalDecision error-result passthrough (locked session)", () => {
  // Each executor short-circuits to { error: "wallet locked" } with a locked
  // session, so the handler's `if ("error" in result) return result;` returns
  // that error for every executed kind.
  const lockedDeps = (approvals: ApprovalQueue) =>
    baseDeps(approvals, { session: createUnlockSession() });

  test("invoke approval passes the executor error through", async () => {
    const approvals = createApprovalQueue();
    const { id } = approvals.requestInvoke({
      fee: {
        fee: null,
        feeAffordability: "unknown",
        feeEstimateFailed: false,
        requiresDeployment: false,
      },
      calls: [{ calldata: [], contractAddress: "0x1", entrypoint: "transfer" }],
      context: CONTEXT,
      flags: [],
      origin: ORIGIN,
      summaries: ["Transfer"],
    });
    await expect(
      handleApprovalDecision(lockedDeps(approvals), "wallet.approveOrigin", approve(id)),
    ).resolves.toEqual({ error: "wallet locked" });
  });

  test("strk20-invoke approval passes the executor error through", async () => {
    const approvals = createApprovalQueue();
    const { id } = approvals.requestStrk20Invoke({
      actions: [{ amount: "1", kind: "transfer", to: "0x2", token: "0x3" } as never],
      calls: [{ calldata: [], contractAddress: "0x1", entrypoint: "execute" }],
      context: CONTEXT,
      origin: ORIGIN,
      summaries: ["Send"],
    });
    await expect(
      handleApprovalDecision(lockedDeps(approvals), "wallet.approveOrigin", approve(id)),
    ).resolves.toEqual({ error: "wallet locked" });
  });

  test("sign-typed-data approval passes the executor error through", async () => {
    const approvals = createApprovalQueue();
    const { id } = approvals.requestSignTypedData({
      context: CONTEXT,
      origin: ORIGIN,
      summary: "Sign message",
      typedData: { domain: {}, message: {}, primaryType: "X", types: {} },
    });
    await expect(
      handleApprovalDecision(lockedDeps(approvals), "wallet.approveOrigin", approve(id)),
    ).resolves.toEqual({ error: "wallet locked" });
  });

  test("switch-chain approval passes the executor error through", async () => {
    const approvals = createApprovalQueue();
    const { id } = approvals.requestSwitchChain({
      chainId: "0x534e5f4d41494e",
      networkId: "SN_MAIN",
      origin: ORIGIN,
      summary: "Switch",
    });
    await expect(
      handleApprovalDecision(lockedDeps(approvals), "wallet.approveOrigin", approve(id)),
    ).resolves.toEqual({ error: "wallet locked" });
  });

  test("declare approval passes the executor error through", async () => {
    const approvals = createApprovalQueue();
    const { id } = approvals.requestDeclare({
      context: CONTEXT,
      declare: { compiledClassHash: "0x1", contract: {} } as never,
      declaration: {
        abiEntryCount: 0,
        accountDeployment: "deployed",
        compiledClassHash: "0x1",
        deploymentFee: null,
        deploymentFeeEstimateFailed: false,
        entryPointCount: 0,
        fee: { overallFee: "1000", unit: "FRI" },
        feeEstimateFailed: false,
        sierraProgramLength: 1,
      },
      origin: ORIGIN,
      summaries: ["Declare"],
    });
    await expect(
      handleApprovalDecision(lockedDeps(approvals), "wallet.approveOrigin", approve(id)),
    ).resolves.toEqual({ error: "wallet locked" });
  });
});
