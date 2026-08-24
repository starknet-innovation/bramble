/** Recovery when a collected Argent multisig intent outlives its fee prices. */

import { describe, expect, test } from "bun:test";
import type { ArgentMultisigSigningIntent } from "@mc-wallet/multisig/repository";
import { ArgentMultisigFeeExpiredError } from "@mc-wallet/starknet/multisig-invoke";
import {
  HARNESS_MULTISIG_ID,
  HARNESS_TARGET,
  harnessAccountA,
  harnessAccountB,
  harnessExtensionSender,
  makeMultisigHarness,
} from "../../support/multisig-harness";

const intentFrom = (response: unknown): ArgentMultisigSigningIntent =>
  (response as { readonly intent: ArgentMultisigSigningIntent }).intent;

const RAW_RPC_ERROR =
  "RPC: starknet_addInvokeTransaction with params {...} 55: Account validation failed: Resource bounds were not satisfied: Max L1DataGas price (235129044270) is lower than the actual gas price: 863576035385.";

describe("Argent multisig fee expiry", () => {
  test("keeps an underpriced signed intent retryable after releasing its submit claim", async () => {
    let attempts = 0;
    const harness = await makeMultisigHarness({
      async submitPrepared(hash) {
        attempts += 1;
        if (attempts === 1) throw new ArgentMultisigFeeExpiredError(RAW_RPC_ERROR);
        return hash;
      },
    });
    let intent = intentFrom(
      await harness.handler(
        {
          calls: [{ calldata: ["0x1"], contractAddress: HARNESS_TARGET, entrypoint: "transfer" }],
          multisigId: HARNESS_MULTISIG_ID,
          type: "wallet.prepareArgentMultisigIntent",
        },
        harnessExtensionSender,
      ),
    );
    for (const signerAccountId of [harnessAccountA.id, harnessAccountB.id]) {
      intent = intentFrom(
        await harness.handler(
          { intentId: intent.id, signerAccountId, type: "wallet.signArgentMultisigIntent" },
          harnessExtensionSender,
        ),
      );
    }

    await expect(
      harness.handler(
        { intentId: intent.id, type: "wallet.submitArgentMultisigIntent" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: RAW_RPC_ERROR });
    expect((await harness.multisigStore.getIntent(intent.id))?.state).toBe("stale");
    await expect(
      harness.handler(
        { intentId: intent.id, type: "wallet.submitArgentMultisigIntent" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ intent: { state: "submitted" }, ok: true });
    expect((await harness.multisigStore.getIntent(intent.id))?.state).toBe("submitted");
    expect(harness.submitCount()).toBe(2);
  });
});
