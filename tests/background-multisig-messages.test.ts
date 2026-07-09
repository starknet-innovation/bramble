/**
 * Multisig message checks: watching requires on-chain signer membership,
 * proposals round-trip through submit/confirm/execute with exact component
 * calldata, pasted ids can be tracked but not executed, and deploys go
 * through the UDC only after the pinned class is declared.
 */
import { describe, expect, test } from "bun:test";
import { hash } from "starknet";
import { createMessageHandler } from "../src/background/messages";
import type { RuntimeSender } from "../src/background/senders";
import { createUnlockSession } from "../src/background/session";
import type { MultisigProposalState } from "../src/starknet/multisig";
import { MULTISIG_CLASS_HASH, predictMultisigAddress } from "../src/starknet/multisig-deploy";
import { type MultisigProposalRecord, memoryMultisigStore } from "../src/storage/multisig-store";
import type { AccountRef, Vault } from "../src/storage/vault-schema";

const MULTISIG = "0x111111111111111111111111111111111111111111111111111111111111111";
const TARGET = "0x222222222222222222222222222222222222222222222222222222222222222";
const OTHER_SIGNER = "0x444444444444444444444444444444444444444444444444444444444444444";
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
const contentSender: RuntimeSender = { id: "extension-id", url: "https://dapp.example/app" };

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
      ready: false,
    };
  },
};

type HarnessOptions = {
  readonly classDeclared?: boolean;
  readonly contractAt?: boolean;
  readonly loadClass?: () => Promise<unknown>;
  readonly signers?: readonly string[];
  readonly state?: MultisigProposalState;
};

const makeHarness = (options: HarnessOptions = {}) => {
  const session = createUnlockSession();
  session.unlock("correct horse battery staple");
  const multisigStore = memoryMultisigStore();
  const invokeCalls: (readonly unknown[])[] = [];
  const declared: unknown[] = [];
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
        return options.contractAt ?? false;
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
          return "0xabc";
        },
        async getConfig() {
          return { quorum: 2, signers: options.signers ?? [account.address, OTHER_SIGNER] };
        },
        async getProposalStatus() {
          return {
            confirmations: 1,
            confirmedBySigner: false,
            state: options.state ?? "pending",
          };
        },
        async isClassDeclared() {
          return options.classDeclared ?? true;
        },
      },
      async submitDeclareTransaction(input) {
        declared.push(input);
        return { classHash: MULTISIG_CLASS_HASH, transactionHash: "0xdec" };
      },
      async submitAccountDeployment() {
        return { transactionHash: "0x7de" };
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
    options.loadClass,
  );
  return { declared, handler, invokeCalls, multisigStore };
};

const watch = async (handler: ReturnType<typeof makeHarness>["handler"]) =>
  handler({ address: MULTISIG, name: "Treasury", type: "wallet.addMultisig" }, extensionSender);

const propose = async (handler: ReturnType<typeof makeHarness>["handler"], multisigId: string) =>
  handler(
    {
      calldata: ["0x5", "0x0"],
      entrypoint: "transfer",
      multisigId,
      summary: "Pay vendor",
      to: TARGET,
      type: "wallet.proposeMultisigTx",
    },
    extensionSender,
  );

