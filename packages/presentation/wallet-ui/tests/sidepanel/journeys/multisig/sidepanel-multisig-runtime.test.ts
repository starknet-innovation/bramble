/** Argent multisig response guards and runtime messaging preserve frozen authority. */
import { describe, expect, test } from "bun:test";
import {
  isArgentMultisigDeploymentReviewResponse,
  isArgentMultisigDeployResponse,
  isArgentMultisigIntentResponse,
  isArgentMultisigResponse,
  isArgentMultisigsResponse,
} from "../../../../src/popup/responses/multisig-responses";
import { createMultisigClient } from "../../../../src/sidepanel/journeys/multisig/multisig-runtime";
import { makeArgentMultisigFixture } from "../../../support/argent-multisig-fixtures";

describe("Argent multisig response validators", () => {
  test("accept exact watched-account and frozen-intent envelopes", async () => {
    const fixture = await makeArgentMultisigFixture();
    expect(
      isArgentMultisigsResponse({
        intents: [fixture.intent],
        multisigs: [fixture.view],
        ok: true,
      }),
    ).toBe(true);
    expect(
      isArgentMultisigResponse({ intents: [fixture.intent], multisig: fixture.view, ok: true }),
    ).toBe(true);
    expect(
      isArgentMultisigIntentResponse({
        feeReview: { overallFee: "44", unit: "FRI" },
        intent: fixture.intent,
        intentPackage: fixture.intentPackage,
        ok: true,
      }),
    ).toBe(true);
  });

  test("rejects unknown fields, hash tampering, and a package for another intent", async () => {
    const fixture = await makeArgentMultisigFixture();
    expect(
      isArgentMultisigsResponse({
        extra: true,
        intents: [fixture.intent],
        multisigs: [fixture.view],
        ok: true,
      }),
    ).toBe(false);
    expect(
      isArgentMultisigIntentResponse({
        intent: {
          ...fixture.intent,
          prepared: { ...fixture.intent.prepared, transactionHash: "0x456" },
        },
        ok: true,
      }),
    ).toBe(false);
    expect(
      isArgentMultisigIntentResponse({
        intent: fixture.intent,
        intentPackage: {
          ...fixture.intentPackage,
          intent: { ...fixture.intent, id: `${fixture.intent.id}:other` },
        },
        ok: true,
      }),
    ).toBe(false);
    expect(
      isArgentMultisigIntentResponse({
        intent: fixture.intent,
        intentPackage: {
          ...fixture.intentPackage,
          intent: { ...fixture.intent, summary: "different authority description" },
        },
        ok: true,
      }),
    ).toBe(false);
  });

  test("validates deployment review and requires the deployed address to match the record", async () => {
    const fixture = await makeArgentMultisigFixture();
    expect(
      isArgentMultisigDeploymentReviewResponse({
        deploymentReview: fixture.deploymentReview,
        ok: true,
      }),
    ).toBe(true);
    expect(
      isArgentMultisigDeployResponse({
        address: fixture.record.address,
        multisig: fixture.view,
        ok: true,
        transactionHash: "0x456",
      }),
    ).toBe(true);
    expect(
      isArgentMultisigDeployResponse({
        address: "0x999",
        multisig: fixture.view,
        ok: true,
        transactionHash: "0x456",
      }),
    ).toBe(false);
  });
});

describe("createMultisigClient", () => {
  test("uses dedicated Argent messages and returns only validated frozen results", async () => {
    const fixture = await makeArgentMultisigFixture();
    const messages: unknown[] = [];
    const client = createMultisigClient({
      async sendMessage(message) {
        messages.push(message);
        const type = (message as { readonly type?: string }).type;
        if (type === "wallet.multisigs") {
          return { intents: [fixture.intent], multisigs: [fixture.view], ok: true };
        }
        if (type === "wallet.prepareArgentMultisigIntent") {
          return {
            feeReview: { overallFee: "44", unit: "FRI" },
            intent: fixture.intent,
            intentPackage: fixture.intentPackage,
            ok: true,
          };
        }
        if (type === "wallet.signArgentMultisigIntent") {
          return { intent: fixture.intent, ok: true };
        }
        return { error: "unexpected message" };
      },
    });

    await expect(client.loadMultisigs()).resolves.toEqual({
      intents: [fixture.intent],
      multisigs: [fixture.view],
    });
    await expect(
      client.prepareIntent(
        fixture.record.id,
        [{ calldata: ["0x1"], contractAddress: "0xdef", entrypoint: "transfer" }],
        "Send funds",
      ),
    ).resolves.toEqual({
      feeReview: { overallFee: "44", unit: "FRI" },
      intent: fixture.intent,
      intentPackage: fixture.intentPackage,
    });
    await expect(
      client.signIntent(fixture.intent.id, fixture.status.activeAccountId ?? ""),
    ).resolves.toEqual({
      intent: fixture.intent,
    });
    expect(messages).toEqual([
      { type: "wallet.multisigs" },
      {
        calls: [{ calldata: ["0x1"], contractAddress: "0xdef", entrypoint: "transfer" }],
        multisigId: fixture.record.id,
        summary: "Send funds",
        type: "wallet.prepareArgentMultisigIntent",
      },
      {
        intentId: fixture.intent.id,
        signerAccountId: fixture.status.activeAccountId,
        type: "wallet.signArgentMultisigIntent",
      },
    ]);
  });

  test("fails closed on malformed runtime responses", async () => {
    const client = createMultisigClient({ sendMessage: async () => ({ ok: true }) });
    await expect(client.loadMultisigs()).resolves.toBe("error");
    await expect(client.submitIntent("intent-id")).rejects.toThrow(
      "submit Argent multisig intent failed",
    );
  });
});
