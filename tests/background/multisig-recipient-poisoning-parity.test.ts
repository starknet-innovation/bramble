/**
 * MCW-V09-109, multisig line. Sibling of ./send-recipient-poisoning-parity.test.ts;
 * split only to keep both files under the size limit.
 *
 * The multisig proposal composer is a recipient-first send screen that builds
 * its ERC20 transfer with the SAME `buildErc20TransferCall` the public send
 * uses, yet the background applied no recipient policy to it at all: the only
 * evaluation lived in src/sidepanel/multisig-model.ts, which renders the
 * verifier's flags as advisory strings. One route refused a poisoned recipient
 * and the other broadcast it — the exact per-product-line divergence this
 * finding is about, on the highest-value account type the wallet supports.
 *
 * These drive the real `createMessageHandler` over a real preferences store, so
 * every assertion is about what the shipped background does with an untrusted
 * message, not about what a panel chose to render. Each refusal has a
 * clean-recipient counterpart: a gate that refused everything would break every
 * treasury payment and still pass a "does it refuse" test.
 */
import { describe, expect, test } from "bun:test";
import type { MultisigProposalStatus } from "../../src/starknet/multisig";
import { createMemoryStore } from "../../src/storage/kv";
import { memoryMultisigStore, multisigProposalId } from "../../src/storage/multisig-store";
import { createPreferencesStore } from "../../src/storage/preferences-store";
import {
  HARNESS_MULTISIG,
  harnessExtensionSender,
  harnessTxId,
  makeMultisigHarness,
} from "../support/multisig-harness";
import {
  CLEAN_RECIPIENT,
  POISONED_RECIPIENT,
  POISONING_CONTACT,
} from "../support/poisoned-recipients";

const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

const transferCalldata = (recipient: string): readonly string[] => [recipient, "0x3e8", "0x0"];

const proposalCall = (recipient: string) => ({
  calldata: transferCalldata(recipient),
  contractAddress: ETH,
  entrypoint: "transfer",
  salt: "0x0",
});

// Chain states each action's own guards accept, so a refusal in these tests can
// only come from the recipient policy and never from proposal state.
const CONFIRMED: MultisigProposalStatus = {
  confirmations: 2,
  confirmedBySigner: true,
  state: "confirmed",
};
const AWAITING_THIS_SIGNER: MultisigProposalStatus = {
  confirmations: 1,
  confirmedBySigner: false,
  state: "pending",
};
const CONFIRMED_BY_THIS_SIGNER: MultisigProposalStatus = {
  confirmations: 1,
  confirmedBySigner: true,
  state: "pending",
};

// One watched multisig on the active network, a saved contact the poisoned
// address mimics, and a chain reporting the given proposal state.
const setup = async (status: MultisigProposalStatus = CONFIRMED) => {
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  await preferencesStore.saveAddress({
    address: POISONING_CONTACT,
    label: "Friend",
    networkId: "SN_MAIN",
  });
  const multisigStore = memoryMultisigStore();
  const harness = makeMultisigHarness({
    multisigStore,
    preferencesStore,
    proposalStatus: () => status,
  });
  const added = (await harness.handler(
    { address: HARNESS_MULTISIG, name: "Treasury", type: "wallet.addMultisig" },
    harnessExtensionSender,
  )) as { readonly multisig: { readonly id: string } };
  return { ...harness, multisigId: added.multisig.id };
};

// A proposal another signer put on chain before this wallet saved the contact:
// the case the propose-time gate cannot cover, and the reason confirm and
// execute re-decide for themselves.
const seedProposal = async (
  context: Awaited<ReturnType<typeof setup>>,
  recipient: string,
): Promise<string> => {
  const call = proposalCall(recipient);
  const txId = harnessTxId(call);
  const id = multisigProposalId(context.multisigId, txId);
  if (!id) {
    throw new Error("proposal id fixture is not composable");
  }
  await context.multisigStore.upsertProposal({
    call,
    confirmations: 2,
    id,
    multisigId: context.multisigId,
    state: "confirmed",
    summary: "Pay Friend",
    txId,
  });
  return id;
};

