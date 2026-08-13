/**
 * End-to-end frozen-intent collection and replay tests.
 */
import { describe, expect, test } from "bun:test";
import {
  type ArgentMultisigSigningIntent,
  memoryMultisigStore,
} from "@mc-wallet/multisig/repository";
import {
  HARNESS_MULTISIG_ID,
  HARNESS_TARGET,
  harnessAccountA,
  harnessAccountB,
  harnessContentSender,
  harnessExtensionSender,
  makeMultisigHarness,
} from "../../support/multisig-harness";

const intentFrom = (response: unknown): ArgentMultisigSigningIntent =>
  (response as { readonly intent: ArgentMultisigSigningIntent }).intent;

describe("Argent multisig background lifecycle", () => {
  test("prepares once, GUID-sorts real signatures, submits exact hash, and deduplicates replay", async () => {
    const harness = await makeMultisigHarness();
    const prepared = await harness.handler(
      {
        calls: [{ calldata: ["0x1"], contractAddress: HARNESS_TARGET, entrypoint: "transfer" }],
        multisigId: HARNESS_MULTISIG_ID,
        summary: "Send treasury funds",
        type: "wallet.prepareArgentMultisigIntent",
      },
      harnessExtensionSender,
    );
    expect(prepared).toMatchObject({ feeReview: { overallFee: "44", unit: "FRI" }, ok: true });
    let intent = intentFrom(prepared);
    for (const account of [harnessAccountB, harnessAccountA]) {
      const signed = await harness.handler(
        {
          intentId: intent.id,
          signerAccountId: account.id,
          type: "wallet.signArgentMultisigIntent",
        },
        harnessExtensionSender,
      );
      expect(signed).toMatchObject({ ok: true });
      intent = intentFrom(signed);
    }
    expect(intent.state).toBe("ready");
    const submitted = await harness.handler(
      { intentId: intent.id, type: "wallet.submitArgentMultisigIntent" },
      harnessExtensionSender,
    );
    expect(submitted).toMatchObject({
      ok: true,
      transactionHash: intent.prepared.transactionHash,
    });
    expect(harness.submitCount()).toBe(1);
    expect(
      await harness.handler(
        { intentId: intent.id, type: "wallet.submitArgentMultisigIntent" },
        harnessExtensionSender,
      ),
    ).toMatchObject({ ok: true, transactionHash: intent.prepared.transactionHash });
    expect(harness.submitCount()).toBe(1);
  });

  test("keeps every multisig message extension-page only", async () => {
    const { handler } = await makeMultisigHarness();
    await expect(handler({ type: "wallet.multisigs" }, harnessContentSender)).resolves.toEqual({
      error: "privileged sender required",
    });
  });

  test("returns balances with their exact account and network scope", async () => {
    const { handler } = await makeMultisigHarness();
    await expect(
      handler(
        { multisigId: HARNESS_MULTISIG_ID, type: "wallet.multisigBalances" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({
      accountId: HARNESS_MULTISIG_ID,
      balances: [],
      networkId: "SN_MAIN",
      ok: true,
    });
  });

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
    let intent = intentFrom(
      await harness.handler(
        {
          calls: [{ calldata: ["0x1"], contractAddress: HARNESS_TARGET, entrypoint: "transfer" }],
          multisigId: HARNESS_MULTISIG_ID,
          summary: "Send treasury funds",
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
    ).resolves.toEqual({ error: "Argent multisig submission outcome is unresolved" });
    expect(harness.submitCount()).toBe(1);
  });
});
