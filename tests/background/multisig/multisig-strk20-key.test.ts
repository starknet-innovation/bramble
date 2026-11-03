/**
 * A multisig viewing key is created in the vault and shared only inside a
 * Nostr gift wrap addressed to each co-owner. Responses never carry the key.
 */
import { describe, expect, test } from "bun:test";
import { createNostrCoordinationStore } from "@bramble/multisig/coordination";
import { STRK20_MAINNET_POOL } from "@bramble/privacy/config";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { ARGENT_MULTISIG_CONTRACT, argentSignerGuid } from "@bramble/starknet/account-contracts";
import { createMemoryStore } from "@bramble/store/kv";
import { MULTISIG_STRK20_KEY_IDENTIFIER } from "@bramble/vault/multisig-strk20-key";
import { canonicalFelt, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { NostrEvent } from "@bramble/wallet-model/nostr";
import { coordinationRelayUrls } from "../../../apps/extension/src/background/multisig/multisig-coordination-ops";
import {
  HARNESS_KEYS,
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

  test("drops the viewing key when the multisig is removed", async () => {
    const harness = await makeMultisigHarness();
    const [record] = await harness.multisigStore.listMultisigs();
    if (!record) throw new Error("missing harness multisig");
    await harness.handler(
      { multisigId: HARNESS_MULTISIG_ID, type: "wallet.createArgentMultisigStrk20Key" },
      harnessExtensionSender,
    );
    await expect(
      harness.handler(
        {
          confirmHistoryRemoval: true,
          multisigId: HARNESS_MULTISIG_ID,
          type: "wallet.removeMultisig",
        },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ ok: true });
    await harness.multisigStore.upsertMultisig(record);
    await expect(
      harness.handler(
        { multisigId: HARNESS_MULTISIG_ID, type: "wallet.argentMultisigStrk20KeyStatus" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ ok: true, state: "absent" });
  });

  test("trusts only the chain's current signers and retries when they cannot be read", async () => {
    const nostrA = "11".repeat(32);
    const nostrB = "22".repeat(32);
    const network = coordinationNetwork();
    let unavailable = false;
    let signerGuids = [argentSignerGuid(harnessAccountB.publicKeyX)];
    const target = await makeMultisigHarness({
      coordination: network.identity(nostrB),
      getConfig: () => {
        if (unavailable) throw new Error("config unavailable");
        return {
          classHash: ARGENT_MULTISIG_CONTRACT.classHash,
          signerGuids,
          threshold: 1,
        };
      },
      now: () => 2_000_000_000_000,
    });
    await target.preferencesStore.saveAddress({
      address: harnessAccountA.address,
      label: "Co-signer A",
      networkId: "SN_MAIN",
      nostrPublicKey: nostrA,
      publicKeyX: harnessAccountA.publicKeyX,
    });
    network.pushEvent(
      JSON.parse(
        await network.identity(nostrA).wrap({
          content: packageFor(KEY),
          identifier: MULTISIG_STRK20_KEY_IDENTIFIER,
          recipientPublicKey: nostrB,
        }),
      ),
    );
    const sync = {
      multisigId: HARNESS_MULTISIG_ID,
      type: "wallet.syncArgentMultisigIntents",
    };
    const status = {
      multisigId: HARNESS_MULTISIG_ID,
      type: "wallet.argentMultisigStrk20KeyStatus",
    };
    await expect(target.handler(sync, harnessExtensionSender)).resolves.toMatchObject({
      ok: true,
      strk20Key: "none",
    });
    await expect(target.handler(status, harnessExtensionSender)).resolves.toEqual({
      ok: true,
      state: "absent",
    });
    unavailable = true;
    await expect(target.handler(sync, harnessExtensionSender)).resolves.toMatchObject({
      ok: true,
      strk20Key: "none",
    });
    signerGuids = HARNESS_KEYS.map(argentSignerGuid);
    unavailable = false;
    await expect(target.handler(sync, harnessExtensionSender)).resolves.toMatchObject({
      ok: true,
      strk20Key: "stored",
    });
  });

  test("keeps an old conflict wrap inside the next sync window", async () => {
    const relayUrl = "wss://relay.team.example";
    const nostrA = "11".repeat(32);
    const nostrB = "22".repeat(32);
    const network = coordinationNetwork();
    const store = createNostrCoordinationStore({ store: createMemoryStore() });
    const now = 2_000_000_000_000;
    const source = await makeMultisigHarness({
      coordination: network.identity(nostrA),
      now: () => now,
    });
    const target = await makeMultisigHarness({
      coordination: network.identity(nostrB),
      nostrCoordinationStore: store,
      now: () => now,
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
    await source.handler(
      { multisigId: HARNESS_MULTISIG_ID, type: "wallet.createArgentMultisigStrk20Key" },
      harnessExtensionSender,
    );
    await source.handler(
      { multisigId: HARNESS_MULTISIG_ID, type: "wallet.shareArgentMultisigStrk20Key" },
      harnessExtensionSender,
    );
    const sync = {
      multisigId: HARNESS_MULTISIG_ID,
      type: "wallet.syncArgentMultisigIntents",
    };
    await target.handler(sync, harnessExtensionSender);
    const conflict = JSON.parse(
      await network.identity(nostrA).wrap({
        content: packageFor(OTHER),
        identifier: MULTISIG_STRK20_KEY_IDENTIFIER,
        recipientPublicKey: nostrB,
      }),
    ) as { readonly created_at: number; readonly id: string } & NostrEvent;
    network.pushEvent(conflict);
    await target.handler(sync, harnessExtensionSender);
    const checkpoint = await store.getCheckpoint(HARNESS_MULTISIG_ID, [relayUrl]);
    expect(checkpoint?.eventIds).not.toContain(conflict.id);
    expect(checkpoint?.syncedAt).toBeLessThanOrEqual(conflict.created_at + 3 * 24 * 60 * 60);
    await target.handler(sync, harnessExtensionSender);
    expect(network.sinceValues.at(-1)).toBeLessThanOrEqual(conflict.created_at);
    await target.handler(
      { multisigId: HARNESS_MULTISIG_ID, type: "wallet.forgetArgentMultisigStrk20Key" },
      harnessExtensionSender,
    );
    await expect(target.handler(sync, harnessExtensionSender)).resolves.toMatchObject({
      ok: true,
      strk20Key: "stored",
    });
  });

  test("does not checkpoint a key wrap the collection cannot hold yet", async () => {
    const nostrA = "11".repeat(32);
    const nostrB = "22".repeat(32);
    const network = coordinationNetwork();
    const store = createNostrCoordinationStore({ store: createMemoryStore() });
    const target = await makeMultisigHarness({
      coordination: network.identity(nostrB),
      nostrCoordinationStore: store,
      now: () => 2_000_000_000_000,
      strk20KeyCapacity: 1,
    });
    await target.preferencesStore.saveAddress({
      address: harnessAccountA.address,
      label: "Co-signer A",
      networkId: "SN_MAIN",
      nostrPublicKey: nostrA,
      publicKeyX: harnessAccountA.publicKeyX,
    });
    const [sample] = await target.multisigStore.listMultisigs();
    if (!sample) throw new Error("missing harness multisig");
    const fillerId = "SN_MAIN:0x11";
    await target.multisigStore.upsertMultisig({
      accountContractType: "argent-multisig",
      address: "0x11",
      classHash: sample.classHash,
      id: fillerId,
      networkId: "SN_MAIN",
    });
    await expect(
      target.handler(
        { multisigId: fillerId, type: "wallet.createArgentMultisigStrk20Key" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ ok: true, state: "created" });
    const offered = JSON.parse(
      await network.identity(nostrA).wrap({
        content: packageFor(KEY),
        identifier: MULTISIG_STRK20_KEY_IDENTIFIER,
        recipientPublicKey: nostrB,
      }),
    ) as { readonly id: string } & NostrEvent;
    network.pushEvent(offered);
    const sync = {
      multisigId: HARNESS_MULTISIG_ID,
      type: "wallet.syncArgentMultisigIntents",
    };
    await expect(target.handler(sync, harnessExtensionSender)).resolves.toMatchObject({
      ok: true,
      strk20Key: "none",
    });
    const before = await store.getCheckpoint(
      HARNESS_MULTISIG_ID,
      coordinationRelayUrls(defaultWalletPreferences()),
    );
    expect(before?.eventIds ?? []).not.toContain(offered.id);
    await target.handler(
      { multisigId: fillerId, type: "wallet.forgetArgentMultisigStrk20Key" },
      harnessExtensionSender,
    );
    await expect(target.handler(sync, harnessExtensionSender)).resolves.toMatchObject({
      ok: true,
      strk20Key: "stored",
    });
  });
});
