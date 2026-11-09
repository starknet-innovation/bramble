/** Durable exact-transaction recovery after interrupted Argent multisig submits. */
import { describe, expect, test } from "bun:test";
import {
  type ArgentMultisigSigningIntent,
  argentMultisigOperationId,
  memoryMultisigStore,
} from "@bramble/multisig/repository";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import { walletPaidRecipients } from "@bramble/transactions/paid-recipients";
import { readSubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
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

  test("a submitted single-payment intent records its payee as paid (#163)", async () => {
    const harness = await makeMultisigHarness();
    const intent = await readyIntent(harness);
    await harness.handler(
      { intentId: intent.id, type: "wallet.submitArgentMultisigIntent" },
      harnessExtensionSender,
    );
    const rows = await harness.activity.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ counterparty: "0x1", origin: "wallet" });
    expect(walletPaidRecipients(rows)).toEqual([{ address: "0x1", networkId: "SN_MAIN" }]);
  });

  test("a recovered broadcast records the same payee (#163)", async () => {
    const harness = await makeMultisigHarness({
      getTransactionStatuses: async (hash) => ({
        [hash]: { finalizedOnL1: false, found: true, status: "pending" },
      }),
    });
    const intent = await readyIntent(harness);
    const operationId = argentMultisigOperationId(
      "submit",
      intent.accountId,
      intent.prepared.transactionHash,
    );
    if (!operationId) throw new Error("submission operation id unavailable");
    await harness.multisigStore.claimOperation({
      accountId: intent.accountId,
      id: operationId,
      kind: "submit",
      target: intent.prepared.transactionHash,
    });
    await harness.handler(
      { intentId: intent.id, type: "wallet.submitArgentMultisigIntent" },
      harnessExtensionSender,
    );
    expect(harness.submitCount()).toBe(0);
    const [row] = await harness.activity.list();
    expect(row).toMatchObject({ counterparty: "0x1", origin: "wallet" });
  });

  // #681: a lost reply may have broadcast the signed package, so its exact
  // hash is journaled as pending and the panel is told the outcome is unknown.
  test("journals a lost-reply submit as pending under its signed hash", async () => {
    const harness = await makeMultisigHarness({
      async submitPrepared() {
        throw new IndeterminateRpcWriteError("submission outcome unknown");
      },
    });
    const intent = await readyIntent(harness);
    const response = await harness.handler(
      { intentId: intent.id, type: "wallet.submitArgentMultisigIntent" },
      harnessExtensionSender,
    );

    expect(readSubmissionUnknownError(response)?.transactionHash).toBe(
      intent.prepared.transactionHash,
    );
    const rows = await harness.activity.list();
    expect(rows.map((row) => [row.hash, row.status, row.summary])).toEqual([
      [intent.prepared.transactionHash, "pending", intent.summary],
    ]);
  });
});
