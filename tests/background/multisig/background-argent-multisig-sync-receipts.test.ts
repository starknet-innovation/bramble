/**
 * Relay sync receipts for co-signer gift wraps (Sherlock 129, 141).
 *
 * A wrap is skipped by later syncs only once this wallet is finished with it:
 * imported, a no-op, or refused for good. A wrap refused for a passing reason
 * (an RPC failure, another active network) is opened again on the next sync,
 * and no single wrap, however malformed its calls, can stop the rest of a sync.
 * A signature on an intent this wallet now words differently still merges
 * (Sherlock 178).
 */
import { describe, expect, test } from "bun:test";
import { createNostrCoordinationStore } from "@bramble/multisig/coordination";
import {
  type ArgentMultisigSigningIntent,
  argentMultisigIntentId,
} from "@bramble/multisig/repository";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import {
  type ArgentMultisigCall,
  argentMultisigTransactionHash,
} from "@bramble/starknet/multisig-invoke";
import { createMemoryStore } from "@bramble/store/kv";
import { num, transaction } from "starknet";
import { coordinationRelayUrls } from "../../../apps/extension/src/background/multisig/multisig-coordination-ops";
import { argentMultisigIntentPackage } from "../../../apps/extension/src/background/multisig/multisig-inputs";
import {
  HARNESS_MULTISIG,
  HARNESS_MULTISIG_ID,
  HARNESS_TARGET,
  harnessAccountA,
  harnessAccountB,
  harnessExtensionSender,
  type MultisigHarnessOptions,
  makeMultisigHarness,
} from "../../support/multisig-harness";
import { coordinationNetwork } from "../../support/nostr-coordination-network";

const NOSTR_A = "11".repeat(32);
const NOSTR_B = "22".repeat(32);
// The same frozen transaction with other calls, re-hashed so it passes every
// package validator: what a co-signer's own wallet could publish.
const withCalls = (
  intent: ArgentMultisigSigningIntent,
  calls: readonly ArgentMultisigCall[],
): ArgentMultisigSigningIntent => {
  const calldata = transaction
    .getExecuteCalldata(
      calls.map((call) => ({ ...call, calldata: [...call.calldata] })),
      "1",
    )
    .map((entry) => num.toHex(entry));
  const { transactionHash: _hash, ...frozen } = intent.prepared;
  const transactionHash = argentMultisigTransactionHash({ ...frozen, calldata, calls });
  return {
    ...intent,
    id: argentMultisigIntentId(intent.accountId, transactionHash) ?? "",
    prepared: { ...frozen, calldata, calls, transactionHash },
    signatures: [],
    state: "collecting",
  };
};

const sync = { multisigId: HARNESS_MULTISIG_ID, type: "wallet.syncArgentMultisigIntents" };

// Signer A prepares and shares; signer B syncs. Both have saved each other.
const coSigners = async (targetOptions: MultisigHarnessOptions = {}) => {
  const network = coordinationNetwork();
  const now = () => 2_000_000_000_000;
  const source = await makeMultisigHarness({ coordination: network.identity(NOSTR_A), now });
  const nostrCoordinationStore = createNostrCoordinationStore({ store: createMemoryStore() });
  const target = await makeMultisigHarness({
    ...targetOptions,
    coordination: network.identity(NOSTR_B),
    nostrCoordinationStore,
    now,
  });
  await source.preferencesStore.saveAddress({
    address: harnessAccountB.address,
    label: "Co-signer B",
    networkId: "SN_MAIN",
    nostrPublicKey: NOSTR_B,
    publicKeyX: harnessAccountB.publicKeyX,
  });
  await target.preferencesStore.saveAddress({
    address: harnessAccountA.address,
    label: "Co-signer A",
    networkId: "SN_MAIN",
    nostrPublicKey: NOSTR_A,
    publicKeyX: harnessAccountA.publicKeyX,
  });
  const prepare = async (entrypoint = "transfer") =>
    (
      (await source.handler(
        {
          calls: [{ calldata: [], contractAddress: HARNESS_TARGET, entrypoint }],
          multisigId: HARNESS_MULTISIG_ID,
          type: "wallet.prepareArgentMultisigIntent",
        },
        harnessExtensionSender,
      )) as { readonly intent: ArgentMultisigSigningIntent }
    ).intent;
  const share = (intent: ArgentMultisigSigningIntent) =>
    source.handler(
      { intentId: intent.id, type: "wallet.shareArgentMultisigIntent" },
      harnessExtensionSender,
    );
  // Publishes any package as signer A, as a co-signer's own wallet could.
  const publishAsA = async (intent: ArgentMultisigSigningIntent) => {
    const eventJson = await network.identity(NOSTR_A).wrap({
      content: JSON.stringify(argentMultisigIntentPackage(intent)),
      identifier: "bramble.multisig",
      recipientPublicKey: NOSTR_B,
    });
    await network.identity(NOSTR_A).transport.publish(eventJson, NOSTR_B, ["wss://x.example"]);
  };
  const syncTarget = () => target.handler(sync, harnessExtensionSender);
  // The wraps later syncs skip.
  const receipts = async () =>
    (
      await nostrCoordinationStore.getCheckpoint(
        HARNESS_MULTISIG_ID,
        coordinationRelayUrls(defaultWalletPreferences()),
      )
    )?.eventIds ?? [];
  return { prepare, publishAsA, receipts, share, source, syncTarget, target };
};

