/**
 * A stale Argent multisig intent records why it went stale (mc-wallet 673), so
 * the card can tell "the node refused this version's fee" from "the nonce
 * moved, a co-signer may have sent it". Only an unmoved nonce, read again
 * after the refusal, records `fee`; the reason never leaves this wallet.
 */

import { describe, expect, test } from "bun:test";
import {
  type ArgentMultisigSigningIntent,
  isArgentMultisigSigningIntent,
} from "@bramble/multisig/repository";
import { ArgentMultisigFeeExpiredError } from "@bramble/starknet/multisig-invoke";
import {
  argentMultisigIntentPackage,
  locallyDerivedImportedIntent,
} from "../../../apps/extension/src/background/multisig/multisig-inputs";
import {
  HARNESS_MULTISIG_ID,
  HARNESS_TARGET,
  harnessAccountA,
  harnessAccountB,
  harnessExtensionSender,
  type MultisigHarnessOptions,
  makeMultisigHarness,
} from "../../support/multisig-harness";

const RAW_RPC_ERROR =
  "RPC: starknet_addInvokeTransaction with params {...} 55: Account validation failed: Resource bounds were not satisfied: Max L1DataGas price (235129044270) is lower than the actual gas price: 863576035385.";

const intentFrom = (response: unknown): ArgentMultisigSigningIntent =>
  (response as { readonly intent: ArgentMultisigSigningIntent }).intent;

// Prepares and fully signs one intent, then submits it once; `afterRefusal`
// decides what the nonce reads once the node has refused the fee.
const refusedOnce = async (afterRefusal: () => string) => {
  let refused = false;
  const options: MultisigHarnessOptions = {
    getNonce: () => (refused ? afterRefusal() : "0x7"),
    async submitPrepared() {
      refused = true;
      throw new ArgentMultisigFeeExpiredError(RAW_RPC_ERROR);
    },
  };
  const harness = await makeMultisigHarness(options);
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
  return { harness, intentId: intent.id };
};

describe("stale reason after a fee refusal", () => {
  test("records fee when the nonce is still the one the intent was signed for", async () => {
    const { harness, intentId } = await refusedOnce(() => "0x7");
    expect(await harness.multisigStore.getIntent(intentId)).toMatchObject({
      staleReason: "fee",
      state: "stale",
    });
  });

  test("records nonce when the nonce moved meanwhile, since a co-signer may have sent it", async () => {
    const { harness, intentId } = await refusedOnce(() => "0x8");
    expect(await harness.multisigStore.getIntent(intentId)).toMatchObject({
      staleReason: "nonce",
      state: "stale",
    });
  });

  test("records nonce when the nonce cannot be read again", async () => {
    const { harness, intentId } = await refusedOnce(() => {
      throw new Error("node down");
    });
    expect(await harness.multisigStore.getIntent(intentId)).toMatchObject({
      staleReason: "nonce",
      state: "stale",
    });
  });
});

describe("the stale reason stays local", () => {
  test("is left out of the package shared with co-signers and of an imported intent", async () => {
    const { harness, intentId } = await refusedOnce(() => "0x7");
    const stored = await harness.multisigStore.getIntent(intentId);
    if (!stored) throw new Error("intent missing");
    expect(stored.staleReason).toBe("fee");
    expect(argentMultisigIntentPackage(stored).intent).not.toHaveProperty("staleReason");
    expect(locallyDerivedImportedIntent(stored)).not.toHaveProperty("staleReason");
  });
});

describe("stored stale reasons", () => {
  test("accept only a known reason", async () => {
    const { harness, intentId } = await refusedOnce(() => "0x7");
    const stored = await harness.multisigStore.getIntent(intentId);
    expect(isArgentMultisigSigningIntent(stored)).toBe(true);
    expect(isArgentMultisigSigningIntent({ ...stored, staleReason: "maybe" })).toBe(false);
    expect(isArgentMultisigSigningIntent({ ...stored, staleReason: 1 })).toBe(false);
  });
});
