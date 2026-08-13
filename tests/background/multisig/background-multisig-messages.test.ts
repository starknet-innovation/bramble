/** Multisig message handler tests. */
import { describe, expect, test } from "bun:test";
import type { MultisigProposalState } from "@mc-wallet/multisig/chain";
import { predictMultisigAddress } from "@mc-wallet/multisig/deploy";
import { type MultisigProposalRecord, memoryMultisigStore } from "@mc-wallet/multisig/repository";
import { type ActivityLog, memoryActivityLog } from "@mc-wallet/transactions/activity";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { hash } from "starknet";
import {
  HARNESS_MULTISIG,
  HARNESS_OTHER_SIGNER,
  HARNESS_PROPOSED_TX_ID,
  HARNESS_TARGET,
  harnessAccount,
  harnessContentSender,
  harnessExtensionSender,
  makeMultisigHarness,
} from "../../support/multisig-harness";

const staticStatus = (state: MultisigProposalState) => () => ({
  confirmations: 1,
  confirmedBySigner: false,
  state,
});

const secondOwnedSigner: AccountRef = {
  address: HARNESS_OTHER_SIGNER,
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd1",
  derivation: { accountIndex: 1, addressIndex: 0, kind: "starknet-bip44" },
  id: `SN_MAIN:${HARNESS_OTHER_SIGNER}`,
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd1",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd1",
};

const watch = async (handler: ReturnType<typeof makeMultisigHarness>["handler"]) =>
  handler(
    { address: HARNESS_MULTISIG, name: "Treasury", type: "wallet.addMultisig" },
    harnessExtensionSender,
  );