describe("multisig messages", () => {
  test("requires an extension page for every multisig message", async () => {
    const { handler } = makeHarness();
    for (const type of [
      "wallet.multisigs",
      "wallet.addMultisig",
      "wallet.deployMultisig",
      "wallet.proposeMultisigTx",
      "wallet.declareMultisigClass",
    ]) {
      await expect(handler({ type }, contentSender)).resolves.toEqual({
        error: "privileged sender required",
      });
    }
  });

  test("watches a multisig after proving signer membership on-chain", async () => {
    const { handler } = makeHarness();
    const response = await watch(handler);
    expect(response).toMatchObject({
      multisig: { name: "Treasury", quorum: 2 },
      ok: true,
    });
    const listed = (await handler({ type: "wallet.multisigs" }, extensionSender)) as {
      multisigs: readonly { id: string }[];
    };
    expect(listed.multisigs).toHaveLength(1);
  });

  test("refuses to watch a multisig the active account cannot sign for", async () => {
    const { handler } = makeHarness({ signers: [OTHER_SIGNER] });
    await expect(watch(handler)).resolves.toEqual({
      error: "the active account is not a signer of this multisig",
    });
  });

  test("proposes with the component calldata layout and stores the call", async () => {
    const { handler, invokeCalls } = makeHarness();
    const watched = (await watch(handler)) as { multisig: { id: string } };
    const response = await propose(handler, watched.multisig.id);
    expect(response).toMatchObject({
      ok: true,
      proposal: { state: "pending", summary: "Pay vendor", txId: "0xabc" },
      transactionHash: "0x7cd",
    });
    const submit = invokeCalls.at(-1)?.[0] as { calldata: string[]; entrypoint: string };
    expect(submit.entrypoint).toBe("submit_transaction");
    expect(submit.calldata).toEqual([
      TARGET,
      hash.getSelectorFromName("transfer"),
      "0x2",
      "0x5",
      "0x0",
      "0x0",
    ]);
  });

  test("confirms and executes a proposal submitted through this wallet", async () => {
    const { handler, invokeCalls } = makeHarness({ state: "confirmed" });
    const watched = (await watch(handler)) as { multisig: { id: string } };
    const proposed = (await propose(handler, watched.multisig.id)) as {
      proposal: MultisigProposalRecord;
    };

    const confirm = await handler(
      { proposalId: proposed.proposal.id, type: "wallet.confirmMultisigProposal" },
      extensionSender,
    );
    expect(confirm).toEqual({ ok: true, transactionHash: "0x7cd" });
    expect((invokeCalls.at(-1)?.[0] as { entrypoint: string }).entrypoint).toBe(
      "confirm_transaction",
    );

    const execute = await handler(
      { proposalId: proposed.proposal.id, type: "wallet.executeMultisigProposal" },
      extensionSender,
    );
    expect(execute).toEqual({ ok: true, transactionHash: "0x7cd" });
    const executed = invokeCalls.at(-1)?.[0] as { calldata: string[]; entrypoint: string };
    expect(executed.entrypoint).toBe("execute_transaction");
    expect(executed.calldata).toEqual([
      TARGET,
      hash.getSelectorFromName("transfer"),
      "0x2",
      "0x5",
      "0x0",
      "0x0",
    ]);
  });

  test("tracks a pasted proposal id but refuses to execute it", async () => {
    const { handler } = makeHarness();
    const watched = (await watch(handler)) as { multisig: { id: string } };
    const tracked = (await handler(
      { multisigId: watched.multisig.id, txId: "0xdef", type: "wallet.trackMultisigProposal" },
      extensionSender,
    )) as { proposal: MultisigProposalRecord };
    expect(tracked.proposal).toMatchObject({ call: null, state: "pending", txId: "0xdef" });

    const execute = await handler(
      { proposalId: tracked.proposal.id, type: "wallet.executeMultisigProposal" },
      extensionSender,
    );
    expect(execute).toMatchObject({ error: expect.stringContaining("tracked by id only") });
  });

  test("rejects tracking an id the contract does not know", async () => {
    const { handler } = makeHarness({ state: "not-found" });
    const watched = (await watch(handler)) as { multisig: { id: string } };
    await expect(
      handler(
        { multisigId: watched.multisig.id, txId: "0xdef", type: "wallet.trackMultisigProposal" },
        extensionSender,
      ),
    ).resolves.toEqual({ error: "no proposal with that id exists on this multisig" });
  });

  test("deploys through the UDC and watches the predicted address", async () => {
    const { handler, invokeCalls } = makeHarness();
    const response = (await handler(
      {
        name: "New treasury",
        quorum: 2,
        signers: [account.address, OTHER_SIGNER],
        type: "wallet.deployMultisig",
      },
      extensionSender,
    )) as { address: string; ok: true };
    expect(response.ok).toBe(true);
    expect(BigInt(response.address)).toBe(
      BigInt(
        predictMultisigAddress({
          quorum: 2,
          salt: "0x0",
          signers: [account.address, OTHER_SIGNER],
        }),
      ),
    );
    expect((invokeCalls.at(-1)?.[0] as { entrypoint: string }).entrypoint).toBe("deploy_contract");
    const listed = (await handler({ type: "wallet.multisigs" }, extensionSender)) as {
      multisigs: readonly { name?: string }[];
    };
    expect(listed.multisigs[0]?.name).toBe("New treasury");
  });

  test("fails deploys closed when the class is not declared", async () => {
    const { handler } = makeHarness({ classDeclared: false });
    await expect(
      handler(
        { quorum: 1, signers: [account.address], type: "wallet.deployMultisig" },
        extensionSender,
      ),
    ).resolves.toEqual({
      error: "multisig class not declared on this network — declare it first",
    });
  });

  test("refuses to deploy over an existing contract", async () => {
    const { handler } = makeHarness({ contractAt: true });
    await expect(
      handler(
        { quorum: 1, signers: [account.address], type: "wallet.deployMultisig" },
        extensionSender,
      ),
    ).resolves.toEqual({
      error: "a multisig with these signers and salt already exists — watch it instead",
    });
  });

  test("declares only an artifact matching the pinned class hash", async () => {
    const bad = makeHarness({ loadClass: async () => null });
    await expect(
      bad.handler({ type: "wallet.declareMultisigClass" }, extensionSender),
    ).resolves.toEqual({ error: "Bundled multisig class is malformed" });
    expect(bad.declared).toHaveLength(0);
  });
});