describe("relay sync receipts", () => {
  test("retries a wrap whose import failed on an RPC error", async () => {
    let nodeDown = false;
    const pair = await coSigners({
      getNonce: () => {
        if (nodeDown) throw new Error("node unavailable");
        return "0x7";
      },
    });
    const intent = await pair.prepare();
    await pair.share(intent);

    nodeDown = true;
    await expect(pair.syncTarget()).resolves.toMatchObject({ imported: 0, ok: true });
    expect(await pair.receipts()).toEqual([]);
    nodeDown = false;
    await expect(pair.syncTarget()).resolves.toMatchObject({
      imported: 1,
      intentIds: [intent.id],
      ok: true,
    });
    await expect(pair.target.multisigStore.getIntent(intent.id)).resolves.not.toBeNull();
  });

  test("does not open a wrap again once it was imported", async () => {
    const pair = await coSigners();
    const intent = await pair.prepare();
    await pair.share(intent);

    await expect(pair.syncTarget()).resolves.toMatchObject({ imported: 1, received: 1 });
    await expect(pair.syncTarget()).resolves.toMatchObject({ imported: 0, received: 0 });
  });

  test("does not open a wrap again once it was refused for good", async () => {
    let chainNonce = "0x7";
    const pair = await coSigners({ getNonce: () => chainNonce });
    const intent = await pair.prepare();
    await pair.share(intent);
    // The multisig moved past the proposal's nonce before this signer synced.
    chainNonce = "0x8";

    await expect(pair.syncTarget()).resolves.toMatchObject({ imported: 0, received: 1 });
    expect(await pair.receipts()).toHaveLength(1);
  });
});

describe("a call set the safety checks refuse", () => {
  test("is skipped without stopping the rest of the sync, and not opened again", async () => {
    const pair = await coSigners();
    const honest = await pair.prepare();
    // A multi-call that includes an account self-call, which the call-safety
    // check refuses by throwing.
    const poisoned = withCalls(honest, [
      { calldata: [], contractAddress: HARNESS_TARGET, entrypoint: "approve" },
      { calldata: ["0x1"], contractAddress: HARNESS_MULTISIG, entrypoint: "change_threshold" },
    ]);
    await pair.publishAsA(poisoned);
    await pair.share(honest);

    await expect(pair.syncTarget()).resolves.toMatchObject({
      imported: 1,
      intentIds: [honest.id],
      ok: true,
    });
    expect(await pair.receipts()).toHaveLength(2);
  });
});

describe("a co-signer's signature on an intent this wallet words differently", () => {
  test("is merged after a token the intent moves is added", async () => {
    const pair = await coSigners();
    const proposal = (
      (await pair.source.handler(
        {
          calls: [
            {
              calldata: ["0x333", "0x5", "0x0"],
              contractAddress: HARNESS_TARGET,
              entrypoint: "transfer",
            },
          ],
          multisigId: HARNESS_MULTISIG_ID,
          type: "wallet.prepareArgentMultisigIntent",
        },
        harnessExtensionSender,
      )) as { readonly intent: ArgentMultisigSigningIntent }
    ).intent;
    await pair.share(proposal);
    await expect(pair.syncTarget()).resolves.toMatchObject({ imported: 1 });
    const before = await pair.target.multisigStore.getIntent(proposal.id);

    await pair.target.preferencesStore.upsertToken(
      {
        address: HARNESS_TARGET,
        decimals: 18,
        name: "Target",
        networkId: "SN_MAIN",
        symbol: "TGT",
      },
      "user",
    );
    const signed = (
      (await pair.source.handler(
        {
          intentId: proposal.id,
          signerAccountId: harnessAccountA.id,
          type: "wallet.signArgentMultisigIntent",
        },
        harnessExtensionSender,
      )) as { readonly intent: ArgentMultisigSigningIntent }
    ).intent;
    await pair.share(signed);

    await expect(pair.syncTarget()).resolves.toMatchObject({ imported: 1 });
    await expect(pair.target.multisigStore.getIntent(proposal.id)).resolves.toMatchObject({
      signatures: [{ publicKey: harnessAccountA.publicKeyX }],
      summary: before?.summary,
    });
  });
});

describe("an intent the user removed (Sherlock 168, 237)", () => {
  test("is not brought back by relay sync under a new event id", async () => {
    const pair = await coSigners();
    const intent = await pair.prepare();
    await pair.share(intent);
    await expect(pair.syncTarget()).resolves.toMatchObject({ imported: 1 });
    await expect(
      pair.target.handler(
        { intentId: intent.id, type: "wallet.removeArgentMultisigIntent" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ ok: true });

    // The same package served again under an event id never receipted.
    await pair.share(intent);
    await expect(pair.syncTarget()).resolves.toMatchObject({ imported: 0, received: 1 });
    await expect(pair.target.multisigStore.getIntent(intent.id)).resolves.toBeNull();
  });

  test("can still be imported by hand, and then takes co-signer signatures again", async () => {
    const pair = await coSigners();
    const intent = await pair.prepare();
    await pair.share(intent);
    await pair.syncTarget();
    await pair.target.handler(
      { intentId: intent.id, type: "wallet.removeArgentMultisigIntent" },
      harnessExtensionSender,
    );

    await expect(
      pair.target.handler(
        {
          package: argentMultisigIntentPackage(intent),
          type: "wallet.importArgentMultisigIntent",
        },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });
    const signed = (
      (await pair.source.handler(
        {
          intentId: intent.id,
          signerAccountId: harnessAccountA.id,
          type: "wallet.signArgentMultisigIntent",
        },
        harnessExtensionSender,
      )) as { readonly intent: ArgentMultisigSigningIntent }
    ).intent;
    await pair.share(signed);

    await expect(pair.syncTarget()).resolves.toMatchObject({ imported: 1 });
    await expect(pair.target.multisigStore.getIntent(intent.id)).resolves.toMatchObject({
      signatures: [{ publicKey: harnessAccountA.publicKeyX }],
    });
  });
});
