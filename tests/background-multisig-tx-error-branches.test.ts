/**
 * Error/validation branches of the transaction-submitting multisig message
 * handlers: invalid-input returns, not-found / not-a-signer failures from
 * `proposalById`, status-refresh failures and terminal-state rejections, the
 * class-status/declare guards, and the two rare "could not compose/store the
 * proposal" envelopes (driven with a bad transaction-id RPC and a
 * proposal-dropping store).
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../src/background/messages";
import { createUnlockSession } from "../src/background/session";
import type { MultisigProposalState } from "../src/starknet/multisig";
import { MULTISIG_CLASS_HASH } from "../src/starknet/multisig-deploy";
import type { MultisigProposalRecord } from "../src/storage/multisig-store";
import { type MultisigStore, memoryMultisigStore } from "../src/storage/multisig-store";
import type { AccountRef, Vault } from "../src/storage/vault-schema";
import {
  HARNESS_MULTISIG,
  HARNESS_OTHER_SIGNER,
  HARNESS_TARGET,
  harnessAccount,
  harnessExtensionSender,
  makeMultisigHarness,
} from "./support/multisig-harness";

const staticStatus = (state: MultisigProposalState) => () => ({
  confirmations: 1,
  confirmedBySigner: false,
  state,
});
const throwingStatus = () => () => {
  throw new Error("rpc down");
};

const watch = (handler: ReturnType<typeof makeMultisigHarness>["handler"]) =>
  handler(
    { address: HARNESS_MULTISIG, name: "Treasury", type: "wallet.addMultisig" },
    harnessExtensionSender,
  );

const propose = (handler: ReturnType<typeof makeMultisigHarness>["handler"], multisigId: string) =>
  handler(
    {
      calldata: ["0x5", "0x0"],
      entrypoint: "transfer",
      multisigId,
      summary: "Pay vendor",
      to: HARNESS_TARGET,
      type: "wallet.proposeMultisigTx",
    },
    harnessExtensionSender,
  );

const watchAndPropose = async (harness: ReturnType<typeof makeMultisigHarness>) => {
  const watched = (await watch(harness.handler)) as { multisig: { id: string } };
  const { proposal } = (await propose(harness.handler, watched.multisig.id)) as {
    proposal: MultisigProposalRecord;
  };
  return { multisigId: watched.multisig.id, proposal };
};

describe("multisig tx handler invalid-input returns", () => {
  const cases: { type: string; error: string; message: Record<string, unknown> }[] = [
    {
      error: "invalid propose request",
      message: { multisigId: "x" },
      type: "wallet.proposeMultisigTx",
    },
    { error: "invalid confirm request", message: {}, type: "wallet.confirmMultisigProposal" },
    { error: "invalid revoke request", message: {}, type: "wallet.revokeMultisigConfirmation" },
    { error: "invalid execute request", message: {}, type: "wallet.executeMultisigProposal" },
    {
      error: "invalid class status request",
      message: { extra: true },
      type: "wallet.multisigClassStatus",
    },
    {
      error: "invalid declare request",
      message: { extra: true },
      type: "wallet.declareMultisigClass",
    },
  ];

  for (const { type, error, message } of cases) {
    test(`${type} rejects a malformed message`, async () => {
      const { handler } = makeMultisigHarness();
      await expect(handler({ ...message, type }, harnessExtensionSender)).resolves.toEqual({
        error,
      });
    });
  }
});

describe("multisig tx handler proposalById failures", () => {
  test("confirm fails when the active account is no longer a signer", async () => {
    const signers = [harnessAccount.address, HARNESS_OTHER_SIGNER];
    const harness = makeMultisigHarness({ proposalStatus: staticStatus("pending"), signers });
    const { proposal } = await watchAndPropose(harness);
    // Drop the active account from the on-chain signer set after proposing.
    signers.splice(0, signers.length, HARNESS_OTHER_SIGNER);
    await expect(
      harness.handler(
        { proposalId: proposal.id, type: "wallet.confirmMultisigProposal" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "the active account is not a signer of this multisig" });
  });
});

describe("multisig tx handler status-refresh failures and terminal states", () => {
  test("revoke surfaces a status-refresh failure", async () => {
    const harness = makeMultisigHarness({ proposalStatus: throwingStatus() });
    const { proposal } = await watchAndPropose(harness);
    await expect(
      harness.handler(
        { proposalId: proposal.id, type: "wallet.revokeMultisigConfirmation" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "could not refresh proposal status — try again" });
  });

  test("revoke refuses a proposal that is already executed", async () => {
    const harness = makeMultisigHarness({ proposalStatus: staticStatus("executed") });
    const { proposal } = await watchAndPropose(harness);
    await expect(
      harness.handler(
        { proposalId: proposal.id, type: "wallet.revokeMultisigConfirmation" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "cannot revoke a proposal that is executed" });
  });

  test("execute surfaces a status-refresh failure", async () => {
    const harness = makeMultisigHarness({ proposalStatus: throwingStatus() });
    const { proposal } = await watchAndPropose(harness);
    await expect(
      harness.handler(
        { proposalId: proposal.id, type: "wallet.executeMultisigProposal" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "could not refresh proposal status — try again" });
  });
});

describe("multisig class-status and declare guards", () => {
  test("multisigClassStatus reports the declared flag on the happy path", async () => {
    const { handler } = makeMultisigHarness({ classDeclared: true });
    await expect(
      handler({ type: "wallet.multisigClassStatus" }, harnessExtensionSender),
    ).resolves.toEqual({ declared: true, ok: true });
  });

  test("multisigClassStatus surfaces the account-context error when locked", async () => {
    // A locked session makes activeAccountContext resolve to an error, which the
    // class-status handler passes straight through.
    const handler = localHandler({
      computeTransactionId: async () => `0x7${"a".repeat(62)}`,
      locked: true,
    });
    await expect(
      handler({ type: "wallet.multisigClassStatus" }, harnessExtensionSender),
    ).resolves.toEqual({ error: "wallet locked" });
  });

  test("declareMultisigClass fails when no class artifact loader is wired", async () => {
    const { handler } = makeMultisigHarness({ classDeclared: false });
    await expect(
      handler({ type: "wallet.declareMultisigClass" }, harnessExtensionSender),
    ).resolves.toEqual({ error: "multisig class artifact unavailable" });
  });

  test("declareMultisigClass scans prior activity for a pending declare", async () => {
    // A prior successful propose seeds an activity entry, so the pending-declare
    // scan predicate runs against a non-empty log before the artifact check.
    const harness = makeMultisigHarness({
      classDeclared: false,
      loadClass: async () => ({ entry_points_by_type: { EXTERNAL: [] }, sierra_program: ["0x1"] }),
    });
    await watchAndPropose(harness);
    const result = (await harness.handler(
      { type: "wallet.declareMultisigClass" },
      harnessExtensionSender,
    )) as { error?: string; ok?: true };
    // The pending-declare scan runs against the seeded activity (non-empty log)
    // before the artifact check rejects the stand-in class, so the call returns
    // an error rather than declaring.
    expect(result.ok).toBeUndefined();
    expect(typeof result.error).toBe("string");
    expect(result.error?.length ?? 0).toBeGreaterThan(0);
  });
});

// --- Local handler for the two rare compose/store envelopes -----------------
// createMessageHandler with controllable multisig RPC + store, mirroring the
// shared harness but exposing the knobs it does not.
const vault = {
  accounts: [harnessAccount],
  activeAccountId: harnessAccount.id,
} as unknown as Vault;

const localWallet = {
  async addDerivedAccount() {
    return harnessAccount;
  },
  async createAccount() {
    return harnessAccount;
  },
  async ensureNetworkAccount() {
    return harnessAccount;
  },
  async getGrantedAccounts() {
    return [harnessAccount] as readonly AccountRef[];
  },
  async generateMnemonic() {
    return "unused";
  },
  async grantOrigin() {
    return [harnessAccount];
  },
  async readVault() {
    return vault;
  },
  async setActiveAccount() {
    return harnessAccount;
  },
  async signHash() {
    return { publicKey: harnessAccount.publicKeyX, r: "0x1", s: "0x2" };
  },
  async status() {
    return {
      accountCount: 1,
      activeAccountId: harnessAccount.id,
      hasVault: true,
      locked: false,
      ready: false,
    };
  },
};

const localHandler = (opts: {
  computeTransactionId: () => Promise<string>;
  locked?: boolean;
  multisigStore?: MultisigStore;
}) => {
  const session = createUnlockSession();
  if (!opts.locked) {
    session.unlock("correct horse battery staple");
  }
  return createMessageHandler(localWallet, "extension-id", {
    multisigStore: opts.multisigStore ?? memoryMultisigStore(),
    runtimeRpc: {
      async estimateInvokeFee() {
        return { overallFee: "1", unit: "FRI" };
      },
      async getDeploymentStatus() {
        return false;
      },
      async getNftOwner() {
        return harnessAccount.address;
      },
      async getTokenBalances() {
        return [];
      },
      async getTokenMetadata() {
        return { decimals: 18, name: "Ether", symbol: "ETH" };
      },
      async getTransactionStatuses() {
        return {};
      },
      multisig: {
        computeTransactionId: opts.computeTransactionId,
        async getConfig() {
          return { quorum: 2, signers: [harnessAccount.address, HARNESS_OTHER_SIGNER] };
        },
        async getProposalStatus() {
          return { confirmations: 0, confirmedBySigner: false, state: "pending" as const };
        },
        async isClassDeclared() {
          return true;
        },
      },
      async submitDeclareTransaction() {
        return { classHash: MULTISIG_CLASS_HASH, transactionHash: "0xdec" };
      },
      async submitAccountDeployment() {
        return { transactionHash: "0x7de" };
      },
      async submitErc20Transfer() {
        return {
          call: { calldata: [], contractAddress: HARNESS_TARGET, entrypoint: "transfer" },
          transactionHash: "0x7ab",
        };
      },
      async submitInvokeTransaction(input) {
        return { calls: input.calls, transactionHash: "0x7cd" };
      },
    },
    session,
  });
};

const localWatchAndPropose = (handler: ReturnType<typeof localHandler>) =>
  handler(
    { address: HARNESS_MULTISIG, name: "Treasury", type: "wallet.addMultisig" },
    harnessExtensionSender,
  ).then((watched) =>
    handler(
      {
        calldata: ["0x5", "0x0"],
        entrypoint: "transfer",
        multisigId: (watched as { multisig: { id: string } }).multisig.id,
        summary: "Pay vendor",
        to: HARNESS_TARGET,
        type: "wallet.proposeMultisigTx",
      },
      harnessExtensionSender,
    ),
  );

describe("multisig propose compose/store envelopes", () => {
  test("rejects when the computed transaction id is not a felt", async () => {
    const handler = localHandler({ computeTransactionId: async () => "not-a-felt" });
    await expect(localWatchAndPropose(handler)).resolves.toEqual({
      error: "invalid propose request",
    });
  });

  test("returns the broadcast hash when proposal persistence fails", async () => {
    const base = memoryMultisigStore();
    // A store that accepts the multisig but silently drops proposals.
    const droppingStore: MultisigStore = { ...base, async upsertProposal() {} };
    const handler = localHandler({
      computeTransactionId: async () => `0x7${"a".repeat(62)}`,
      multisigStore: droppingStore,
    });
    const response = await localWatchAndPropose(handler);
    expect(response).toMatchObject({
      ok: true,
      transactionHash: "0x7cd",
    });
  });
});

describe("multisig proposalById multisig-context failure", () => {
  test("confirm fails when the proposal's multisig is gone from the store", async () => {
    // The proposal is present but its multisig is absent, so multisigContext
    // resolves to "multisig not found" inside proposalById.
    const orphanProposal: MultisigProposalRecord = {
      call: { calldata: [], contractAddress: HARNESS_TARGET, entrypoint: "transfer", salt: "0x0" },
      confirmations: 0,
      id: "orphan-proposal-id",
      multisigId: "missing-multisig-id",
      state: "pending",
      summary: "Orphan",
      txId: `0x7${"a".repeat(62)}`,
    };
    const orphanStore: MultisigStore = {
      ...memoryMultisigStore(),
      async listMultisigs() {
        return [];
      },
      async listProposals() {
        return [orphanProposal];
      },
    };
    const handler = localHandler({
      computeTransactionId: async () => `0x7${"a".repeat(62)}`,
      multisigStore: orphanStore,
    });
    await expect(
      handler(
        { proposalId: orphanProposal.id, type: "wallet.confirmMultisigProposal" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "multisig not found" });
  });
});
