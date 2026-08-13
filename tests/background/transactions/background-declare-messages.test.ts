/**
 * wallet_addDeclareTransaction held-approval gate: a declare is never submitted
 * without an explicit user approval. It is queued as a "declare" approval and
 * held; the declare is signed and submitted only on approve, dropped on deny
 * (mapping to USER_REFUSED_OP on the wire). Unconnected origins never queue, and
 * the large CONTRACT_CLASS is never surfaced in the approval snapshot.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@mc-wallet/core/errors";
import type { FeeEstimate } from "@mc-wallet/starknet/fee-bounds";
import type { DeclareInput } from "@mc-wallet/starknet/rpc";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { createApprovalQueue } from "../../../apps/extension/src/background/approvals/approvals";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { unavailablePreferencesStore } from "../../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { flushHeld, latestApprovalId, waitForPendingApprovals } from "../../support/held";

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const vaultPassphrase = "correct horse battery staple";
const origin = "https://dapp.example";
const contentSender: RuntimeSender = { id: "extension-id", url: `${origin}/app` };
const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};

const declare = {
  classHash: "0x5abc",
  compiledClassHash: "0x6def",
  contractClass: { entry_points_by_type: { EXTERNAL: [] }, sierra_program: ["0x1"] },
};
const DECLARATION_FEE = { overallFee: "2500000000000000", unit: "FRI" } as const;
const DEPLOYMENT_FEE = { overallFee: "1500000000000000", unit: "FRI" } as const;
const DECLARATION_TOTAL_FEE = { overallFee: "4000000000000000", unit: "FRI" } as const;

const walletStub = (connected: readonly AccountRef[]) => ({
  async addDerivedAccount() {
    return account;
  },
  async createAccount() {
    return account;
  },
  async ensureNetworkAccount() {
    return account;
  },
  async getGrantedAccounts(target: string) {
    return target === origin ? connected : [];
  },
  async generateMnemonic() {
    return "unused";
  },
  async grantOrigin() {
    return connected;
  },
  async readVault() {
    return {
      accounts: [account],
      accountSecrets: [],
      activeAccountId: account.id,
      mnemonic: null,
      originGrants: [{ accountIds: [account.id], origin }],
      schemaVersion: 4 as const,
      signingKeys: [{ accountId: account.id, privateKey: "0x123456" }],
    };
  },
  async setActiveAccount() {
    return account;
  },
  async signHash() {
    return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
  },
  async status() {
    return {
      accountCount: 1,
      activeAccountId: account.id,
      hasVault: true,
      locked: false,
      ready: true,
    };
  },
});

const makeHarness = (
  connected: readonly AccountRef[] = [account],
  deployed = true,
  estimates: {
    readonly declaration?: () => FeeEstimate | Promise<FeeEstimate>;
    readonly deployment?: () => FeeEstimate | Promise<FeeEstimate>;
  } = {},
) => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const approvals = createApprovalQueue();
  const declared: DeclareInput[] = [];
  const deployEstimated: DeclareInput[] = [];
  const estimated: DeclareInput[] = [];
  const rpc = {
    async estimateAccountDeploymentFee(input: DeclareInput) {
      deployEstimated.push(input);
      return estimates.deployment?.() ?? DEPLOYMENT_FEE;
    },
    async estimateDeclareFee(input: DeclareInput) {
      estimated.push(input);
      return estimates.declaration?.() ?? DECLARATION_FEE;
    },
    async getDeploymentStatus() {
      return deployed;
    },
    async submitDeclareTransaction(input: DeclareInput) {
      declared.push(input);
      return { classHash: "0x7ce", transactionHash: "0x7cd" };
    },
  } as unknown as RuntimeRpc;
  const handler = createMessageHandler(walletStub(connected), "extension-id", {
    approvals,
    preferencesStore: unavailablePreferencesStore,
    runtimeRpc: rpc,
    session,
  });
  return { declared, deployEstimated, estimated, handler };
};

const declareMessage = (overrides: Record<string, unknown> = {}) => ({
  declare: { ...declare, ...overrides },
  origin,
  type: "wallet.addDeclareTransaction" as const,
});

describe("wallet_addDeclareTransaction held approval", () => {
  test("queues a declare approval without submitting or leaking the contract class", async () => {
    const { declared, estimated, handler } = makeHarness();

    const held = handler(declareMessage(), contentSender);
    const pending = (
      await waitForPendingApprovals<{
        declaration?: {
          abiEntryCount: number;
          accountDeployment: string;
          classHash?: string;
          compiledClassHash: string;
          deploymentFee: { overallFee: string; unit: string } | null;
          deploymentFeeEstimateFailed: boolean;
          entryPointCount: number;
          fee: { overallFee: string; unit: string } | null;
          feeEstimateFailed: boolean;
          sierraProgramLength: number;
        };
        declare?: unknown;
        id: string;
        kind?: string;
        origin?: string;
        summaries?: readonly string[];
      }>(handler, extensionSender)
    ).at(-1);
    expect(pending).toMatchObject({ kind: "declare", origin });
    expect(pending?.declaration).toEqual({
      abiEntryCount: 0,
      accountDeployment: "deployed",
      classHash: declare.classHash,
      compiledClassHash: declare.compiledClassHash,
      deploymentFee: null,
      deploymentFeeEstimateFailed: false,
      entryPointCount: 0,
      fee: { overallFee: "2500000000000000", unit: "FRI" },
      feeEstimateFailed: false,
      sierraProgramLength: 1,
    });
    // The CONTRACT_CLASS must never reach the UI snapshot.
    expect(JSON.stringify(pending)).not.toContain("sierra_program");
    expect(declared).toHaveLength(0);
    expect(estimated).toHaveLength(1);

    const id = await latestApprovalId(handler, extensionSender);
    await handler({ id, type: "wallet.denyOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ error: "request rejected" });
  });

  test("submits the declare and returns hashes only after approval", async () => {
    const { declared, handler } = makeHarness();

    const held = handler(declareMessage(), contentSender);
    await flushHeld();
    const id = await latestApprovalId(handler, extensionSender);

    await expect(handler({ id, type: "wallet.approveOrigin" }, extensionSender)).resolves.toEqual({
      error: "retry the fee estimate before approving this transaction",
    });
    expect(declared).toHaveLength(0);
    await expect(
      handler({ id, reviewedFee: DECLARATION_FEE, type: "wallet.approveOrigin" }, extensionSender),
    ).resolves.toEqual({ ok: true, pending: [] });
    await expect(held).resolves.toEqual({
      classHash: "0x7ce",
      ok: true,
      transactionHash: "0x7cd",
    });
    expect(declared).toHaveLength(1);
    expect(declared[0]?.compiledClassHash).toBe(declare.compiledClassHash);
    expect(declared[0]?.classHash).toBe(declare.classHash);
    // MCW-V09-119: the declaration fee the card displayed travels into the
    // submission as a ceiling, so a declare that got more expensive while the
    // card was open is refused rather than signed at the new price.
    expect(declared[0]?.reviewedFee).toEqual({ overallFee: "2500000000000000", unit: "FRI" });
  });

  test("shows both STRK fee estimates when account deployment is required", async () => {
    const { deployEstimated, handler } = makeHarness([account], false);
    const held = handler(declareMessage(), contentSender);
    const pending = (
      await waitForPendingApprovals<{
        declaration?: {
          accountDeployment: string;
          deploymentFee: { overallFee: string; unit: string } | null;
          deploymentFeeEstimateFailed: boolean;
        };
        id: string;
      }>(handler, extensionSender)
    ).at(-1);

    expect(pending?.declaration).toMatchObject({
      accountDeployment: "undeployed",
      deploymentFee: { overallFee: "1500000000000000", unit: "FRI" },
      deploymentFeeEstimateFailed: false,
    });
    expect(deployEstimated).toHaveLength(1);
    await handler({ id: pending?.id, type: "wallet.denyOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ error: "request rejected" });
  });

  test("carries BOTH displayed fees into the submission as ceilings", async () => {
    // The card adds the declaration fee and the deployment fee into an
    // "Estimated total" (approval-cards.ts). Approving submits a deployment and
    // then a declaration; binding only the declaration would leave the larger
    // half of that total enforced by nothing, which is MCW-V09-119 restated one
    // transaction over.
    const { declared, handler } = makeHarness([account], false);
    const held = handler(declareMessage(), contentSender);
    await flushHeld();
    const id = await latestApprovalId(handler, extensionSender);

    await handler(
      { id, reviewedFee: DECLARATION_TOTAL_FEE, type: "wallet.approveOrigin" },
      extensionSender,
    );
    await expect(held).resolves.toMatchObject({ ok: true });
    expect(declared[0]?.reviewedFee).toEqual({ overallFee: "2500000000000000", unit: "FRI" });
    expect(declared[0]?.reviewedDeploymentFee).toEqual({
      overallFee: "1500000000000000",
      unit: "FRI",
    });
  });

  test("a stale card cannot approve a refreshed account-deployment fee", async () => {
    const inflated = { overallFee: "9000000000000000", unit: "FRI" } as const;
    let deploymentChecks = 0;
    let resolveRetry: ((fee: FeeEstimate) => void) | undefined;
    const { declared, handler } = makeHarness([account], false, {
      deployment: () => {
        deploymentChecks += 1;
        return deploymentChecks === 1
          ? DEPLOYMENT_FEE
          : new Promise((resolve) => {
              resolveRetry = resolve;
            });
      },
    });
    const held = handler(declareMessage(), contentSender);
    await flushHeld();
    const id = await latestApprovalId(handler, extensionSender);

    const retry = handler({ id, type: "wallet.retryApprovalFee" }, extensionSender);
    await flushHeld();
    await expect(
      handler(
        { id, reviewedFee: DECLARATION_TOTAL_FEE, type: "wallet.approveOrigin" },
        extensionSender,
      ),
    ).resolves.toEqual({ error: "retry the fee estimate before approving this transaction" });
    resolveRetry?.(inflated);
    await expect(retry).resolves.toEqual({ ok: true });
    await expect(
      handler(
        { id, reviewedFee: DECLARATION_TOTAL_FEE, type: "wallet.approveOrigin" },
        extensionSender,
      ),
    ).resolves.toEqual({ error: "the fee changed since this request was reviewed" });
    expect(declared).toHaveLength(0);

    await handler(
      {
        id,
        reviewedFee: { overallFee: "11500000000000000", unit: "FRI" },
        type: "wallet.approveOrigin",
      },
      extensionSender,
    );
    await expect(held).resolves.toMatchObject({ ok: true });
    expect(declared[0]?.reviewedFee).toEqual(DECLARATION_FEE);
    expect(declared[0]?.reviewedDeploymentFee).toEqual(inflated);
  });

  test("drops the declare when the user denies", async () => {
    const { declared, handler } = makeHarness();

    const held = handler(declareMessage(), contentSender);
    await flushHeld();
    const id = await latestApprovalId(handler, extensionSender);

    await handler({ id, type: "wallet.denyOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ error: "request rejected" });
    expect(declared).toHaveLength(0);
  });

  test("rejects a declare from an unconnected origin without queueing", async () => {
    const { declared, handler } = makeHarness([]);
    await expect(handler(declareMessage(), contentSender)).resolves.toEqual({
      error: "origin not connected",
    });
    expect(declared).toHaveLength(0);
  });

  test("rejects a malformed declare payload", async () => {
    const { handler } = makeHarness();
    await expect(
      handler(declareMessage({ compiledClassHash: "not-hex" }), contentSender),
    ).resolves.toEqual({ error: "invalid declare request" });
  });
});

// A harness whose submit drives the injected signer before broadcasting, and
// whose signer throws — standing in for a Ledger device rejection/timeout/
// verify-failure. Proves the declare executor catches the throw, returns
// `{ error }`, and the applier settles the held request instead of hanging.
const makeThrowingSignHarness = () => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const approvals = createApprovalQueue();
  const declared: DeclareInput[] = [];
  const rpc = {
    async estimateDeclareFee() {
      return DECLARATION_FEE;
    },
    async getDeploymentStatus() {
      return true;
    },
    async submitDeclareTransaction(input: DeclareInput) {
      // Drive the signer first: a device rejection surfaces here, before any
      // broadcast, so `declared` stays empty on a sign failure (fail-closed).
      await input.signHash("0x1");
      declared.push(input);
      return { classHash: "0x7ce", transactionHash: "0x7cd" };
    },
  } as unknown as RuntimeRpc;
  const wallet = {
    ...walletStub([account]),
    async signHash(): Promise<never> {
      throw new WalletError("device rejected the declare");
    },
  };
  const handler = createMessageHandler(wallet, "extension-id", {
    approvals,
    preferencesStore: unavailablePreferencesStore,
    runtimeRpc: rpc,
    session,
  });
  return { declared, handler };
};

describe("declare approval settles the held request when signing throws", () => {
  test("returns { error } and submits nothing instead of hanging the dapp promise", async () => {
    const { declared, handler } = makeThrowingSignHarness();

    const held = handler(declareMessage(), contentSender);
    await flushHeld();
    const id = await latestApprovalId(handler, extensionSender);

    // Approve: the executor's sign step throws, but the applier still settles the
    // held request with the real error rather than leaving the dapp promise open.
    await expect(
      handler({ id, reviewedFee: DECLARATION_FEE, type: "wallet.approveOrigin" }, extensionSender),
    ).resolves.toEqual({ error: "device rejected the declare" });
    await expect(held).resolves.toEqual({ error: "device rejected the declare" });
    expect(declared).toHaveLength(0);
  });
});
