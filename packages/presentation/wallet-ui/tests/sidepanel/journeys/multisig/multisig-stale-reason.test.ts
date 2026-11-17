/**
 * A stale multisig card names a fee refusal only when the intent recorded one
 * at an unmoved nonce (mc-wallet 673). Every other stale card, including an
 * older record with no reason, keeps "This may already have been sent by
 * another signer.", and none says nothing was sent.
 */
import { describe, expect, test } from "bun:test";
import { staleArgentMultisigIntent } from "@bramble/multisig/repository";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import {
  STALE_INTENT_FEE_REFUSED,
  STALE_INTENT_MAY_HAVE_BEEN_SENT,
} from "../../../../src/sidepanel/journeys/multisig/multisig-intent-actions";
import { multisigDetailFlow } from "../../../../src/sidepanel/journeys/multisig/multisig-views";
import { makeArgentMultisigFixture } from "../../../support/argent-multisig-fixtures";

const detailFor = async (staleReason?: "config" | "fee" | "nonce") => {
  const fixture = await makeArgentMultisigFixture();
  const stale =
    staleReason === undefined
      ? { ...fixture.readyIntent, state: "stale" as const }
      : staleArgentMultisigIntent(fixture.readyIntent, staleReason);
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

describe("stale multisig card copy", () => {
  test("a recorded fee refusal says the network refused this version", async () => {
    const detail = await detailFor("fee");
    expect(detail).toContain(STALE_INTENT_FEE_REFUSED);
    expect(detail).not.toContain(STALE_INTENT_MAY_HAVE_BEEN_SENT);
    expect(detail).not.toContain("Nothing was sent");
  });

  test("a moved nonce, a signer change, or no recorded reason may have been sent", async () => {
    for (const reason of ["nonce", "config", undefined] as const) {
      const detail = await detailFor(reason);
      expect(detail, String(reason)).toContain(STALE_INTENT_MAY_HAVE_BEEN_SENT);
      expect(detail, String(reason)).not.toContain(STALE_INTENT_FEE_REFUSED);
      expect(detail, String(reason)).not.toContain("Nothing was sent");
    }
  });
});

describe("staleArgentMultisigIntent", () => {
  test("a fee refusal never replaces a recorded nonce or signer change", async () => {
    const { readyIntent } = await makeArgentMultisigFixture();
    for (const earlier of ["nonce", "config"] as const) {
      const marked = staleArgentMultisigIntent(
        staleArgentMultisigIntent(readyIntent, earlier),
        "fee",
      );
      expect(marked.staleReason).toBe(earlier);
    }
    expect(
      staleArgentMultisigIntent(staleArgentMultisigIntent(readyIntent, "fee"), "nonce").staleReason,
    ).toBe("nonce");
    expect(staleArgentMultisigIntent(readyIntent, "fee")).toMatchObject({
      staleReason: "fee",
      state: "stale",
    });
  });
});
