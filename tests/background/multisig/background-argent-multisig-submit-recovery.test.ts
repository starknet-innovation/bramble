/** Durable exact-transaction recovery after interrupted Argent multisig submits. */
import { describe, expect, test } from "bun:test";
import {
  type ArgentMultisigSigningIntent,
  argentMultisigOperationId,
  memoryMultisigStore,
} from "@mc-wallet/multisig/repository";
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

const readyIntent = async (harness: Awaited<ReturnType<typeof makeMultisigHarness>>) => {
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
  for (const account of [harnessAccountA, harnessAccountB]) {
    intent = intentFrom(
      await harness.handler(
        {
          intentId: intent.id,
          signerAccountId: account.id,
          type: "wallet.signArgentMultisigIntent",
        },
        harnessExtensionSender,
      ),
    );
  }
  return intent;
};

describe("Argent multisig submit recovery", () => {
  test("returns a known broadcast hash but never rebroadcasts after journal failure", async () => {
    const backing = memoryMultisigStore();
    const harness = await makeMultisigHarness({
      multisigStore: {
        ...backing,
        async setOperationHash() {
          throw new Error("post-broadcast journal unavailable");
        },
      },
    });
    const intent = await readyIntent(harness);
    await expect(
      harness.handler(
        { intentId: intent.id, type: "wallet.submitArgentMultisigIntent" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true, transactionHash: intent.prepared.transactionHash });
    expect(harness.submitCount()).toBe(1);
    await expect(
      harness.handler(
        { intentId: intent.id, type: "wallet.submitArgentMultisigIntent" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true, transactionHash: intent.prepared.transactionHash });
    expect(harness.submitCount()).toBe(1);
  });

  test("retries the same frozen transaction after a pre-write worker interruption", async () => {
    const harness = await makeMultisigHarness();
    const intent = await readyIntent(harness);
    const operationId = argentMultisigOperationId(
      "submit",
      intent.accountId,
      intent.prepared.transactionHash,
    );
    if (!operationId) throw new Error("submission operation id unavailable");
    await expect(
      harness.multisigStore.claimOperation({
        accountId: intent.accountId,
        id: operationId,
        kind: "submit",
        target: intent.prepared.transactionHash,
      }),
    ).resolves.toBe("claimed");

    await expect(
      harness.handler(
        { intentId: intent.id, type: "wallet.submitArgentMultisigIntent" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true, transactionHash: intent.prepared.transactionHash });
    expect(harness.submitCount()).toBe(1);
  });
});
