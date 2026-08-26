/** Nostr handoffs bind the authenticated sender to a saved Starknet signer. */
import { describe, expect, test } from "bun:test";
import {
  sharedIntentHasUpdate,
  trustedSharedIntent,
} from "../../../apps/extension/src/background/multisig/multisig-coordination-ops";
import { argentMultisigIntentPackage } from "../../../apps/extension/src/background/multisig/multisig-inputs";
import {
  HARNESS_KEYS,
  HARNESS_MULTISIG_ID,
  HARNESS_TARGET,
  harnessExtensionSender,
  makeMultisigHarness,
} from "../../support/multisig-harness";

describe("Argent multisig Nostr coordination", () => {
  test("trusts only a saved Nostr identity bound to a frozen signer", async () => {
    const harness = await makeMultisigHarness();
    const prepared = (await harness.handler(
      {
        calls: [{ calldata: [], contractAddress: HARNESS_TARGET, entrypoint: "transfer" }],
        multisigId: HARNESS_MULTISIG_ID,
        type: "wallet.prepareArgentMultisigIntent",
      },
      harnessExtensionSender,
    )) as { readonly intent: Parameters<typeof argentMultisigIntentPackage>[0] };
    const content = JSON.stringify(argentMultisigIntentPackage(prepared.intent));
    const senderPublicKey = "11".repeat(32);
    const records = await harness.multisigStore.listMultisigs();
    const signerPublicKey = HARNESS_KEYS[1];
    if (!signerPublicKey) throw new Error("Missing harness co-signer");
    const contact = {
      address: "0x123",
      id: "SN_MAIN:0x123",
      label: "Co-signer",
      networkId: "SN_MAIN" as const,
      nostrPublicKey: senderPublicKey,
      publicKeyX: signerPublicKey,
    };

    expect(
      trustedSharedIntent(
        { content, identifier: "mc-wallet.multisig", senderPublicKey },
        [contact],
        records,
      ),
    ).not.toBeNull();
    expect(
      trustedSharedIntent(
        { content, identifier: "mc-wallet.multisig", senderPublicKey: "22".repeat(32) },
        [contact],
        records,
      ),
    ).toBeNull();
    expect(
      trustedSharedIntent(
        { content, identifier: "mc-wallet.multisig", senderPublicKey },
        [{ ...contact, publicKeyX: "0x123" }],
        records,
      ),
    ).toBeNull();

    expect(sharedIntentHasUpdate(null, prepared.intent)).toBe(true);
    expect(sharedIntentHasUpdate(prepared.intent, prepared.intent)).toBe(false);
    expect(
      sharedIntentHasUpdate(
        { ...prepared.intent, state: "submitted" },
        { ...prepared.intent, signatures: [{ publicKey: signerPublicKey, r: "0x1", s: "0x2" }] },
      ),
    ).toBe(false);
  });
});
