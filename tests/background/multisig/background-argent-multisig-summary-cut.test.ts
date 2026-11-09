/**
 * A proposal whose reviewed summary is cut to the stored limit is still
 * accepted when the cut lands on a space (Sherlock 216). An unlimited approve
 * on an untracked token decodes to a 151-character summary whose
 * 120-character cut ends in the space before "on unknown contract".
 */
import { describe, expect, test } from "bun:test";
import { MULTISIG_LIMITS } from "@bramble/multisig/chain";
import type { ArgentMultisigSigningIntent } from "@bramble/multisig/repository";
import {
  HARNESS_MULTISIG_ID,
  harnessExtensionSender,
  makeMultisigHarness,
} from "../../support/multisig-harness";

const UNTRACKED_TOKEN = `0x6${"6".repeat(62)}`;
const SPENDER = "0x4270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f";
const U128_MAX = `0x${((1n << 128n) - 1n).toString(16)}`;

const propose = async (low: string, high: string) => {
  const harness = await makeMultisigHarness();
  const response = await harness.handler(
    {
      calls: [
        {
          calldata: [SPENDER, low, high],
          contractAddress: UNTRACKED_TOKEN,
          entrypoint: "approve",
        },
      ],
      multisigId: HARNESS_MULTISIG_ID,
      type: "wallet.prepareArgentMultisigIntent",
    },
    harnessExtensionSender,
  );
  return { response, stored: await harness.multisigStore.listIntents() };
};

describe("an unlimited approve on an untracked token", () => {
  test("becomes an intent whose summary is cut to the limit without edge whitespace", async () => {
    const { response, stored } = await propose(U128_MAX, U128_MAX);

    expect(response).toMatchObject({ ok: true });
    expect(stored).toHaveLength(1);
    const summary = (response as { readonly intent: ArgentMultisigSigningIntent }).intent.summary;
    expect(summary.length).toBeLessThanOrEqual(MULTISIG_LIMITS.summaryLength);
    expect(summary).toBe(summary.trim());
    expect(summary).toStartWith("Authorize 0x4270");
  });

  test("leaves a summary under the limit unchanged", async () => {
    const { response } = await propose("0x3e8", "0x0");
    expect((response as { readonly intent: ArgentMultisigSigningIntent }).intent.summary).toBe(
      "Authorize 0x4270…3b0f for amount or NFT #1000 on unknown contract 0x6666…6666",
    );
  });
});
