/**
 * A stale Argent version whose own signed hash the chain answered for
 * (mc-wallet 673, part 2).
 *
 * - Rejected by the sequencer: never included, so this version was not sent.
 *   It never moves to `submitted` and joins no activity. Its calls may be
 *   proposed again, and at a nonce that moved that still waits for the user's
 *   confirmation, because a co-signer may have sent a different version.
 * - Included and reverted: its nonce and fee are spent and nothing was
 *   transferred. It joins activity, is settled, and is never looked up again;
 *   its calls may be proposed again without doubt about that nonce.
 *
 * Nothing is ever re-sent automatically: proposing again prepares a new
 * intent at the current nonce that needs fresh signatures.
 */

import { describe, expect, test } from "bun:test";
import {
  type ArgentMultisigSigningIntent,
  isArgentMultisigSigningIntent,
} from "@bramble/multisig/repository";
import { ArgentMultisigFeeExpiredError } from "@bramble/starknet/multisig-invoke";
import {
  argentMultisigIntentPackage,
  locallyDerivedImportedIntent,
} from "../../../apps/extension/src/background/multisig/multisig-inputs";
import { ARGENT_INTENT_RESEND_UNCONFIRMED } from "../../../apps/extension/src/background/multisig/multisig-stale-intents";
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
const FEE_EXPIRED =
  "RPC: starknet_addInvokeTransaction 55: Account validation failed: Resource bounds were not satisfied: Max L1DataGas price (1) is lower than the actual gas price: 2.";

type Fate = "rejected" | "reverted" | "fails";

const statusFor = (fate: Fate, hash: string) =>
  fate === "fails"
    ? Promise.reject(new Error("node unavailable"))
    : Promise.resolve({
        [hash]: { finalizedOnL1: false, found: true, seen: true, status: fate },
      });

const intentFrom = (response: unknown): ArgentMultisigSigningIntent =>
  (response as { readonly intent: ArgentMultisigSigningIntent }).intent;

// One intent, fully signed, refused on fee at its first submit, so it is stale.
// The chain then reports `fate` for its exact hash, at nonce `nonceAfter`.
const staleWith = async (fate: Fate, nonceAfter: bigint) => {
  const chain = { l2GasPrice: 6n, lookups: 0, nonce: 7n, submits: 0 };
  const harness = await makeMultisigHarness({
    getNonce: () => `0x${chain.nonce.toString(16)}`,
    l2GasPrice: () => chain.l2GasPrice,
    async getTransactionStatuses(hash) {
      chain.lookups += 1;
      return statusFor(fate, hash);
    },
    async submitPrepared() {
      chain.submits += 1;
      throw new ArgentMultisigFeeExpiredError(FEE_EXPIRED);
    },
  });
  const prepare = (confirmResend?: boolean) =>
    harness.handler(
      {
        calls: CALLS,
        ...(confirmResend === undefined ? {} : { confirmResend }),
        multisigId: HARNESS_MULTISIG_ID,
        type: "wallet.prepareArgentMultisigIntent",
      },
      sender,
    ) as Promise<Record<string, unknown>>;
  let intent = intentFrom(await prepare());
  for (const signerAccountId of [harnessAccountA.id, harnessAccountB.id]) {
    intent = intentFrom(
      await harness.handler(
        { intentId: intent.id, signerAccountId, type: "wallet.signArgentMultisigIntent" },
        sender,
      ),
    );
  }
  await expect(
    harness.handler({ intentId: intent.id, type: "wallet.submitArgentMultisigIntent" }, sender),
  ).resolves.toEqual({ error: FEE_EXPIRED });
  chain.nonce = nonceAfter;
  // The network fee rose, which is why the node refused this version.
  chain.l2GasPrice = 9n;
  const stored = () => harness.multisigStore.getIntent(intent.id);
  const journaled = async () =>
    (await harness.activity.list()).some((entry) => entry.hash === intent.prepared.transactionHash);
  return { chain, harness, intent, journaled, prepare, stored };
};

