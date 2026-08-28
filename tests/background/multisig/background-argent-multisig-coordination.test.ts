/** Nostr handoffs bind the authenticated sender to a saved Starknet signer. */
import { describe, expect, test } from "bun:test";
import type { ArgentMultisigSigningIntent } from "@mc-wallet/multisig/repository";
import { defaultWalletPreferences } from "@mc-wallet/settings/preferences";
import type { NostrApplicationData } from "@mc-wallet/vault/kms-port";
import type { NostrEvent } from "@mc-wallet/wallet-model/nostr";
import {
  coordinationRelayUrls,
  sharedIntentHasUpdate,
  trustedSharedIntent,
} from "../../../apps/extension/src/background/multisig/multisig-coordination-ops";
import { argentMultisigIntentPackage } from "../../../apps/extension/src/background/multisig/multisig-inputs";
import type { NostrRelayTransport } from "../../../apps/extension/src/background/multisig/nostr-relay";
import {
  HARNESS_KEYS,
  HARNESS_MULTISIG_ID,
  HARNESS_TARGET,
  harnessAccountA,
  harnessAccountB,
  harnessExtensionSender,
  makeMultisigHarness,
} from "../../support/multisig-harness";

const coordinationNetwork = () => {
  const events: NostrEvent[] = [];
  const relaySelections: string[][] = [];
  const transport: NostrRelayTransport = {
    async publish(eventJson, recipientPublicKey, relayUrls) {
      const event = JSON.parse(eventJson) as NostrEvent;
      if (!event.tags.some((tag) => tag[0] === "p" && tag[1] === recipientPublicKey)) {
        throw new Error("recipient mismatch");
      }
      events.push(event);
      relaySelections.push([...relayUrls]);
      return 1;
    },
    async sync(recipientPublicKey, _since, relayUrls) {
      relaySelections.push([...relayUrls]);
      return events.filter((event) =>
        event.tags.some((tag) => tag[0] === "p" && tag[1] === recipientPublicKey),
      );
    },
  };
  let sequence = 0;
  const identity = (publicKey: string) => ({
    async open(eventJson: string): Promise<NostrApplicationData> {
      const event = JSON.parse(eventJson) as NostrEvent;
      if (!event.tags.some((tag) => tag[0] === "p" && tag[1] === publicKey)) {
        throw new Error("recipient mismatch");
      }
      return JSON.parse(event.content) as NostrApplicationData;
    },
    publicKey,
    transport,
    async wrap(input: {
      readonly content: string;
      readonly identifier: string;
      readonly recipientPublicKey: string;
    }): Promise<string> {
      sequence += 1;
      return JSON.stringify({
        content: JSON.stringify({
          content: input.content,
          identifier: input.identifier,
          senderPublicKey: publicKey,
        }),
        created_at: sequence,
        id: sequence.toString(16).padStart(64, "0"),
        kind: 1_059,
        pubkey: "33".repeat(32),
        sig: "44".repeat(64),
        tags: [["p", input.recipientPublicKey]],
      });
    },
  });
  return { identity, relaySelections };
};

describe("Argent multisig Nostr coordination", () => {
  test("coordinates a 2-of-2 intent across separate wallet stores", async () => {
    const relayUrl = "wss://relay.team.example";
    const nostrA = "11".repeat(32);
    const nostrB = "22".repeat(32);
    const network = coordinationNetwork();
    const source = await makeMultisigHarness({ coordination: network.identity(nostrA) });
    const target = await makeMultisigHarness({ coordination: network.identity(nostrB) });
    for (const harness of [source, target]) {
      await harness.preferencesStore.setNostrRelayUrl({ relayUrl });
    }
    await source.preferencesStore.saveAddress({
      address: harnessAccountB.address,
      label: "Co-signer B",
      networkId: "SN_MAIN",
      nostrPublicKey: nostrB,
      publicKeyX: harnessAccountB.publicKeyX,
    });
    await target.preferencesStore.saveAddress({
      address: harnessAccountA.address,
      label: "Co-signer A",
      networkId: "SN_MAIN",
      nostrPublicKey: nostrA,
      publicKeyX: harnessAccountA.publicKeyX,
    });

    const prepared = (await source.handler(
      {
        calls: [{ calldata: [], contractAddress: HARNESS_TARGET, entrypoint: "transfer" }],
        multisigId: HARNESS_MULTISIG_ID,
        type: "wallet.prepareArgentMultisigIntent",
      },
      harnessExtensionSender,
    )) as { readonly intent: ArgentMultisigSigningIntent };
    const signedByA = (await source.handler(
      {
        intentId: prepared.intent.id,
        signerAccountId: harnessAccountA.id,
        type: "wallet.signArgentMultisigIntent",
      },
      harnessExtensionSender,
    )) as { readonly intent: ArgentMultisigSigningIntent };
    await expect(
      source.handler(
        { intentId: signedByA.intent.id, type: "wallet.shareArgentMultisigIntent" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true, recipients: 1, relays: 1 });
    await expect(
      target.handler(
        { multisigId: HARNESS_MULTISIG_ID, type: "wallet.syncArgentMultisigIntents" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ imported: 1, ok: true });

    const signedByB = (await target.handler(
      {
        intentId: signedByA.intent.id,
        signerAccountId: harnessAccountB.id,
        type: "wallet.signArgentMultisigIntent",
      },
      harnessExtensionSender,
    )) as { readonly intent: ArgentMultisigSigningIntent };
    expect(signedByB.intent).toMatchObject({ signatures: [{}, {}], state: "ready" });
    await target.handler(
      { intentId: signedByB.intent.id, type: "wallet.shareArgentMultisigIntent" },
      harnessExtensionSender,
    );
    await source.handler(
      { multisigId: HARNESS_MULTISIG_ID, type: "wallet.syncArgentMultisigIntents" },
      harnessExtensionSender,
    );

    await expect(source.multisigStore.getIntent(signedByB.intent.id)).resolves.toMatchObject({
      signatures: [{}, {}],
      state: "ready",
    });
    expect(network.relaySelections.every((selection) => selection[0] === relayUrl)).toBe(true);
  });

  test("uses one custom relay as a replacement for the reviewed defaults", () => {
    const relayUrl = "wss://relay.team.example";
    expect(
      coordinationRelayUrls({ ...defaultWalletPreferences(), nostrRelayUrl: relayUrl }),
    ).toEqual([relayUrl]);
    expect(coordinationRelayUrls(defaultWalletPreferences())).toHaveLength(2);
  });

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