const propose = async (
  handler: ReturnType<typeof makeMultisigHarness>["handler"],
  multisigId: string,
) =>
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
describe("multisig messages", () => {
  test("requires an extension page for every multisig message", async () => {
    const { handler } = makeMultisigHarness();
    for (const type of [
      "wallet.multisigs",
      "wallet.multisigBalances",
      "wallet.addMultisig",
      "wallet.deployMultisig",
      "wallet.proposeMultisigTx",
      "wallet.declareMultisigClass",
      "wallet.confirmMultisigProposal",
      "wallet.executeMultisigProposal",
      "wallet.revokeMultisigConfirmation",
      "wallet.trackMultisigProposal",
      "wallet.removeMultisig",
      "wallet.refreshMultisig",
      "wallet.multisigClassStatus",
    ]) {
      await expect(handler({ type }, harnessContentSender)).resolves.toEqual({
        error: "privileged sender required",
      });
    }
  });
  test("watches a multisig after proving signer membership on-chain", async () => {
    const { handler } = makeMultisigHarness();
    const response = await watch(handler);
    expect(response).toMatchObject({
      multisig: { name: "Treasury", quorum: 2 },
      ok: true,
    });
    const listed = (await handler({ type: "wallet.multisigs" }, harnessExtensionSender)) as {
      multisigs: readonly { id: string }[];
    };
    expect(listed.multisigs).toHaveLength(1);
  });
  test("loads portfolio balances for the watched contract, not the active signer", async () => {
    const { balanceReads, handler } = makeMultisigHarness();
    const watched = (await watch(handler)) as { multisig: { id: string } };
    await expect(
      handler({ id: watched.multisig.id, type: "wallet.multisigBalances" }, harnessExtensionSender),
    ).resolves.toMatchObject({
      accountId: watched.multisig.id,
      balances: [],
      networkId: "SN_MAIN",
      ok: true,
    });
    expect(balanceReads).toEqual([HARNESS_MULTISIG]);
  });
  test("refuses to watch a multisig the active account cannot sign for", async () => {
    const { handler } = makeMultisigHarness({ signers: [HARNESS_OTHER_SIGNER] });
    await expect(watch(handler)).resolves.toEqual({
      error: "the active account is not a signer of this multisig",
    });
  });
  test("proposes with the component calldata layout and stores the call", async () => {
    const { handler, invokeCalls } = makeMultisigHarness();
    const watched = (await watch(handler)) as { multisig: { id: string } };
    const response = await propose(handler, watched.multisig.id);
    expect(response).toMatchObject({
      ok: true,
      proposal: { state: "pending", summary: "Pay vendor", txId: HARNESS_PROPOSED_TX_ID },
      transactionHash: "0x7cd",
    });
    const submit = invokeCalls.at(-1)?.[0] as { calldata: string[]; entrypoint: string };
    expect(submit.entrypoint).toBe("submit_transaction");
    expect(submit.calldata).toEqual([
      HARNESS_TARGET,
      hash.getSelectorFromName("transfer"),
      "0x2",
      "0x5",
      "0x0",
      "0x0",
    ]);
  });

  test("serializes duplicate proposal submissions across extension surfaces", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { handler, invokeCalls } = makeMultisigHarness({
      submitInvoke: async () => {
        await held;
        return { transactionHash: "0x7cd" };
      },
    });
    const watched = (await watch(handler)) as { multisig: { id: string } };

    const first = propose(handler, watched.multisig.id);
    for (let turn = 0; turn < 8 && invokeCalls.length === 0; turn += 1) {
      await Promise.resolve();
    }
    try {
      const second = await Promise.race([
        propose(handler, watched.multisig.id),
        Bun.sleep(100).then(() => ({ timeout: true })),
      ]);
      expect(second).toMatchObject({ error: expect.stringContaining("already been submitted") });
      expect(invokeCalls).toHaveLength(1);
    } finally {
      release();
    }
    await expect(first).resolves.toMatchObject({ ok: true });
  });

  test("returns a submitted proposal hash when activity storage fails", async () => {
    const base = memoryActivityLog();
    const activity: ActivityLog = {
      ...base,
      async record() {
        throw new Error("storage unavailable");
      },
    };
    const { handler } = makeMultisigHarness({ activity });
    const watched = (await watch(handler)) as { multisig: { id: string } };
    await expect(propose(handler, watched.multisig.id)).resolves.toMatchObject({
      ok: true,
      transactionHash: "0x7cd",
    });
  });
  test("confirms a pending proposal", async () => {
    const { handler, invokeCalls } = makeMultisigHarness({
      proposalStatus: staticStatus("pending"),
    });
    const watched = (await watch(handler)) as { multisig: { id: string } };
    const { proposal } = (await propose(handler, watched.multisig.id)) as {
      proposal: MultisigProposalRecord;
    };
    const confirm = await handler(
      {
        mode: "confirm-only",
        proposalId: proposal.id,
        type: "wallet.confirmMultisigProposal",
      },
      harnessExtensionSender,
    );
    expect(confirm).toEqual({ ok: true, transactionHash: "0x7cd" });
    const confirmed = invokeCalls.at(-1)?.[0] as { entrypoint: string };
    expect(confirmed.entrypoint).toBe("confirm_transaction");
  });
  test("partitions shared activity from both signer accounts", async () => {
    const { handler } = makeMultisigHarness();
    const watched = (await watch(handler)) as { multisig: { id: string } };
    await propose(handler, watched.multisig.id);
    const signerActivity = (await handler({ type: "wallet.activity" }, harnessExtensionSender)) as {
      activity: readonly { summary: string }[];
    };
    const sharedActivity = (await handler(
      { accountId: watched.multisig.id, type: "wallet.activity" },
      harnessExtensionSender,
    )) as { activity: readonly { summary: string }[] };
    expect(signerActivity.activity).toEqual([]);
    expect(sharedActivity.activity.map((entry) => entry.summary)).toEqual(["Propose: Pay vendor"]);
    await expect(
      handler({ accountId: "SN_MAIN:0x999", type: "wallet.activity" }, harnessExtensionSender),
    ).resolves.toEqual({ error: "activity scope unavailable" });
  });
  test("discovers every owned signer and confirms with the selected account", async () => {
    const { handler, multisigStore, submittedAccounts } = makeMultisigHarness({
      accounts: [harnessAccount, secondOwnedSigner],
      proposalStatus: (signer) => ({
        confirmations: 1,
        confirmedBySigner: signer === harnessAccount.address,
        state: "pending",
      }),
      signers: [harnessAccount.address, secondOwnedSigner.address],
    });
    const watched = (await watch(handler)) as { multisig: { id: string } };
    const proposed = (await propose(handler, watched.multisig.id)) as {
      proposal: MultisigProposalRecord;
    };
    await handler(
      { id: watched.multisig.id, type: "wallet.refreshMultisig" },
      harnessExtensionSender,
    );
    expect((await multisigStore.listProposals())[0]?.confirmedSignerAddresses).toEqual([
      harnessAccount.address,
    ]);
    await expect(
      handler(
        {
          proposalId: proposed.proposal.id,
          signerAccountId: secondOwnedSigner.id,
          mode: "confirm-only",
          type: "wallet.confirmMultisigProposal",
        },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ ok: true, transactionHash: "0x7cd" });
    expect(submittedAccounts.at(-1)).toBe(secondOwnedSigner.id);
    await expect(handler({ type: "wallet.status" }, harnessExtensionSender)).resolves.toMatchObject(
      {
        activeAccountId: harnessAccount.id,
      },
    );
  });
  test("executes a proposal with quorum", async () => {
    const { handler, invokeCalls } = makeMultisigHarness({
      proposalStatus: staticStatus("confirmed"),
    });
    const watched = (await watch(handler)) as { multisig: { id: string } };
    const { proposal } = (await propose(handler, watched.multisig.id)) as {
      proposal: MultisigProposalRecord;
    };
    const execute = await handler(
      { proposalId: proposal.id, type: "wallet.executeMultisigProposal" },
      harnessExtensionSender,
    );
    expect(execute).toEqual({ ok: true, transactionHash: "0x7cd" });
    const executed = invokeCalls.at(-1)?.[0] as { calldata: string[]; entrypoint: string };
    expect(executed.entrypoint).toBe("execute_transaction");
    expect(executed.calldata).toEqual([
      HARNESS_TARGET,
      hash.getSelectorFromName("transfer"),
      "0x2",
      "0x5",
      "0x0",
      "0x0",
    ]);
  });
  test("rejects tracking an id the contract does not know", async () => {
    const { handler } = makeMultisigHarness({ proposalStatus: staticStatus("not-found") });
    const watched = (await watch(handler)) as { multisig: { id: string } };
    await expect(
      handler(
        { multisigId: watched.multisig.id, txId: "0xdef", type: "wallet.trackMultisigProposal" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "no proposal with that id exists on this multisig" });
  });
  test("deploys through the UDC and immediately watches the predicted multisig", async () => {
    const { handler, invokeCalls } = makeMultisigHarness();
    const response = (await handler(
      {
        quorum: 2,
        signers: [harnessAccount.address, HARNESS_OTHER_SIGNER],
        type: "wallet.deployMultisig",
      },
      harnessExtensionSender,
    )) as { address: string; ok: true };
    expect(response.ok).toBe(true);
    expect(BigInt(response.address)).toBe(
      BigInt(
        predictMultisigAddress({
          quorum: 2,
          salt: "0x0",
          signers: [harnessAccount.address, HARNESS_OTHER_SIGNER],
        }),
      ),
    );
    const deployed = invokeCalls.at(-1)?.[0] as { entrypoint: string };
    expect(deployed.entrypoint).toBe("deploy_contract");
    const listed = (await handler({ type: "wallet.multisigs" }, harnessExtensionSender)) as {
      multisigs: readonly {
        address: string;
        id: string;
        networkId: string;
        quorum: number;
        signers: readonly string[];
      }[];
    };
    expect(listed.multisigs).toEqual([
      {
        address: response.address,
        id: `SN_MAIN:${response.address}`,
        networkId: "SN_MAIN",
        quorum: 2,
        signers: [harnessAccount.address, HARNESS_OTHER_SIGNER],
      },
    ]);
  });

  test("rejects a deploy request carrying an unknown name field", async () => {
    const { handler } = makeMultisigHarness();
    await expect(
      handler(
        {
          name: "New treasury",
          quorum: 1,
          signers: [harnessAccount.address],
          type: "wallet.deployMultisig",
        },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "invalid deploy multisig request" });
  });
  test("fails deploys closed when the class is not declared", async () => {
    const { handler } = makeMultisigHarness({ classDeclared: false });
    await expect(
      handler(
        { quorum: 1, signers: [harnessAccount.address], type: "wallet.deployMultisig" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({
      error: "multisig class not declared on this network — declare it first",
    });
  });

  test("serializes concurrent deploys before either can broadcast twice", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let submits = 0;
    const { handler } = makeMultisigHarness({
      async submitInvoke() {
        submits += 1;
        started.resolve();
        await release.promise;
        return { transactionHash: "0x7cd" };
      },
    });
    const request = {
      quorum: 1,
      signers: [harnessAccount.address],
      type: "wallet.deployMultisig",
    };
    const first = handler(request, harnessExtensionSender);
    await started.promise;
    await expect(handler(request, harnessExtensionSender)).resolves.toEqual({
      error:
        "a deploy transaction for this multisig configuration is already unresolved — wait for it to settle",
    });
    expect(submits).toBe(1);
    release.resolve();
    await expect(first).resolves.toMatchObject({ ok: true, transactionHash: "0x7cd" });
  });

  test("returns a submitted deploy hash when activity storage fails", async () => {
    const base = memoryActivityLog();
    const activity: ActivityLog = {
      ...base,
      async record() {
        throw new Error("storage unavailable");
      },
    };
    const { handler } = makeMultisigHarness({ activity });
    const result = await handler(
      { quorum: 1, signers: [harnessAccount.address], type: "wallet.deployMultisig" },
      harnessExtensionSender,
    );
    expect(result).toMatchObject({ ok: true, tracked: true, transactionHash: "0x7cd" });
    const listed = await handler({ type: "wallet.multisigs" }, harnessExtensionSender);
    expect(listed).toMatchObject({ multisigs: [{ signers: [harnessAccount.address] }] });
  });

  test("reports a submitted deployment when automatic tracking storage fails", async () => {
    const base = memoryMultisigStore();
    const { handler } = makeMultisigHarness({
      multisigStore: {
        ...base,
        async upsertMultisig() {
          throw new Error("storage unavailable");
        },
      },
    });
    await expect(
      handler(
        { quorum: 1, signers: [harnessAccount.address], type: "wallet.deployMultisig" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true, tracked: false, transactionHash: "0x7cd" });
  });
  test("refuses to deploy over an existing contract", async () => {
    const { handler } = makeMultisigHarness({ contractAt: true });
    await expect(
      handler(
        { quorum: 1, signers: [harnessAccount.address], type: "wallet.deployMultisig" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({
      error: "a multisig with these signers and salt already exists — watch it instead",
    });
  });

  test("fails deploy closed when occupancy cannot be checked", async () => {
    const { handler } = makeMultisigHarness({
      deploymentStatus: () => {
        throw new Error("rpc down");
      },
    });
    await expect(
      handler(
        { quorum: 1, signers: [harnessAccount.address], type: "wallet.deployMultisig" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({
      error: "could not verify whether this multisig address is free — try again",
    });
  });

  test("declares only an artifact matching the pinned class hash", async () => {
    const bad = makeMultisigHarness({ classDeclared: false, loadClass: async () => null });
    await expect(
      bad.handler({ type: "wallet.declareMultisigClass" }, harnessExtensionSender),
    ).resolves.toEqual({ error: "Bundled multisig class is malformed" });
    expect(bad.declared).toHaveLength(0);
  });

  test("refuses to declare when the class is already on-chain", async () => {
    const { handler, declared } = makeMultisigHarness({
      classDeclared: true,
      loadClass: async () => ({ sierra_program: [] }),
    });
    await expect(
      handler({ type: "wallet.declareMultisigClass" }, harnessExtensionSender),
    ).resolves.toEqual({
      error: "multisig class is already declared on this network",
    });
    expect(declared).toHaveLength(0);
  });

  test("refuses propose when the selected account was removed as a signer", async () => {
    const signers = [harnessAccount.address, HARNESS_OTHER_SIGNER];
    const { handler } = makeMultisigHarness({ signers });
    const watched = (await watch(handler)) as { multisig: { id: string } };
    signers.splice(0, signers.length, HARNESS_OTHER_SIGNER);
    await expect(propose(handler, watched.multisig.id)).resolves.toEqual({
      error: "the selected account is not a signer of this multisig",
    });
  });
});
