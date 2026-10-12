/**
 * The multisig deployment claim is reconciled with the chain (Sherlock 197).
 *
 * A recorded deployment the chain refused or reverted no longer answers every
 * retry with "submitted" while nothing is sent; a pending one still does, so
 * a not-yet-visible deployment is never sent twice. A claim a lost reply left
 * without a hash no longer blocks removing the multisig once the chain says
 * it guards nothing.
 */
import { describe, expect, test } from "bun:test";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import {
  HARNESS_KEYS,
  harnessAccountA,
  makeMultisigHarness,
  harnessExtensionSender as sender,
} from "../../support/multisig-harness";

type Harness = Awaited<ReturnType<typeof makeMultisigHarness>>;
type Reviewed = {
  readonly deploymentReview?: { readonly address: string };
  readonly error?: string;
};

const review = async (harness: Harness, salt: string): Promise<Reviewed> =>
  (await harness.handler(
    {
      networkId: "SN_MAIN",
      salt,
      signerAccountId: harnessAccountA.id,
      signerPublicKeys: HARNESS_KEYS,
      threshold: 2,
      type: "wallet.reviewArgentMultisigDeployment",
    },
    sender,
  )) as Reviewed;

const deploy = (harness: Harness, reviewed: Reviewed) =>
  harness.handler(
    { review: reviewed.deploymentReview, type: "wallet.deployArgentMultisig" },
    sender,
  );

const accountIdOf = (reviewed: Reviewed): string =>
  `SN_MAIN:${reviewed.deploymentReview?.address ?? ""}`;

// Deploys once, then marks the recorded deployment with `status` as the
// activity observer would, and reviews and deploys again.
const retryAfter = async (
  status: "pending" | "rejected" | "reverted",
  deployed: () => boolean = () => false,
) => {
  let hashes = 0;
  const harness = await makeMultisigHarness({
    deploymentStatus: deployed,
    submitAccountDeployment: async () => {
      hashes += 1;
      return `0x7c${hashes}`;
    },
  });
  const first = await review(harness, "0xb");
  await deploy(harness, first);
  const scope = { accountId: accountIdOf(first), networkId: "SN_MAIN" as const };
  await harness.activity.updateStatuses({ "0x7c1": { status } }, scope);
  const retry = await deploy(harness, await review(harness, "0xb"));
  return { harness, retry };
};

describe("a recorded deployment", () => {
  test("that the chain rejected frees its claim, so a retry broadcasts again", async () => {
    const { harness, retry } = await retryAfter("rejected");
    expect(harness.deploymentSubmitCount()).toBe(2);
    expect(retry).toMatchObject({ ok: true, transactionHash: "0x7c2" });
  });

  test("that reverted frees its claim too", async () => {
    const { harness, retry } = await retryAfter("reverted");
    expect(harness.deploymentSubmitCount()).toBe(2);
    expect(retry).toMatchObject({ ok: true, transactionHash: "0x7c2" });
  });

  test("that is still pending keeps its claim and is never sent twice", async () => {
    const { harness, retry } = await retryAfter("pending");
    expect(harness.deploymentSubmitCount()).toBe(1);
    expect(retry).toMatchObject({ ok: true, transactionHash: "0x7c1" });
  });

  test("marked rejected while the chain shows the account deployed is not sent again", async () => {
    let deployed = false;
    let hashes = 0;
    const harness = await makeMultisigHarness({
      deploymentStatus: () => deployed,
      submitAccountDeployment: async () => {
        hashes += 1;
        return `0x7c${hashes}`;
      },
    });
    const first = await review(harness, "0xb");
    await deploy(harness, first);
    await harness.activity.updateStatuses(
      { "0x7c1": { status: "rejected" } },
      { accountId: accountIdOf(first), networkId: "SN_MAIN" },
    );
    const second = await review(harness, "0xb");
    // The account lands between the fresh review and the retry.
    deployed = true;
    const retry = await deploy(harness, second);
    expect(harness.deploymentSubmitCount()).toBe(1);
    expect(retry).toMatchObject({ ok: true, transactionHash: "0x7c1" });
  });
});

describe("a deployment claim a lost reply left without a hash", () => {
  // The submission's reply is lost; `chain` answers the deployment status
  // once it has been attempted, as the account lands (or not) only then.
  const lostReply = async (chain: () => boolean) => {
    let attempted = false;
    const harness = await makeMultisigHarness({
      beforeAccountDeployment() {
        attempted = true;
        throw new IndeterminateRpcWriteError("submission status is unknown");
      },
      deploymentStatus: () => attempted && chain(),
    });
    const reviewed = await review(harness, "0xc");
    await deploy(harness, reviewed);
    expect(await harness.multisigStore.listOperations()).toMatchObject([{ kind: "deploy" }]);
    return { harness, id: accountIdOf(reviewed) };
  };

  const remove = (harness: Harness, multisigId: string) =>
    harness.handler(
      { confirmHistoryRemoval: true, multisigId, type: "wallet.removeMultisig" },
      sender,
    );

  test("no longer blocks removal once the chain shows the account deployed", async () => {
    const { harness, id } = await lostReply(() => true);
    expect(await remove(harness, id)).toEqual({ ok: true });
    expect(await harness.multisigStore.listOperations()).toEqual([]);
  });

  test("no longer blocks removal once the chain shows nothing deployed", async () => {
    const { harness, id } = await lostReply(() => false);
    expect(await remove(harness, id)).toEqual({ ok: true });
  });

  test("still blocks removal while the chain cannot be read", async () => {
    let readable = false;
    const { harness, id } = await lostReply(() => {
      if (!readable) throw new Error("node unavailable");
      return false;
    });
    expect(await remove(harness, id)).toEqual({
      error: "Argent multisig has a pending or unresolved operation",
    });
    readable = true;
    expect(await remove(harness, id)).toEqual({ ok: true });
  });
});
