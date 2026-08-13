/**
 * Exact deployment-review binding and one-time consumption.
 */
import { describe, expect, test } from "bun:test";
import { memoryMultisigStore } from "@mc-wallet/multisig/repository";
import {
  HARNESS_KEYS,
  harnessAccountA,
  harnessExtensionSender,
  makeMultisigHarness,
} from "../../support/multisig-harness";

describe("Argent multisig deployment review", () => {
  test("submits only the exact one-time constructor, signer, network, address, and fee review", async () => {
    const harness = await makeMultisigHarness();
    const reviewed = await harness.handler(
      {
        networkId: "SN_MAIN",
        salt: "0x9",
        signerAccountId: harnessAccountA.id,
        signerPublicKeys: HARNESS_KEYS,
        threshold: 2,
        type: "wallet.reviewArgentMultisigDeployment",
      },
      harnessExtensionSender,
    );
    expect(reviewed).toMatchObject({
      deploymentReview: {
        fee: { overallFee: "44", unit: "FRI" },
        networkId: "SN_MAIN",
        signerAccountId: harnessAccountA.id,
      },
      ok: true,
    });
    const review = (reviewed as { readonly deploymentReview: Record<string, unknown> })
      .deploymentReview;
    await expect(
      harness.handler(
        {
          review: { ...review, fee: { overallFee: "45", unit: "FRI" } },
          type: "wallet.deployArgentMultisig",
        },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({
      error: "Argent multisig deployment must exactly match a fresh fee review",
    });
    await expect(
      harness.handler({ review, type: "wallet.deployArgentMultisig" }, harnessExtensionSender),
    ).resolves.toMatchObject({ ok: true, transactionHash: "0x7cd" });
    await expect(
      harness.handler({ review, type: "wallet.deployArgentMultisig" }, harnessExtensionSender),
    ).resolves.toEqual({
      error: "Argent multisig deployment must exactly match a fresh fee review",
    });
  });

  test("does not rebroadcast a deployment after its hash journal write fails", async () => {
    const backing = memoryMultisigStore();
    const harness = await makeMultisigHarness({
      multisigStore: {
        ...backing,
        async setOperationHash() {
          throw new Error("post-broadcast journal unavailable");
        },
      },
    });
    const reviewInput = {
      networkId: "SN_MAIN",
      salt: "0xa",
      signerAccountId: harnessAccountA.id,
      signerPublicKeys: HARNESS_KEYS,
      threshold: 2,
      type: "wallet.reviewArgentMultisigDeployment",
    } as const;
    const reviewed = await harness.handler(reviewInput, harnessExtensionSender);
    const review = (reviewed as { readonly deploymentReview: Record<string, unknown> })
      .deploymentReview;
    await expect(
      harness.handler({ review, type: "wallet.deployArgentMultisig" }, harnessExtensionSender),
    ).resolves.toMatchObject({ ok: true, transactionHash: "0x7cd" });
    expect(harness.deploymentSubmitCount()).toBe(1);

    const retryReview = await harness.handler(reviewInput, harnessExtensionSender);
    const retry = (retryReview as { readonly deploymentReview: Record<string, unknown> })
      .deploymentReview;
    await expect(
      harness.handler(
        { review: retry, type: "wallet.deployArgentMultisig" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "Argent multisig deployment outcome is unresolved" });
    expect(harness.deploymentSubmitCount()).toBe(1);
  });
});
