/**
 * A stale Argent intent that was sent anyway (Sherlock 177).
 *
 * Every signer holds the same signed package, so a co-signer can broadcast it
 * first, and a write endpoint can forward it and then answer with a fee
 * rejection. Either way this wallet marks its copy stale. The wallet must look
 * up the signed hash before it treats the intent as unsent: an executed intent
 * moves to `submitted`, and preparing the same calls again is refused, so the
 * recipient is never paid twice.
 */

import { describe, expect, test } from "bun:test";
import type { ArgentMultisigSigningIntent } from "@bramble/multisig/repository";
import { ArgentMultisigFeeExpiredError } from "@bramble/starknet/multisig-invoke";
import {
  ARGENT_INTENT_ALREADY_SENT,
  ARGENT_INTENT_SEND_UNKNOWN,
} from "../../../apps/extension/src/background/multisig/multisig-stale-intents";
import {
  HARNESS_MULTISIG_ID,
  HARNESS_TARGET,
  harnessAccountA,
  harnessAccountB,
  makeMultisigHarness,
  harnessExtensionSender as sender,
} from "../../support/multisig-harness";

const CALLS = [
  { calldata: ["0x999", "0x1388", "0x0"], contractAddress: HARNESS_TARGET, entrypoint: "transfer" },
];
const OTHER_CALLS = [
  { calldata: ["0x998", "0x1", "0x0"], contractAddress: HARNESS_TARGET, entrypoint: "transfer" },
];
const FEE_EXPIRED =
  "RPC: starknet_addInvokeTransaction 55: Account validation failed: Resource bounds were not satisfied: Max L1DataGas price (1) is lower than the actual gas price: 2.";
const NONCE_USED = "Argent multisig intent nonce is no longer current";

type Sighting = "accepted" | "received" | "absent" | "odd" | "fails";

const statusFor = (sighting: Sighting, hash: string) => {
  if (sighting === "fails") return Promise.reject(new Error("node unavailable"));
  if (sighting === "absent") return Promise.resolve({});
  const report =
    sighting === "accepted"
      ? { finalizedOnL1: false, found: true, seen: true, status: "accepted" as const }
      : sighting === "received"
        ? { finalizedOnL1: false, found: true, seen: true, status: "pending" as const }
        : { finalizedOnL1: false, found: true, seen: false, status: "pending" as const };
  return Promise.resolve({ [hash]: report });
};

const intentFrom = (response: unknown): ArgentMultisigSigningIntent =>
  (response as { readonly intent: ArgentMultisigSigningIntent }).intent;

const setup = async (options: { readonly feeExpiredOnce?: boolean } = {}) => {
  const chain = { lookups: 0, nonce: 7n, sighting: "absent" as Sighting };
  let submits = 0;
  const harness = await makeMultisigHarness({
    getNonce: () => `0x${chain.nonce.toString(16)}`,
    async getTransactionStatuses(hash) {
      chain.lookups += 1;
      return statusFor(chain.sighting, hash);
    },
    async submitPrepared(hash) {
      submits += 1;
      if (options.feeExpiredOnce && submits === 1) {
        throw new ArgentMultisigFeeExpiredError(FEE_EXPIRED);
      }
      return hash;
    },
  });
  const prepare = (calls = CALLS) =>
    harness.handler(
      { calls, multisigId: HARNESS_MULTISIG_ID, type: "wallet.prepareArgentMultisigIntent" },
      sender,
    ) as Promise<Record<string, unknown>>;
  const prepareAndSign = async () => {
    let intent = intentFrom(await prepare());
    for (const signerAccountId of [harnessAccountA.id, harnessAccountB.id]) {
      intent = intentFrom(
        await harness.handler(
          { intentId: intent.id, signerAccountId, type: "wallet.signArgentMultisigIntent" },
          sender,
        ),
      );
    }
    return intent;
  };
  const submit = (intentId: string) =>
    harness.handler({ intentId, type: "wallet.submitArgentMultisigIntent" }, sender) as Promise<
      Record<string, unknown>
    >;
  const stored = async (id: string) => harness.multisigStore.getIntent(id);
  const intentCount = async () => (await harness.multisigStore.listIntents()).length;
  return { chain, harness, intentCount, prepare, prepareAndSign, stored, submit };
};

// The endpoint forwarded the signed transaction, then refused it on fee.
const staleAfterFeeRejection = async () => {
  const t = await setup({ feeExpiredOnce: true });
  const first = await t.prepareAndSign();
  await expect(t.submit(first.id)).resolves.toEqual({ error: FEE_EXPIRED });
  expect((await t.stored(first.id))?.state).toBe("stale");
  return { first, t };
};