describe("multisig propose", () => {
  test("refuses a poisoned recipient before submit_transaction is broadcast", async () => {
    const context = await setup();

    await expect(
      context.handler(
        {
          calldata: transferCalldata(POISONED_RECIPIENT),
          entrypoint: "transfer",
          multisigId: context.multisigId,
          salt: "0x0",
          summary: "Pay Friend",
          to: ETH,
          type: "wallet.proposeMultisigTx",
        },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: expect.stringContaining("closely mimics") });
    // Nothing broadcast, and nothing stored for other signers to co-sign.
    expect(context.invokeCalls).toEqual([]);
    expect(await context.multisigStore.listProposals()).toEqual([]);
  });

  test("still proposes to a recipient that resembles nothing the wallet trusts", async () => {
    const context = await setup();

    await expect(
      context.handler(
        {
          calldata: transferCalldata(CLEAN_RECIPIENT),
          entrypoint: "transfer",
          multisigId: context.multisigId,
          salt: "0x0",
          summary: "Pay Friend",
          to: ETH,
          type: "wallet.proposeMultisigTx",
        },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(context.invokeCalls).toHaveLength(1);
  });

  // The multisig's own address is public on chain, which makes it exactly the
  // kind of address a duster mimics — and the treasury is the account whose
  // payments a signer is least likely to re-read character by character.
  test("refuses a recipient that mimics the watched multisig's own address", async () => {
    const context = await setup();
    // Shares HARNESS_MULTISIG's first eight and last four canonical characters
    // and is a different account in between.
    const lookalike = `0x111111${"7".repeat(53)}1111`;

    await expect(
      context.handler(
        {
          calldata: transferCalldata(lookalike),
          entrypoint: "transfer",
          multisigId: context.multisigId,
          salt: "0x0",
          to: ETH,
          type: "wallet.proposeMultisigTx",
        },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: expect.stringContaining("closely mimics") });
    expect(context.invokeCalls).toEqual([]);
  });
});

describe("multisig execute", () => {
  test("refuses to run a stored proposal that pays a poisoned recipient", async () => {
    const context = await setup();
    const proposalId = await seedProposal(context, POISONED_RECIPIENT);

    await expect(
      context.handler(
        { proposalId, type: "wallet.executeMultisigProposal" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: expect.stringContaining("closely mimics") });
    expect(context.invokeCalls).toEqual([]);
  });

  test("executes a stored proposal whose recipient is clear", async () => {
    const context = await setup();
    const proposalId = await seedProposal(context, CLEAN_RECIPIENT);

    await expect(
      context.handler(
        { proposalId, type: "wallet.executeMultisigProposal" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(context.invokeCalls).toHaveLength(1);
  });
});

describe("multisig confirm", () => {
  test("refuses to co-sign a poisoned proposal, and shows no fee review for one", async () => {
    const context = await setup();
    const proposalId = await seedProposal(context, POISONED_RECIPIENT);

    await expect(
      context.handler(
        { mode: "confirm-only", proposalId, type: "wallet.prepareMultisigConfirmation" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: expect.stringContaining("closely mimics") });
    await expect(
      context.handler(
        { mode: "confirm-only", proposalId, type: "wallet.confirmMultisigProposal" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: expect.stringContaining("closely mimics") });
    expect(context.estimatedCalls).toEqual([]);
    expect(context.invokeCalls).toEqual([]);
  });

  test("still co-signs a proposal whose recipient is clear", async () => {
    const context = await setup(AWAITING_THIS_SIGNER);
    const proposalId = await seedProposal(context, CLEAN_RECIPIENT);

    await expect(
      context.handler(
        { mode: "confirm-only", proposalId, type: "wallet.confirmMultisigProposal" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(context.invokeCalls).toHaveLength(1);
  });

  // Revoking is the way OUT of a poisoned proposal, so it is the one action the
  // recipient policy must never block.
  test("revoking a confirmation on a poisoned proposal stays possible", async () => {
    const context = await setup(CONFIRMED_BY_THIS_SIGNER);
    const proposalId = await seedProposal(context, POISONED_RECIPIENT);

    await expect(
      context.handler(
        { proposalId, type: "wallet.revokeMultisigConfirmation" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(context.invokeCalls).toHaveLength(1);
  });
});
