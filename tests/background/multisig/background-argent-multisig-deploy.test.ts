/**
 * Exact deployment-review binding and one-time consumption.
 */
import { describe, expect, test } from "bun:test";
import { memoryMultisigStore } from "@bramble/multisig/repository";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import { createMemoryStore } from "@bramble/store/kv";
import { createArgentMultisigDeploymentReviews } from "../../../apps/extension/src/background/multisig/multisig-deployment-reviews";
import {
  HARNESS_KEYS,
  HARNESS_MULTISIG_ID,
  harnessAccountA,
  harnessExtensionSender,
  makeMultisigHarness,
} from "../../support/multisig-harness";

describe("Argent multisig deployment review", () => {
  test("watches a counterfactual address and deploys only its matching constructor", async () => {
    const harness = await makeMultisigHarness({
      getConfig() {
        throw new Error("20: Contract not found: undefined");
      },
    });
    await harness.multisigStore.removeMultisig(HARNESS_MULTISIG_ID);
    const address = HARNESS_MULTISIG_ID.split(":")[1] ?? "";

    await expect(
      harness.handler(
        { address, networkId: "SN_MAIN", type: "wallet.addMultisig" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({
      multisig: { config: null, deployed: false, record: { address } },
      ok: true,
    });
    const setup = {
      expectedAddress: address,
      networkId: "SN_MAIN",
      salt: "0x0",
      signerAccountId: harnessAccountA.id,
      signerPublicKeys: HARNESS_KEYS,
      threshold: 2,
      type: "wallet.reviewArgentMultisigDeployment",
    } as const;
    await expect(
      harness.handler({ ...setup, salt: "0x1" }, harnessExtensionSender),
    ).resolves.toEqual({
      error: "Signer set, threshold, and salt do not reproduce the watched multisig address",
    });
    const reviewed = await harness.handler(setup, harnessExtensionSender);
    const review = (reviewed as { readonly deploymentReview: Record<string, unknown> })
      .deploymentReview;
    await expect(
      harness.handler({ review, type: "wallet.deployArgentMultisig" }, harnessExtensionSender),
    ).resolves.toMatchObject({
      multisig: { deployed: null, deploymentPending: true },
      ok: true,
      transactionHash: "0x7cd",
    });
    expect((await harness.multisigStore.listMultisigs())[0]?.currentConfig).toBeUndefined();
    await expect(
      harness.handler({ cached: true, type: "wallet.multisigs" }, harnessExtensionSender),
    ).resolves.toMatchObject({
      multisigs: [{ deployed: null, deploymentPending: true }],
      ok: true,
    });
    expect(harness.deploymentSubmitCount()).toBe(1);
  });

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

  test("replaces pending deployment state after fresh authority is observed", async () => {
    const harness = await makeMultisigHarness({ watchedOnly: true });
    const reviewed = await harness.handler(
      {
        expectedAddress: HARNESS_MULTISIG_ID.split(":")[1],
        networkId: "SN_MAIN",
        salt: "0x0",
        signerAccountId: harnessAccountA.id,
        signerPublicKeys: HARNESS_KEYS,
        threshold: 2,
        type: "wallet.reviewArgentMultisigDeployment",
      },
      harnessExtensionSender,
    );
    const review = (reviewed as { readonly deploymentReview: Record<string, unknown> })
      .deploymentReview;
    await harness.handler({ review, type: "wallet.deployArgentMultisig" }, harnessExtensionSender);

    await expect(
      harness.handler({ type: "wallet.multisigs" }, harnessExtensionSender),
    ).resolves.toMatchObject({
      multisigs: [{ authorityStatus: "available", deployed: true }],
      ok: true,
    });
    expect((await harness.multisigStore.listMultisigs())[0]?.currentConfig).toEqual({
      signerPublicKeys: HARNESS_KEYS,
      threshold: 2,
    });
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
    expect(await harness.multisigStore.listMultisigs()).toContainEqual(
      expect.objectContaining({
        deployment: expect.objectContaining({ salt: "0x9", threshold: 2 }),
      }),
    );
    const review = (reviewed as { readonly deploymentReview: Record<string, unknown> })
      .deploymentReview;

    await expect(
      harness.handler({ review, type: "wallet.deployArgentMultisig" }, harnessExtensionSender),
    ).resolves.toEqual({
      error: "Argent multisig deployment address needs STRK before deployment",
    });
    expect(harness.deploymentSubmitCount()).toBe(0);
  });

  test("reports an existing deployment before fee estimation and across an estimate race", async () => {
    const input = {
      networkId: "SN_MAIN",
      salt: "0x9",
      signerAccountId: harnessAccountA.id,
      signerPublicKeys: HARNESS_KEYS,
      threshold: 2,
      type: "wallet.reviewArgentMultisigDeployment",
    } as const;
    const alreadyDeployed = await makeMultisigHarness({ deploymentStatus: true });
    await expect(alreadyDeployed.handler(input, harnessExtensionSender)).resolves.toEqual({
      error: "Argent multisig is already deployed",
    });

    const raced = await makeMultisigHarness({
      deploymentEstimateError: new Error("Deployment failed: contract already deployed at address"),
    });
    await expect(raced.handler(input, harnessExtensionSender)).resolves.toEqual({
      error: "Argent multisig is already deployed",
    });
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

  test("does not consume a fee review before deployment context is available", async () => {
    const harness = await makeMultisigHarness();
    const reviewed = await harness.handler(
      {
        networkId: "SN_MAIN",
        salt: "0xd",
        signerAccountId: harnessAccountA.id,
        signerPublicKeys: HARNESS_KEYS,
        threshold: 2,
        type: "wallet.reviewArgentMultisigDeployment",
      },
      harnessExtensionSender,
    );
    const review = (reviewed as { readonly deploymentReview: Record<string, unknown> })
      .deploymentReview;
    harness.session.lock();
    await expect(
      harness.handler({ review, type: "wallet.deployArgentMultisig" }, harnessExtensionSender),
    ).resolves.toEqual({ error: "wallet locked" });

    harness.session.unlock("correct horse battery staple");
    await expect(
      harness.handler({ review, type: "wallet.deployArgentMultisig" }, harnessExtensionSender),
    ).resolves.toMatchObject({ ok: true });
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

describe("Argent multisig deployment claim recovery", () => {
  const reviewFor = async (
    harness: Awaited<ReturnType<typeof makeMultisigHarness>>,
    salt: string,
  ): Promise<Record<string, unknown>> => {
    const reviewed = await harness.handler(
      {
        networkId: "SN_MAIN",
        salt,
        signerAccountId: harnessAccountA.id,
        signerPublicKeys: HARNESS_KEYS,
        threshold: 2,
        type: "wallet.reviewArgentMultisigDeployment",
      },
      harnessExtensionSender,
    );
    return (reviewed as { readonly deploymentReview: Record<string, unknown> }).deploymentReview;
  };

  test("releases the claim and permits a retry when the chain shows nothing deployed", async () => {
    // A submit whose response was lost leaves a durable claim with no hash, and
    // a deploy hash is only ever recovered from local evidence a lost response
    // never produced. Before the chain check that state was terminal: the
    // counterfactual address could never be deployed by this wallet again.
    let loseResponse = true;
    const harness = await makeMultisigHarness({
      beforeAccountDeployment() {
        // Only an INDETERMINATE failure keeps the claim; a determinate one is
        // already released at the submit site. This is the real lost-response
        // case, and the one that used to be terminal.
        if (loseResponse) throw new IndeterminateRpcWriteError("submission status is unknown");
      },
      deploymentStatus: false,
    });

    const first = await reviewFor(harness, "0xb");
    await expect(
      harness.handler(
        { review: first, type: "wallet.deployArgentMultisig" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "submission status is unknown" });
    expect(harness.deploymentSubmitCount()).toBe(0);

    loseResponse = false;
    const retry = await reviewFor(harness, "0xb");
    // The chain is certain the address is empty, so the claim is released and
    // this attempt is allowed to broadcast rather than reporting "unresolved".
    await expect(
      harness.handler(
        { review: retry, type: "wallet.deployArgentMultisig" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(harness.deploymentSubmitCount()).toBe(1);
  });

  test("keeps the claim and never rebroadcasts when the address is already deployed", async () => {
    let loseResponse = true;
    let deployed = false;
    const harness = await makeMultisigHarness({
      beforeAccountDeployment() {
        if (loseResponse) throw new IndeterminateRpcWriteError("submission status is unknown");
      },
      deploymentStatus: () => deployed,
    });

    const first = await reviewFor(harness, "0xc");
    await expect(
      harness.handler(
        { review: first, type: "wallet.deployArgentMultisig" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "submission status is unknown" });

    loseResponse = false;
    deployed = true;
    await expect(
      harness.handler(
        {
          networkId: "SN_MAIN",
          salt: "0xc",
          signerAccountId: harnessAccountA.id,
          signerPublicKeys: HARNESS_KEYS,
          threshold: 2,
          type: "wallet.reviewArgentMultisigDeployment",
        },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "Argent multisig is already deployed" });
    // The preflight resolves from chain existence without estimating or
    // broadcasting a second deployment.
    expect(harness.deploymentSubmitCount()).toBe(0);
  });
});