describe("a co-signer already sent the signed intent", () => {
  test("submitting this wallet's copy records it as sent instead of stale", async () => {
    const t = await setup();
    const first = await t.prepareAndSign();
    t.chain.nonce = 8n;
    t.chain.sighting = "accepted";

    await expect(t.submit(first.id)).resolves.toEqual({ error: ARGENT_INTENT_ALREADY_SENT });

    const stored = await t.stored(first.id);
    expect(stored?.state).toBe("submitted");
    expect(stored?.broadcastTransactionHash).toBe(first.prepared.transactionHash);
    expect((await t.harness.activity.list()).map((entry) => entry.hash)).toEqual([
      first.prepared.transactionHash,
    ]);
  });

  test("a nonce used by a different transaction leaves the copy stale", async () => {
    const t = await setup();
    const first = await t.prepareAndSign();
    t.chain.nonce = 8n;

    await expect(t.submit(first.id)).resolves.toEqual({ error: NONCE_USED });

    expect((await t.stored(first.id))?.state).toBe("stale");
    expect(await t.harness.activity.list()).toEqual([]);
  });

  test("an odd status answer is not a sighting", async () => {
    const t = await setup();
    const first = await t.prepareAndSign();
    t.chain.nonce = 8n;
    t.chain.sighting = "odd";

    await expect(t.submit(first.id)).resolves.toEqual({ error: NONCE_USED });
    expect((await t.stored(first.id))?.state).toBe("stale");
  });
});

describe("preparing the same calls as a stale signed intent", () => {
  test("is refused when the stale intent's hash is on chain, and the intent becomes sent", async () => {
    const { first, t } = await staleAfterFeeRejection();
    t.chain.sighting = "received";
    const before = await t.intentCount();

    await expect(t.prepare()).resolves.toEqual({ error: ARGENT_INTENT_ALREADY_SENT });

    expect(await t.intentCount()).toBe(before);
    const stored = await t.stored(first.id);
    expect(stored?.state).toBe("submitted");
    expect(stored?.broadcastTransactionHash).toBe(first.prepared.transactionHash);
  });

  test("is refused when the chain cannot be asked, and the intent stays stale", async () => {
    const { first, t } = await staleAfterFeeRejection();
    t.chain.sighting = "fails";

    await expect(t.prepare()).resolves.toEqual({ error: ARGENT_INTENT_SEND_UNKNOWN });
    expect((await t.stored(first.id))?.state).toBe("stale");
  });

  test("goes ahead when the chain reports the stale intent's hash as never sent", async () => {
    const { first, t } = await staleAfterFeeRejection();
    // Another transaction used nonce 7; this intent can never execute now.
    t.chain.nonce = 8n;

    const replacement = intentFrom(await t.prepare());

    expect(replacement.prepared.nonce).toBe("0x8");
    expect(replacement.prepared.calls).toEqual(first.prepared.calls);
    expect((await t.stored(first.id))?.state).toBe("stale");
  });

  test("different calls never ask the chain", async () => {
    const { t } = await staleAfterFeeRejection();
    t.chain.sighting = "fails";
    const lookups = t.chain.lookups;

    expect(intentFrom(await t.prepare(OTHER_CALLS)).state).toBe("collecting");
    expect(t.chain.lookups).toBe(lookups);
  });
});

describe("a version prepared while the stale one looked unsent", () => {
  test("cannot be signed once the stale version is found on chain", async () => {
    const { first, t } = await staleAfterFeeRejection();
    t.chain.nonce = 8n;
    const replacement = intentFrom(await t.prepare());
    t.chain.sighting = "accepted";

    await expect(
      t.harness.handler(
        {
          intentId: replacement.id,
          signerAccountId: harnessAccountA.id,
          type: "wallet.signArgentMultisigIntent",
        },
        sender,
      ),
    ).resolves.toEqual({ error: ARGENT_INTENT_ALREADY_SENT });

    expect((await t.stored(replacement.id))?.signatures).toEqual([]);
    expect((await t.stored(first.id))?.state).toBe("submitted");
  });
});

describe("refresh", () => {
  test("records a stale intent found on chain as sent", async () => {
    const { first, t } = await staleAfterFeeRejection();
    t.chain.sighting = "accepted";

    await t.harness.handler(
      { multisigId: HARNESS_MULTISIG_ID, type: "wallet.refreshMultisig" },
      sender,
    );

    const stored = await t.stored(first.id);
    expect(stored?.state === "submitted" || stored?.state === "accepted").toBe(true);
    expect(stored?.broadcastTransactionHash).toBe(first.prepared.transactionHash);
  });

  test("leaves a stale intent the chain has never seen alone", async () => {
    const { first, t } = await staleAfterFeeRejection();

    await t.harness.handler(
      { multisigId: HARNESS_MULTISIG_ID, type: "wallet.refreshMultisig" },
      sender,
    );

    expect((await t.stored(first.id))?.state).toBe("stale");
  });
});
