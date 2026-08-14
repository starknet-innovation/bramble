/**
 * Exact signer-management review and accepted-observation reconciliation.
 */
import { describe, expect, test } from "bun:test";
import {
  type ArgentMultisigSigningIntent,
  memoryMultisigStore,
} from "@mc-wallet/multisig/repository";
import { ARGENT_MULTISIG_CONTRACT, argentSignerGuid } from "@mc-wallet/starknet/account-contracts";
import {
  HARNESS_KEYS,
  HARNESS_MULTISIG_ID,
  harnessAccountA,
  harnessAccountB,
  harnessExtensionSender,
  makeMultisigHarness,
} from "../../support/multisig-harness";

const intentFrom = (response: unknown): ArgentMultisigSigningIntent =>
  (response as { readonly intent: ArgentMultisigSigningIntent }).intent;

describe("Argent multisig configuration intents", () => {
  test("reviews exact authority, then advances two accepted changes without replay", async () => {
    const multisigAddress = HARNESS_MULTISIG_ID.slice(HARNESS_MULTISIG_ID.indexOf(":") + 1);
    let threshold = 2;
    let nonce = "0x7";
    const harness = await makeMultisigHarness({
      getConfig: () => ({
        classHash: ARGENT_MULTISIG_CONTRACT.classHash,
        signerGuids: HARNESS_KEYS.map(argentSignerGuid),
        threshold,
      }),
      getNonce: () => nonce,
    });

    const prepareThreshold = async (next: number) => {
      const response = await harness.handler(
        {
          calls: [
            {
              calldata: [`0x${next.toString(16)}`],
              contractAddress: multisigAddress,
              entrypoint: "change_threshold",
            },
          ],
          multisigId: HARNESS_MULTISIG_ID,
          type: "wallet.prepareArgentMultisigIntent",
        },
        harnessExtensionSender,
      );
      expect(response).toMatchObject({
        intent: { summary: `Change Argent multisig threshold to ${next}` },
        ok: true,
      });
      return intentFrom(response);
    };
    const signAndSubmit = async (
      intent: ArgentMultisigSigningIntent,
      signers: readonly [typeof harnessAccountA, ...(typeof harnessAccountA)[]],
    ) => {
      let current = intent;
      for (const signer of signers) {
        const signed = await harness.handler(
          {
            intentId: current.id,
            signerAccountId: signer.id,
            type: "wallet.signArgentMultisigIntent",
          },
          harnessExtensionSender,
        );
        expect(signed).toMatchObject({ ok: true });
        current = intentFrom(signed);
      }
      const submitted = intentFrom(
        await harness.handler(
          { intentId: current.id, type: "wallet.submitArgentMultisigIntent" },
          harnessExtensionSender,
        ),
      );
      await harness.activity.updateStatuses(
        { [submitted.prepared.transactionHash]: { status: "accepted" } },
        { accountId: HARNESS_MULTISIG_ID, networkId: "SN_MAIN" },
      );
      return submitted;
    };

    const first = await signAndSubmit(await prepareThreshold(1), [
      harnessAccountA,
      harnessAccountB,
    ]);
    await harness.handler(
      { multisigId: HARNESS_MULTISIG_ID, type: "wallet.refreshMultisig" },
      harnessExtensionSender,
    );
    expect((await harness.multisigStore.getIntent(first.id))?.state).toBe("accepted");
    expect((await harness.multisigStore.listMultisigs())[0]?.currentConfig?.threshold).toBe(2);
    threshold = 1;
    nonce = "0x8";
    await harness.handler(
      { multisigId: HARNESS_MULTISIG_ID, type: "wallet.refreshMultisig" },
      harnessExtensionSender,
    );
    expect((await harness.multisigStore.getIntent(first.id))?.state).toBe("accepted");
    expect((await harness.multisigStore.listMultisigs())[0]?.currentConfig?.threshold).toBe(1);

    const second = await signAndSubmit(await prepareThreshold(2), [harnessAccountA]);
    threshold = 2;
    nonce = "0x9";
    await harness.handler(
      { multisigId: HARNESS_MULTISIG_ID, type: "wallet.refreshMultisig" },
      harnessExtensionSender,
    );
    expect((await harness.multisigStore.getIntent(second.id))?.state).toBe("accepted");
    expect((await harness.multisigStore.listMultisigs())[0]?.currentConfig?.threshold).toBe(2);
  });

  test("recovers when config persistence succeeds before intent acceptance journaling", async () => {
    const backing = memoryMultisigStore();
    let failAcceptedWrite = true;
    let threshold = 2;
    const harness = await makeMultisigHarness({
      getConfig: () => ({
        classHash: ARGENT_MULTISIG_CONTRACT.classHash,
        signerGuids: HARNESS_KEYS.map(argentSignerGuid),
        threshold,
      }),
      multisigStore: {
        ...backing,
        async upsertIntent(intent) {
          if (intent.state === "accepted" && failAcceptedWrite) {
            failAcceptedWrite = false;
            throw new Error("accepted-intent journal unavailable");
          }
          return backing.upsertIntent(intent);
        },
      },
    });
    const address = HARNESS_MULTISIG_ID.slice(HARNESS_MULTISIG_ID.indexOf(":") + 1);
    let intent = intentFrom(
      await harness.handler(
        {
          calls: [{ calldata: ["0x1"], contractAddress: address, entrypoint: "change_threshold" }],
          multisigId: HARNESS_MULTISIG_ID,
          type: "wallet.prepareArgentMultisigIntent",
        },
        harnessExtensionSender,
      ),
    );
    for (const signer of [harnessAccountA, harnessAccountB]) {
      intent = intentFrom(
        await harness.handler(
          {
            intentId: intent.id,
            signerAccountId: signer.id,
            type: "wallet.signArgentMultisigIntent",
          },
          harnessExtensionSender,
        ),
      );
    }
    intent = intentFrom(
      await harness.handler(
        { intentId: intent.id, type: "wallet.submitArgentMultisigIntent" },
        harnessExtensionSender,
      ),
    );
    await harness.activity.updateStatuses(
      { [intent.prepared.transactionHash]: { status: "accepted" } },
      { accountId: HARNESS_MULTISIG_ID, networkId: "SN_MAIN" },
    );
    threshold = 1;
    await expect(
      harness.handler(
        { multisigId: HARNESS_MULTISIG_ID, type: "wallet.refreshMultisig" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "accepted-intent journal unavailable" });
    expect((await backing.listMultisigs())[0]?.currentConfig?.threshold).toBe(1);
    expect((await backing.getIntent(intent.id))?.state).toBe("submitted");
    await harness.handler(
      { multisigId: HARNESS_MULTISIG_ID, type: "wallet.refreshMultisig" },
      harnessExtensionSender,
    );
    expect((await backing.getIntent(intent.id))?.state).toBe("accepted");
  });
});
