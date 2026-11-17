/**
 * The side panel's deployment client (issue 431). The sponsorship offer is advisory
 * and never throws: anything but a well-formed answer reads as "none", so the
 * screen keeps the user's own fee. A sponsored deploy returns the hash, null
 * when the sponsor is not deploying it, and a refusal or lost reply rejects
 * with the background's own sentence.
 */
import { describe, expect, test } from "bun:test";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import { createDeployRuntimeClient } from "../../../src/sidepanel/runtime/runtime-deploy";

const client = (reply: () => Promise<unknown>) => {
  const sent: unknown[] = [];
  return {
    deploy: createDeployRuntimeClient(async (message) => {
      sent.push(message);
      return reply();
    }),
    sent,
  };
};

describe("deploy sponsorship offer", () => {
  test("reads the background's answer", async () => {
    for (const sponsorship of ["available", "held", "none"] as const) {
      const { deploy, sent } = client(async () => ({ ok: true, sponsorship }));
      expect(await deploy.deploySponsorship()).toBe(sponsorship);
      expect(sent).toEqual([{ type: "wallet.deploySponsorship" }]);
    }
  });

  test("reads anything else as nothing offered, and never throws", async () => {
    const replies = [
      async () => ({ ok: true, sponsorship: "free" }),
      async () => ({ ok: true, sponsorship: "may-land" }),
      async () => ({ ok: true, sponsorship: "refused" }),
      async () => ({ sponsorship: "available" }),
      async () => ({ error: "wallet locked" }),
      async () => null,
      async () => {
        throw new Error("lost");
      },
    ];
    for (const reply of replies) {
      expect(await client(reply).deploy.deploySponsorship()).toBe("none");
    }
  });
});

describe("sponsored deploy request", () => {
  test("returns the transaction hash", async () => {
    const { deploy, sent } = client(async () => ({ ok: true, transactionHash: "0x5ab" }));
    expect(await deploy.deployAccountSponsored()).toBe("0x5ab");
    expect(sent).toEqual([{ type: "wallet.deployAccountSponsored" }]);
  });

  test("answers null when the sponsor is not deploying it and nothing was sent", async () => {
    expect(
      await client(async () => ({ ok: true, sponsored: false })).deploy.deployAccountSponsored(),
    ).toBeNull();
    for (const reply of [
      { ok: true, sponsored: true },
      { ok: false, sponsored: false },
      { extra: 1, ok: true, sponsored: false },
    ]) {
      await expect(client(async () => reply).deploy.deployAccountSponsored()).rejects.toThrow();
    }
  });

  test("rejects with the refusal, and a lost reply as outcome-unknown", async () => {
    await expect(
      client(async () => ({ error: "account already deployed" })).deploy.deployAccountSponsored(),
    ).rejects.toThrow("account already deployed");
    await expect(
      client(async () => ({
        error: "status unknown",
        submissionUnknown: true,
      })).deploy.deployAccountSponsored(),
    ).rejects.toBeInstanceOf(SubmissionUnknownError);
  });
});
