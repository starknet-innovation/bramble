/**
 * The id-only proposal lifecycle: a proposal pasted as a bare transaction id
 * carries no call, so the wallet cannot describe it. Confirming and revoking it
 * are gated on an explicit out-of-band acknowledgment, and executing it is
 * refused outright because the execute calldata IS the original call.
 *
 * Lives beside the other multisig lifecycle suites rather than in
 * background-multisig-messages.test.ts, which is at the file-length limit.
 */
import { describe, expect, test } from "bun:test";
import type { MultisigProposalRecord } from "@mc-wallet/multisig/repository";
import { memoryActivityLog } from "@mc-wallet/transactions/activity";
import {
  HARNESS_MULTISIG,
  harnessExtensionSender,
  makeMultisigHarness,
} from "../support/multisig-harness";

const watch = async (handler: ReturnType<typeof makeMultisigHarness>["handler"]) =>
  handler(
    { address: HARNESS_MULTISIG, name: "Treasury", type: "wallet.addMultisig" },
    harnessExtensionSender,
  );

describe("id-only multisig proposals", () => {
  test("tracks a pasted proposal id but refuses to execute it", async () => {
    // Proposal actions are serialized across kinds now, so the revoke below has
    // to wait for the confirm to settle rather than racing it (EXT-L06).
    const activity = memoryActivityLog(() => 1);
    const { handler } = makeMultisigHarness({ activity });
    const watched = (await watch(handler)) as { multisig: { id: string } };
    const tracked = (await handler(
      { multisigId: watched.multisig.id, txId: "0xdef", type: "wallet.trackMultisigProposal" },
      harnessExtensionSender,
    )) as { proposal: MultisigProposalRecord };
    expect(tracked.proposal).toMatchObject({ call: null, state: "pending", txId: "0xdef" });
    await expect(
      handler(
        {
          mode: "confirm-only",
          proposalId: tracked.proposal.id,
          type: "wallet.confirmMultisigProposal",
        },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({
      error: expect.stringContaining("verify this proposal"),
    });
    const confirm = await handler(
      {
        mode: "confirm-only",
        proposalId: tracked.proposal.id,
        type: "wallet.confirmMultisigProposal",
        untrackedVerified: true,
      },
      harnessExtensionSender,
    );
    expect(confirm).toEqual({ ok: true, transactionHash: "0x7cd" });
    await expect(
      handler(
        {
          proposalId: tracked.proposal.id,
          type: "wallet.revokeMultisigConfirmation",
          untrackedVerified: true,
        },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({
      error: expect.stringContaining("already has a proposal action in progress"),
    });
    await activity.updateStatuses(
      { "0x7cd": { status: "accepted" } },
      { accountId: watched.multisig.id, networkId: "SN_MAIN" },
    );
    await expect(
      handler(
        { proposalId: tracked.proposal.id, type: "wallet.revokeMultisigConfirmation" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({
      error: expect.stringContaining("verify this proposal"),
    });
    const revoke = await handler(
      {
        proposalId: tracked.proposal.id,
        type: "wallet.revokeMultisigConfirmation",
        untrackedVerified: true,
      },
      harnessExtensionSender,
    );
    expect(revoke).toEqual({ ok: true, transactionHash: "0x7cd" });
    const execute = await handler(
      { proposalId: tracked.proposal.id, type: "wallet.executeMultisigProposal" },
      harnessExtensionSender,
    );
    expect(execute).toMatchObject({ error: expect.stringContaining("tracked by id only") });
  });
});
