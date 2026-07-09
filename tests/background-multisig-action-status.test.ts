/**
 * Multisig action status gates: confirm, revoke, and execute refresh proposal
 * state immediately before signing so stale local state cannot burn fees.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../src/background/messages";
import type { RuntimeSender } from "../src/background/senders";
import { createUnlockSession } from "../src/background/session";
import type { MultisigProposalStatus } from "../src/starknet/multisig";
import { MULTISIG_CLASS_HASH } from "../src/starknet/multisig-deploy";
import {
  type MultisigProposalRecord,
  type MultisigRecord,
  memoryMultisigStore,
  multisigId,
  multisigProposalId,
} from "../src/storage/multisig-store";
import type { AccountRef, Vault } from "../src/storage/vault-schema";

const MULTISIG = "0x111111111111111111111111111111111111111111111111111111111111111";
const TARGET = "0x222222222222222222222222222222222222222222222222222222222222222";
const TX_ID = "0xabc";

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const vault = { accounts: [account], activeAccountId: account.id } as unknown as Vault;
const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};

const walletStub = {
  async addDerivedAccount() {
    return account;
  },
  async createAccount() {
    return account;
  },
  async ensureNetworkAccount() {
    return account;
  },
  async getGrantedAccounts() {
    return [account];
  },
  async generateMnemonic() {
    return "unused";
  },
  async grantOrigin() {
    return [account];
  },
  async readVault() {
    return vault;
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
};

const makeHarness = async (status: MultisigProposalStatus | "throw") => {
  const session = createUnlockSession();
  session.unlock("correct horse battery staple");
  const multisigStore = memoryMultisigStore();
  const record: MultisigRecord = {
    address: MULTISIG,
    id: multisigId("SN_MAIN", MULTISIG) ?? "",
    networkId: "SN_MAIN",
    quorum: 1,
    signers: [account.address],
  };
  const proposal: MultisigProposalRecord = {
    call: { calldata: ["0x5"], contractAddress: TARGET, entrypoint: "transfer", salt: "0x0" },
    confirmations: 0,
    id: multisigProposalId(record.id, TX_ID) ?? "",
    multisigId: record.id,
    state: "pending",
    summary: "Pay vendor",
    txId: TX_ID,
  };
  await multisigStore.upsertMultisig(record);
  await multisigStore.upsertProposal(proposal);
  const invokeCalls: unknown[] = [];
  const handler = createMessageHandler(
    walletStub,
    "extension-id",
    session,
    undefined,
    undefined,
    {
      async estimateInvokeFee() {
        return { overallFee: "1", unit: "FRI" };
      },
      async getDeploymentStatus() {
        return false;
      },
      async getNftOwner() {
        return account.address;
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
        async computeTransactionId() {
          return TX_ID;
        },
        async getConfig() {
          return { quorum: 1, signers: [account.address] };
        },
        async getProposalStatus() {
          if (status === "throw") {
            throw new Error("rpc down");
          }
          return status;
        },
        async isClassDeclared() {
          return true;
        },
      },
      async submitAccountDeployment() {
        return { transactionHash: "0x7de" };
      },
      async submitDeclareTransaction() {
        return { classHash: MULTISIG_CLASS_HASH, transactionHash: "0xdec" };
      },
      async submitErc20Transfer() {
        return {
          call: { calldata: [], contractAddress: TARGET, entrypoint: "transfer" },
          transactionHash: "0x7ab",
        };
      },
      async submitInvokeTransaction(input) {
        invokeCalls.push(input.calls);
        return { calls: input.calls, transactionHash: "0x7cd" };
      },
    },
    undefined,
    undefined,
    undefined,
    undefined,
    multisigStore,
  );
  return { handler, invokeCalls, proposal };
};

const actionMessage = (
  type:
    | "wallet.confirmMultisigProposal"
    | "wallet.executeMultisigProposal"
    | "wallet.revokeMultisigConfirmation",
  proposalId: string,
) => ({ proposalId, type });

describe("multisig action status gates", () => {
  test("fails closed when proposal status cannot be refreshed", async () => {
    const { handler, invokeCalls, proposal } = await makeHarness("throw");
    await expect(
      handler(actionMessage("wallet.confirmMultisigProposal", proposal.id), extensionSender),
    ).resolves.toEqual({ error: "could not refresh proposal status — try again" });
    expect(invokeCalls).toHaveLength(0);
  });

  test("refuses to confirm when this signer already confirmed", async () => {
    const { handler, invokeCalls, proposal } = await makeHarness({
      confirmations: 1,
      confirmedBySigner: true,
      state: "pending",
    });
    await expect(
      handler(actionMessage("wallet.confirmMultisigProposal", proposal.id), extensionSender),
    ).resolves.toEqual({ error: "this account has already confirmed this proposal" });
    expect(invokeCalls).toHaveLength(0);
  });

  test("refuses to revoke when this signer has not confirmed", async () => {
    const { handler, invokeCalls, proposal } = await makeHarness({
      confirmations: 0,
      confirmedBySigner: false,
      state: "pending",
    });
    await expect(
      handler(actionMessage("wallet.revokeMultisigConfirmation", proposal.id), extensionSender),
    ).resolves.toEqual({ error: "this account has not confirmed this proposal" });
    expect(invokeCalls).toHaveLength(0);
  });

  test("refuses to execute before quorum is met", async () => {
    const { handler, invokeCalls, proposal } = await makeHarness({
      confirmations: 0,
      confirmedBySigner: false,
      state: "pending",
    });
    await expect(
      handler(actionMessage("wallet.executeMultisigProposal", proposal.id), extensionSender),
    ).resolves.toEqual({ error: "cannot execute a proposal that is pending" });
    expect(invokeCalls).toHaveLength(0);
  });

  test("refuses to confirm when proposal already has quorum", async () => {
    const { handler, invokeCalls, proposal } = await makeHarness({
      confirmations: 2,
      confirmedBySigner: false,
      state: "confirmed",
    });
    await expect(
      handler(actionMessage("wallet.confirmMultisigProposal", proposal.id), extensionSender),
    ).resolves.toEqual({
      error: "proposal already has quorum — execute it instead of adding more confirmations",
    });
    expect(invokeCalls).toHaveLength(0);
  });
});
