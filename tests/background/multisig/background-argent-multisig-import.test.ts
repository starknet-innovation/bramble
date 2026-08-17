/**
 * Cross-wallet intent import and destructive-removal guards.
 */
import { describe, expect, test } from "bun:test";
import type { ArgentMultisigSigningIntent } from "@mc-wallet/multisig/repository";
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

describe("Argent multisig intent import", () => {
  test("imports only a versioned, current-nonce, hash-valid package", async () => {
    const source = await makeMultisigHarness();
    const prepared = await source.handler(
      {
        calls: [{ calldata: [], contractAddress: HARNESS_TARGET, entrypoint: "transfer" }],
        multisigId: HARNESS_MULTISIG_ID,
        type: "wallet.prepareArgentMultisigIntent",
      },
      harnessExtensionSender,
    );
    const packageValue = (prepared as { readonly intentPackage: unknown }).intentPackage;
    const target = await makeMultisigHarness();
    await expect(
      target.handler(
        { package: packageValue, type: "wallet.importArgentMultisigIntent" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });
    const tampered = structuredClone(packageValue) as {
      intent: ArgentMultisigSigningIntent;
      kind: string;
      version: number;
    };
    tampered.intent = {
      ...tampered.intent,
      prepared: { ...tampered.intent.prepared, nonce: "0x8" },
    };
    await expect(
      target.handler(
        { package: tampered, type: "wallet.importArgentMultisigIntent" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "invalid Argent multisig intent package" });
  });

  test("imports, signs, and submits an ordinary intent for an address-only watch", async () => {
    const source = await makeMultisigHarness();
    const prepared = await source.handler(
      {
        calls: [{ calldata: [], contractAddress: HARNESS_TARGET, entrypoint: "transfer" }],
        multisigId: HARNESS_MULTISIG_ID,
        type: "wallet.prepareArgentMultisigIntent",
      },
      harnessExtensionSender,
    );
    const target = await makeMultisigHarness({ watchedOnly: true });
    const imported = await target.handler(
      {
        package: (prepared as { readonly intentPackage: unknown }).intentPackage,
        type: "wallet.importArgentMultisigIntent",
      },
      harnessExtensionSender,
    );
    expect(imported).toMatchObject({ ok: true });
    let signed = intentFrom(
      await target.handler(
        {
          intentId: intentFrom(imported).id,
          signerAccountId: harnessAccountA.id,
          type: "wallet.signArgentMultisigIntent",
        },
        harnessExtensionSender,
      ),
    );
    signed = intentFrom(
      await target.handler(
        {
          intentId: signed.id,
          signerAccountId: harnessAccountB.id,
          type: "wallet.signArgentMultisigIntent",
        },
        harnessExtensionSender,
      ),
    );
    await expect(
      target.handler(
        { intentId: signed.id, type: "wallet.submitArgentMultisigIntent" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });
  });

  test("cannot remove an account with a collecting intent", async () => {
    const harness = await makeMultisigHarness();
    await harness.handler(
      {
        calls: [{ calldata: [], contractAddress: HARNESS_TARGET, entrypoint: "transfer" }],
        multisigId: HARNESS_MULTISIG_ID,
        type: "wallet.prepareArgentMultisigIntent",
      },
      harnessExtensionSender,
    );
    await expect(
      harness.handler(
        { multisigId: HARNESS_MULTISIG_ID, type: "wallet.removeMultisig" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "Argent multisig has a pending or unresolved operation" });
  });

  test("derives imported lifecycle locally and discards remote terminal claims", async () => {
    const source = await makeMultisigHarness();
    let intent = intentFrom(
      await source.handler(
        {
          calls: [{ calldata: [], contractAddress: HARNESS_TARGET, entrypoint: "transfer" }],
          multisigId: HARNESS_MULTISIG_ID,
          type: "wallet.prepareArgentMultisigIntent",
        },
        harnessExtensionSender,
      ),
    );
    for (const account of [harnessAccountA, harnessAccountB]) {
      intent = intentFrom(
        await source.handler(
          {
            intentId: intent.id,
            signerAccountId: account.id,
            type: "wallet.signArgentMultisigIntent",
          },
          harnessExtensionSender,
        ),
      );
    }
    const remotePackage = {
      intent: {
        ...intent,
        broadcastTransactionHash: intent.prepared.transactionHash,
        state: "accepted",
        summary: "Harmless unsigned note",
      },
      kind: "mc-wallet.argent-multisig-intent",
      version: 1,
    };
    const target = await makeMultisigHarness();
    const imported = await target.handler(
      { package: remotePackage, type: "wallet.importArgentMultisigIntent" },
      harnessExtensionSender,
    );
    expect(imported).toMatchObject({
      intent: { state: "ready" },
      intentPackage: {
        intent: { state: "ready", summary: "Call transfer on 0x222…x222" },
      },
      ok: true,
    });
    expect(intentFrom(imported).summary).toBe("Call transfer on 0x222…x222");
    expect(intentFrom(imported).broadcastTransactionHash).toBeUndefined();
  });

  test("removes terminal history after a completed local signing claim", async () => {
    const harness = await makeMultisigHarness();
    const prepared = await harness.handler(
      {
        calls: [{ calldata: [], contractAddress: HARNESS_TARGET, entrypoint: "transfer" }],
        multisigId: HARNESS_MULTISIG_ID,
        type: "wallet.prepareArgentMultisigIntent",
      },
      harnessExtensionSender,
    );
    const signed = await harness.handler(
      {
        intentId: intentFrom(prepared).id,
        signerAccountId: harnessAccountA.id,
        type: "wallet.signArgentMultisigIntent",
      },
      harnessExtensionSender,
    );
    await harness.multisigStore.upsertIntent({ ...intentFrom(signed), state: "stale" });

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
    expect(await harness.multisigStore.listMultisigs()).toEqual([]);
  });

  test("rejects a valid old-nonce package without re-estimating it", async () => {
    const source = await makeMultisigHarness();
    const prepared = await source.handler(
      {
        calls: [{ calldata: [], contractAddress: HARNESS_TARGET, entrypoint: "transfer" }],
        multisigId: HARNESS_MULTISIG_ID,
        type: "wallet.prepareArgentMultisigIntent",
      },
      harnessExtensionSender,
    );
    const target = await makeMultisigHarness({ nonce: "0x8" });
    await expect(
      target.handler(
        {
          package: (prepared as { readonly intentPackage: unknown }).intentPackage,
          type: "wallet.importArgentMultisigIntent",
        },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "Argent multisig intent nonce is no longer current" });
  });
});
