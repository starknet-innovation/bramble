/**
 * A stale multisig card for a version whose own hash the chain answered for
 * (mc-wallet 673, part 2). A rejected version says it was not sent, and keeps
 * "Another signer may have sent a different version." unless the nonce showed
 * nothing else was sent. A reverted version says it failed on chain with its
 * fee paid. Neither offers to retry the signed version; both offer only
 * "Propose again", which collects fresh approvals.
 */
import { describe, expect, test } from "bun:test";
import type { ArgentMultisigStaleOutcome } from "@bramble/multisig/repository";
import { staleArgentMultisigIntent } from "@bramble/multisig/repository";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import {
  PROPOSE_AGAIN,
  STALE_INTENT_MAY_HAVE_BEEN_SENT,
  STALE_INTENT_NOT_SENT,
  STALE_INTENT_OTHER_VERSION,
  STALE_INTENT_REVERTED,
} from "../../../../src/sidepanel/journeys/multisig/multisig-intent-actions";
import { multisigDetailFlow } from "../../../../src/sidepanel/journeys/multisig/multisig-views";
import { makeArgentMultisigFixture } from "../../../support/argent-multisig-fixtures";

const detailFor = async (staleOutcome?: ArgentMultisigStaleOutcome) => {
  const fixture = await makeArgentMultisigFixture();
  const marked = staleArgentMultisigIntent(fixture.readyIntent, "fee");
  const stale = staleOutcome === undefined ? marked : { ...marked, staleOutcome };
  return multisigDetailFlow(
    fixture.status,
    fixture.status.accounts[0] ?? null,
    fixture.view,
    [stale],
    false,
    defaultWalletPreferences(),
    "multisig-detail",
    undefined,
    stale.id,
  );
};

describe("stale multisig card for an answered hash", () => {
  test("a rejected version at an unmoved nonce says only that it was not sent", async () => {
    const detail = await detailFor("rejected-nonce-unused");
    expect(detail).toContain(STALE_INTENT_NOT_SENT);
    expect(detail).not.toContain(STALE_INTENT_OTHER_VERSION);
    expect(detail).not.toContain(STALE_INTENT_MAY_HAVE_BEEN_SENT);
  });

  test("a rejected version at a moved nonce keeps that another version may have gone out", async () => {
    const detail = await detailFor("rejected");
    expect(detail).toContain(`${STALE_INTENT_NOT_SENT} ${STALE_INTENT_OTHER_VERSION}`);
  });

  test("a reverted version says it failed on chain with its fee paid", async () => {
    const detail = await detailFor("reverted");
    expect(detail).toContain(STALE_INTENT_REVERTED);
    expect(detail).not.toContain(STALE_INTENT_NOT_SENT);
  });

  test("offers only Propose again, never a retry of the signed version", async () => {
    for (const outcome of ["rejected", "rejected-nonce-unused", "reverted"] as const) {
      const detail = await detailFor(outcome);
      expect(detail, outcome).toContain(`>${PROPOSE_AGAIN}<`);
      expect(detail, outcome).toContain('data-ms-propose-again="true"');
      expect(detail, outcome).not.toContain("data-ms-submit");
      expect(detail, outcome).not.toContain("Try unchanged fee again");
    }
  });

  test("a version with no recorded outcome keeps today's card and its retry", async () => {
    const detail = await detailFor();
    expect(detail).not.toContain(STALE_INTENT_NOT_SENT);
    expect(detail).toContain("Try unchanged fee again");
  });
});
