/**
 * Multisig lifecycle regressions: the pending-deploy dedup guard actually
 * fires (it once matched an address suffix the recorded summary never
 * contained), and chain reads that cannot yet see a just-broadcast proposal
 * never downgrade the stored record into a dead-end not-found state.
 */
import { describe, expect, test } from "bun:test";
import type { MultisigProposalStatus } from "../src/starknet/multisig";
import { predictMultisigAddress } from "../src/starknet/multisig-deploy";
import type { MultisigProposalRecord } from "../src/storage/multisig-store";
import {
  HARNESS_MULTISIG,
  HARNESS_OTHER_SIGNER,
  HARNESS_TARGET,
  harnessAccount,
  harnessExtensionSender,
  makeMultisigHarness,
} from "./support/multisig-harness";

const deployRequest = {
  quorum: 2,
  signers: [harnessAccount.address, HARNESS_OTHER_SIGNER],
  type: "wallet.deployMultisig",
};

const watch = (handler: ReturnType<typeof makeMultisigHarness>["handler"]) =>
  handler({ address: HARNESS_MULTISIG, type: "wallet.addMultisig" }, harnessExtensionSender);

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

const listedProposals = async (
  handler: ReturnType<typeof makeMultisigHarness>["handler"],
): Promise<readonly MultisigProposalRecord[]> => {
  const listed = (await handler({ type: "wallet.multisigs" }, harnessExtensionSender)) as {
    proposals: readonly MultisigProposalRecord[];
  };
  return listed.proposals;
};

describe("multisig deploy dedup", () => {
  test("rejects a duplicate deploy while the first is still pending", async () => {
    const { handler, invokeCalls } = makeMultisigHarness();
    const first = (await handler(deployRequest, harnessExtensionSender)) as {
      address: string;
      ok: true;
    };
    expect(first.ok).toBe(true);
    expect(invokeCalls).toHaveLength(1);

    const second = await handler(deployRequest, harnessExtensionSender);
    expect(second).toEqual({
      error:
        "a deploy transaction for this multisig configuration is already pending — wait for it to complete",
    });
    expect(invokeCalls).toHaveLength(1);
  });

  test("records the full predicted address so the dedup guard can match it", async () => {
    const { handler } = makeMultisigHarness();
    await handler(deployRequest, harnessExtensionSender);
    const activity = (await handler({ type: "wallet.activity" }, harnessExtensionSender)) as {
      activity: readonly { summary: string }[];
    };
    const address = predictMultisigAddress({
      quorum: 2,
      salt: "0x0",
      signers: [harnessAccount.address, HARNESS_OTHER_SIGNER],
    });
    expect(activity.activity[0]?.summary).toContain(` at ${address}`);
  });

  test("a different configuration is not blocked by an unrelated pending deploy", async () => {
    const { handler, invokeCalls } = makeMultisigHarness();
    await handler(deployRequest, harnessExtensionSender);
    const other = await handler(
      { quorum: 1, signers: [harnessAccount.address], type: "wallet.deployMultisig" },
      harnessExtensionSender,
    );
    expect(other).toMatchObject({ ok: true });
    expect(invokeCalls).toHaveLength(2);
  });
});

describe("unmined proposal protection", () => {
  const notFound: MultisigProposalStatus = {
    confirmations: 0,
    confirmedBySigner: false,
    state: "not-found",
  };

  test("a just-proposed transaction stays pending while the chain cannot see it", async () => {
    // The chain answers not-found for everything: the submit is unmined.
    const { handler } = makeMultisigHarness({ proposalStatus: () => notFound });
    const watched = (await watch(handler)) as { multisig: { id: string } };
    const proposed = (await propose(handler, watched.multisig.id)) as {
      proposal: MultisigProposalRecord;
    };
    expect(proposed.proposal.state).toBe("pending");

    const stored = await listedProposals(handler);
    expect(stored[0]?.state).toBe("pending");
  });

  test("confirming an unmined proposal fails closed without clobbering it", async () => {
    const { handler } = makeMultisigHarness({ proposalStatus: () => notFound });
    const watched = (await watch(handler)) as { multisig: { id: string } };
    const proposed = (await propose(handler, watched.multisig.id)) as {
      proposal: MultisigProposalRecord;
    };

    await expect(
      handler(
        { proposalId: proposed.proposal.id, type: "wallet.confirmMultisigProposal" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "cannot confirm a proposal that is not-found" });

    // The stored record keeps its actionable pending snapshot instead of
    // being downgraded into a dead-end not-found state.
    const stored = await listedProposals(handler);
    expect(stored[0]?.state).toBe("pending");
  });

  test("a manual refresh keeps unmined proposals instead of marking them not-found", async () => {
    let state: MultisigProposalStatus = notFound;
    const { handler } = makeMultisigHarness({ proposalStatus: () => state });
    const watched = (await watch(handler)) as { multisig: { id: string } };
    await propose(handler, watched.multisig.id);

    await handler(
      { id: watched.multisig.id, type: "wallet.refreshMultisig" },
      harnessExtensionSender,
    );
    expect((await listedProposals(handler))[0]?.state).toBe("pending");

    // Once mined, the same refresh path picks up the real chain state.
    state = { confirmations: 2, confirmedBySigner: true, state: "confirmed" };
    await handler(
      { id: watched.multisig.id, type: "wallet.refreshMultisig" },
      harnessExtensionSender,
    );
    expect((await listedProposals(handler))[0]?.state).toBe("confirmed");
  });
});
