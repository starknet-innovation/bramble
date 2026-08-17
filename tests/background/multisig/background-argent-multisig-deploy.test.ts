/**
 * Exact deployment-review binding and one-time consumption.
 */
import { describe, expect, test } from "bun:test";
import { memoryMultisigStore } from "@mc-wallet/multisig/repository";
import { createMemoryStore } from "@mc-wallet/store/kv";
import { createArgentMultisigDeploymentReviews } from "../../../apps/extension/src/background/multisig/multisig-deployment-reviews";
import {
  HARNESS_KEYS,
  HARNESS_MULTISIG_ID,
  harnessAccountA,
  harnessExtensionSender,
  makeMultisigHarness,
} from "../../support/multisig-harness";

describe("Argent multisig deployment review", () => {
  test("keeps one exact review across a service-worker restart and consumes it once", async () => {
    const storage = createMemoryStore();
    const firstWorker = createArgentMultisigDeploymentReviews(storage);
    const review: Parameters<typeof firstWorker.put>[0] = {
      address: HARNESS_MULTISIG_ID.split(":")[1] ?? "",
      fee: { overallFee: "44", unit: "FRI" },
      feeAffordability: "ok",
      networkId: "SN_MAIN",
      salt: "0x0",
      signerAccountId: harnessAccountA.id,
      signerPublicKeys: HARNESS_KEYS,
      threshold: 2,
    };
    await firstWorker.put(review);

    const restartedWorker = createArgentMultisigDeploymentReviews(storage);
    expect(await restartedWorker.take(review)).toBe(true);
    expect(await restartedWorker.take(review)).toBe(false);
  });

  test("reports funding before broadcasting an unfunded multisig", async () => {
    const harness = await makeMultisigHarness({ deploymentBalance: "0" });
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
    expect(reviewed).toMatchObject({ deploymentReview: { feeAffordability: "insufficient" } });
    const review = (reviewed as { readonly deploymentReview: Record<string, unknown> })
      .deploymentReview;

    await expect(
      harness.handler({ review, type: "wallet.deployArgentMultisig" }, harnessExtensionSender),
    ).resolves.toEqual({
      error: "Argent multisig deployment address needs STRK before deployment",
    });
    expect(harness.deploymentSubmitCount()).toBe(0);
  });

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
    ).resolves.toMatchObject({ ok: true, transactionHash: "0x7cd" });
    expect(harness.deploymentSubmitCount()).toBe(1);
  });

  test("revokes and releases deployment authority when the wallet locks at the RPC write", async () => {
    let lockAtWrite = true;
    let lock = () => {};
    const harness = await makeMultisigHarness({
      beforeAccountDeployment() {
        if (lockAtWrite) lock();
      },
    });
    lock = () => harness.session.lock();
    const input = {
      networkId: "SN_MAIN",
      salt: "0xb",
      signerAccountId: harnessAccountA.id,
      signerPublicKeys: HARNESS_KEYS,
      threshold: 2,
      type: "wallet.reviewArgentMultisigDeployment",
    } as const;
    const reviewed = await harness.handler(input, harnessExtensionSender);
    const review = (reviewed as { readonly deploymentReview: Record<string, unknown> })
      .deploymentReview;
    await expect(
      harness.handler({ review, type: "wallet.deployArgentMultisig" }, harnessExtensionSender),
    ).resolves.toEqual({ error: "wallet locked" });
    expect(harness.deploymentSubmitCount()).toBe(0);
    expect(
      (await harness.multisigStore.listOperations()).some(({ kind }) => kind === "deploy"),
    ).toBe(false);

    lockAtWrite = false;
    harness.session.unlock("correct horse battery staple");
    const reviewedAgain = await harness.handler(input, harnessExtensionSender);
    const retry = (reviewedAgain as { readonly deploymentReview: Record<string, unknown> })
      .deploymentReview;
    await expect(
      harness.handler(
        { review: retry, type: "wallet.deployArgentMultisig" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(harness.deploymentSubmitCount()).toBe(1);
  });
});
