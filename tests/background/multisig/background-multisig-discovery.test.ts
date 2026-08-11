/**
 * End-to-end background tests for proposal event discovery and secure review
 * package import across independent multisig signers.
 */
import { describe, expect, test } from "bun:test";
import {
  HARNESS_MULTISIG,
  HARNESS_SUBMIT_HASH,
  HARNESS_TARGET,
  HARNESS_TX_ID,
  harnessAccount,
  harnessExtensionSender,
  makeMultisigHarness,
} from "../../support/multisig-harness";

const watch = async (handler: ReturnType<typeof makeMultisigHarness>["handler"]) =>
  (await handler(
    { address: HARNESS_MULTISIG, name: "Treasury", type: "wallet.addMultisig" },
    harnessExtensionSender,
  )) as { multisig: { id: string } };

describe("multisig proposal discovery and communication", () => {
  test("discovers another signer's proposal as call-less and re-verifies its state", async () => {
    const discoveredId = "0x987";
    const { handler } = makeMultisigHarness({
      proposalDiscovery: () => ({ complete: true, ids: [discoveredId] }),
      proposalStatus: () => ({
        confirmations: 1,
        confirmedBySigner: false,
        state: "pending",
      }),
    });
    const watched = await watch(handler);

    await expect(
      handler({ id: watched.multisig.id, type: "wallet.refreshMultisig" }, harnessExtensionSender),
    ).resolves.toMatchObject({
      ok: true,
      proposals: [
        {
          call: null,
          confirmations: 1,
          confirmedBySigner: false,
          confirmedBySignerAddress: harnessAccount.address,
          summary: "Discovered on-chain proposal",
          txId: discoveredId,
        },
      ],
    });
  });

  test("keeps fresh config usable while reporting bounded recent proposal discovery", async () => {
    const { handler } = makeMultisigHarness({
      proposalDiscovery: () => ({ complete: false, ids: [] }),
    });
    const watched = await watch(handler);

    await expect(
      handler({ id: watched.multisig.id, type: "wallet.refreshMultisig" }, harnessExtensionSender),
    ).resolves.toMatchObject({
      ok: true,
      warnings: ["proposal-discovery-recent"],
    });
  });

  test("keeps fresh config usable when automatic proposal discovery is unavailable", async () => {
    const { handler } = makeMultisigHarness({
      proposalDiscovery() {
        throw new Error("provider event scan failed");
      },
    });
    const watched = await watch(handler);

    await expect(
      handler({ id: watched.multisig.id, type: "wallet.refreshMultisig" }, harnessExtensionSender),
    ).resolves.toMatchObject({
      ok: true,
      warnings: ["proposal-discovery-unavailable"],
    });
  });

  test("identifies a stale tracked proposal without invalidating fresh config", async () => {
    const discoveredId = "0x987";
    const { handler } = makeMultisigHarness({
      proposalDiscovery: () => ({ complete: true, ids: [discoveredId] }),
      proposalStatus() {
        throw new Error("proposal view failed");
      },
    });
    const watched = await watch(handler);

    await expect(
      handler({ id: watched.multisig.id, type: "wallet.refreshMultisig" }, harnessExtensionSender),
    ).resolves.toMatchObject({
      ok: true,
      warnings: ["proposal-refresh-incomplete"],
    });
  });

  test("re-hashes an imported review-package call before making it executable", async () => {
    const { handler } = makeMultisigHarness({
      proposalStatus: () => ({
        confirmations: 2,
        confirmedBySigner: true,
        state: "confirmed",
      }),
    });
    const watched = await watch(handler);
    const call = {
      calldata: ["0x5", "0x0"],
      contractAddress: HARNESS_TARGET,
      entrypoint: "transfer",
      salt: "0x0",
    };

    await expect(
      handler(
        {
          call,
          multisigId: watched.multisig.id,
          txId: HARNESS_TX_ID,
          type: "wallet.trackMultisigProposal",
        },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true, proposal: { call, txId: HARNESS_TX_ID } });
    await expect(
      handler(
        {
          proposalId: `${watched.multisig.id}:${HARNESS_TX_ID}`,
          type: "wallet.executeMultisigProposal",
        },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true, transactionHash: HARNESS_SUBMIT_HASH });
  });

  test("rejects imported call data whose contract-derived id differs", async () => {
    const { handler } = makeMultisigHarness();
    const watched = await watch(handler);

    await expect(
      handler(
        {
          call: {
            calldata: [],
            contractAddress: HARNESS_TARGET,
            entrypoint: "transfer",
            salt: "0x0",
          },
          multisigId: watched.multisig.id,
          txId: "0x999",
          type: "wallet.trackMultisigProposal",
        },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({
      error: "review package call does not match this on-chain proposal id",
    });
  });
});
