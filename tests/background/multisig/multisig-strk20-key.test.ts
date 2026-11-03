/**
 * A multisig viewing key is created in the vault and shared only inside a
 * Nostr gift wrap addressed to each co-owner. Responses never carry the key.
 */
import { describe, expect, test } from "bun:test";
import { STRK20_MAINNET_POOL } from "@bramble/privacy/config";
import { MULTISIG_STRK20_KEY_IDENTIFIER } from "@bramble/vault/multisig-strk20-key";
import { canonicalFelt, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import {
  HARNESS_MULTISIG_ID,
  harnessAccountA,
  harnessAccountB,
  harnessExtensionSender,
  makeMultisigHarness,
} from "../../support/multisig-harness";
import { coordinationNetwork } from "../../support/nostr-coordination-network";

const KEY = "0x654321";
const OTHER = "0x111";
const STRANGER = "0x222";
const pool = canonicalFelt(STRK20_MAINNET_POOL);
const chainId = STARKNET_NETWORKS.SN_MAIN.chainId;

const packageFor = (viewingKey: string): string =>
  JSON.stringify({
    chainId,
    multisigId: HARNESS_MULTISIG_ID,
    poolAddress: pool,
    version: 1,
    viewingKey,
  });

describe("Argent multisig STRK20 viewing key", () => {
  test("shares the key encrypted to a co-owner and refuses a different one", async () => {
    const relayUrl = "wss://relay.team.example";
    const nostrA = "11".repeat(32);
    const nostrB = "22".repeat(32);
    const nostrC = "33".repeat(32);
    const network = coordinationNetwork();
    const sourceIdentity = network.identity(nostrA);
    const source = await makeMultisigHarness({
      coordination: sourceIdentity,
      now: () => 2_000_000_000_000,
    });
    const target = await makeMultisigHarness({
      coordination: network.identity(nostrB),
      now: () => 2_000_000_000_000,
    });
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

    const created = await source.handler(
      { multisigId: HARNESS_MULTISIG_ID, type: "wallet.createArgentMultisigStrk20Key" },
      harnessExtensionSender,
    );
    expect(created).toEqual({ ok: true, state: "created" });
    expect(JSON.stringify(created)).not.toContain(KEY);

    const shared = await source.handler(
      { multisigId: HARNESS_MULTISIG_ID, type: "wallet.shareArgentMultisigStrk20Key" },
      harnessExtensionSender,
    );
    expect(shared).toMatchObject({ ok: true, recipients: 1, totalRecipients: 1 });
    expect(JSON.stringify(shared)).not.toContain(KEY);

    const synced = await target.handler(
      { multisigId: HARNESS_MULTISIG_ID, type: "wallet.syncArgentMultisigIntents" },
      harnessExtensionSender,
    );
    expect(synced).toMatchObject({ ok: true, strk20Key: "stored" });
    expect(JSON.stringify(synced)).not.toContain(KEY);
    await expect(
      target.handler(
        { multisigId: HARNESS_MULTISIG_ID, type: "wallet.argentMultisigStrk20KeyStatus" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ ok: true, state: "held" });

    const stranger = JSON.parse(
      await network.identity(nostrC).wrap({
        content: packageFor(STRANGER),
        identifier: MULTISIG_STRK20_KEY_IDENTIFIER,
        recipientPublicKey: nostrB,
      }),
    );
    network.pushEvent(stranger);
    const ignored = await target.handler(
      { multisigId: HARNESS_MULTISIG_ID, type: "wallet.syncArgentMultisigIntents" },
      harnessExtensionSender,
    );
    expect(ignored).toMatchObject({ ok: true, strk20Key: "none" });
    await expect(
      target.handler(
        { multisigId: HARNESS_MULTISIG_ID, type: "wallet.argentMultisigStrk20KeyStatus" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ ok: true, state: "held" });

    const conflict = JSON.parse(
      await sourceIdentity.wrap({
        content: packageFor(OTHER),
        identifier: MULTISIG_STRK20_KEY_IDENTIFIER,
        recipientPublicKey: nostrB,
      }),
    );
    network.pushEvent(conflict);
    const refused = await target.handler(
      { multisigId: HARNESS_MULTISIG_ID, type: "wallet.syncArgentMultisigIntents" },
      harnessExtensionSender,
    );
    expect(refused).toMatchObject({ ok: true, strk20Key: "conflict" });
    expect(JSON.stringify(refused)).not.toContain(OTHER);
    await expect(
      target.handler(
        { multisigId: HARNESS_MULTISIG_ID, type: "wallet.argentMultisigStrk20KeyStatus" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ ok: true, state: "conflict" });

    const multisigs = await target.multisigStore.listMultisigs();
    const preferences = await target.preferencesStore.read();
    expect(JSON.stringify({ multisigs, preferences })).not.toContain(KEY);
    expect(JSON.stringify({ multisigs, preferences })).not.toContain(OTHER);
  });
});