describe("a stale version the sequencer rejected", () => {
  test("is recorded as not sent at an unmoved nonce, and its calls can be proposed again", async () => {
    const t = await staleWith("rejected", 7n);
    const again = intentFrom(await t.prepare());
    expect(await t.stored()).toMatchObject({
      staleOutcome: "rejected-nonce-unused",
      state: "stale",
    });
    expect(await t.journaled()).toBe(false);
    // A new proposal at the current nonce, needing fresh signatures.
    expect(again.id).not.toBe(t.intent.id);
    expect(again).toMatchObject({ signatures: [], state: "collecting" });
    expect(again.prepared.nonce).toBe("0x7");
  });

  test("at a moved nonce, waits for confirmation, since another version may have gone out", async () => {
    const t = await staleWith("rejected", 8n);
    await expect(t.prepare()).resolves.toEqual({ error: ARGENT_INTENT_RESEND_UNCONFIRMED });
    expect(await t.stored()).toMatchObject({ staleOutcome: "rejected", state: "stale" });
    expect(await t.journaled()).toBe(false);
    const again = intentFrom(await t.prepare(true));
    expect(again).toMatchObject({ signatures: [], state: "collecting" });
    expect(again.prepared.nonce).toBe("0x8");
  });

  test("a moved nonce is never relaxed back to unused", async () => {
    const t = await staleWith("rejected", 8n);
    await t.prepare();
    t.chain.nonce = 7n;
    await t.prepare();
    expect((await t.stored())?.staleOutcome).toBe("rejected");
  });
});

describe("a stale version that reverted on chain", () => {
  test("is journaled, settled, and never looked up again", async () => {
    const t = await staleWith("reverted", 8n);
    const again = intentFrom(await t.prepare());
    expect(await t.stored()).toMatchObject({ staleOutcome: "reverted", state: "stale" });
    expect(await t.journaled()).toBe(true);
    // Its own reverted transaction spent nonce 7, so no doubt is raised there.
    expect(again).toMatchObject({ signatures: [], state: "collecting" });
    expect(again.prepared.nonce).toBe("0x8");
    const lookups = t.chain.lookups;
    await t.harness.handler(
      { intentId: again.id, type: "wallet.removeArgentMultisigIntent" },
      sender,
    );
    await t.prepare();
    expect(t.chain.lookups).toBe(lookups);
  });
});

describe("an unknown fate keeps the cautious stale behaviour", () => {
  test("records no outcome and still waits for confirmation at a moved nonce", async () => {
    const t = await staleWith("fails", 8n);
    await expect(t.prepare()).resolves.toEqual({ error: ARGENT_INTENT_RESEND_UNCONFIRMED });
    expect((await t.stored())?.staleOutcome).toBeUndefined();
  });
});

describe("nothing is re-sent automatically", () => {
  test("no fate broadcasts the stale version or the new proposal", async () => {
    for (const [fate, nonce] of [
      ["rejected", 7n],
      ["rejected", 8n],
      ["reverted", 8n],
    ] as const) {
      const t = await staleWith(fate, nonce);
      await t.prepare(true);
      expect(t.chain.submits, `${fate} ${nonce}`).toBe(1);
    }
  });
});

describe("the stale outcome stays local and well-formed", () => {
  test("is left out of the shared package and of an imported intent", async () => {
    const t = await staleWith("rejected", 7n);
    await t.prepare();
    const stored = await t.stored();
    if (!stored) throw new Error("intent missing");
    expect(stored.staleOutcome).toBe("rejected-nonce-unused");
    expect(argentMultisigIntentPackage(stored).intent).not.toHaveProperty("staleOutcome");
    expect(locallyDerivedImportedIntent(stored)).not.toHaveProperty("staleOutcome");
  });

  test("validates only a known outcome, and only on a stale intent", async () => {
    const t = await staleWith("rejected", 7n);
    await t.prepare();
    const stored = await t.stored();
    expect(isArgentMultisigSigningIntent(stored)).toBe(true);
    expect(isArgentMultisigSigningIntent({ ...stored, staleOutcome: "sent" })).toBe(false);
    expect(isArgentMultisigSigningIntent({ ...stored, state: "collecting" })).toBe(false);
  });
});
