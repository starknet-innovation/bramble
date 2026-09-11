/**
 * The panel's half of a tracked background job.
 *
 * Reported from a registered mainnet wallet: "Build private proof" never
 * resolved, and the panel later logged "the message channel closed before a
 * response was received" — the proof had been riding one request the worker
 * did not survive. The client now starts a job and polls; these pin that the
 * poll follows the id it was given, that every way the wait can end settles the
 * caller's promise with a reason, that a direct reply is still accepted, that
 * the activation and the execution ride the same poll, and that the progress a
 * poll carries reaches the working screen only after it has been validated
 * against the fixed phase vocabulary.
 */
import { describe, expect, test } from "bun:test";
import {
  PREPARATION_CHANNEL_LOST,
  PREPARATION_POLL_MS,
  type PreparationProgress,
  preparationProgressText,
} from "../../../../src/sidepanel/journeys/privacy/privacy-preparation-job";
import { createPrivacyRuntimeClient } from "../../../../src/sidepanel/journeys/privacy/privacy-runtime";

const digest = `sha256:${"a".repeat(64)}`;
const RECIPIENT = "0xabc";
const JOB_ID = "strk20job-1a2b3c-7";
const preparation = {
  amount: "1.25",
  id: digest,
  kind: "deposit" as const,
  networkFee: { overallFee: "1", unit: "FRI" } as const,
  payloadDigest: digest,
  poolAddress: "0x123",
  poolFeeFri: "0x1",
  recipient: RECIPIENT,
  route: "public-account" as const,
  summaries: ["Shield 1.25 ETH"],
  symbol: "ETH",
  tokenId: "SN_MAIN:ETH:0x456",
};
const registration = {
  id: digest,
  kind: "register" as const,
  networkFee: { overallFee: "1", unit: "FRI" } as const,
  payloadDigest: digest,
  poolAddress: "0x123",
  poolFeeFri: "0x1",
  route: "public-account" as const,
  summaries: ["Register private balances"],
  symbol: "ETH",
  tokenId: "SN_MAIN:ETH:0x456",
};
const running = (extra: Record<string, unknown> = {}) => ({
  ok: true,
  strk20Job: { elapsedMs: 0, id: JOB_ID, state: "running", ...extra },
});

const client = (
  replies: readonly (unknown | Error)[],
  pauses: number[] = [],
  progress: PreparationProgress[] = [],
) => {
  const seen: unknown[] = [];
  const queue = [...replies];
  return {
    client: createPrivacyRuntimeClient(
      async (message) => {
        seen.push(message);
        const next = queue.shift();
        if (next instanceof Error) throw next;
        return next;
      },
      {
        pause: async (ms) => {
          pauses.push(ms);
        },
      },
    ),
    onProgress: (value: PreparationProgress) => {
      progress.push(value);
    },
    seen,
  };
};

describe("shield preparation job", () => {
  test("polls the job it was given until the review lands", async () => {
    const pauses: number[] = [];
    const { client: wallet, seen } = client(
      [running(), running(), running(), { ok: true, strk20Preparation: preparation }],
      pauses,
    );

    await expect(
      wallet.preparePrivacyDeposit(preparation.tokenId, "1.25", RECIPIENT),
    ).resolves.toEqual(preparation);
    expect(seen).toEqual([
      {
        amount: "1.25",
        recipient: RECIPIENT,
        tokenId: preparation.tokenId,
        type: "wallet.strk20PrepareDeposit",
      },
      { jobId: JOB_ID, type: "wallet.strk20PreparationStatus" },
      { jobId: JOB_ID, type: "wallet.strk20PreparationStatus" },
      { jobId: JOB_ID, type: "wallet.strk20PreparationStatus" },
    ]);
    // One pause before every poll, at the panel's cadence, never before the start.
    expect(pauses).toEqual([PREPARATION_POLL_MS, PREPARATION_POLL_MS, PREPARATION_POLL_MS]);
  });

  test("hands every running poll's validated progress to the working screen", async () => {
    const progress: PreparationProgress[] = [];
    const { client: wallet, onProgress } = client(
      [
        running(),
        running({ elapsedMs: 1_500, phase: "checking registration" }),
        running({ attempt: 2, attempts: 3, elapsedMs: 64_000, phase: "proving" }),
        { ok: true, strk20Preparation: preparation },
      ],
      [],
      progress,
    );

    await expect(
      wallet.preparePrivacyDeposit(preparation.tokenId, "1.25", RECIPIENT, onProgress),
    ).resolves.toEqual(preparation);
    expect(progress).toEqual([
      { elapsedMs: 0 },
      { elapsedMs: 1_500, phase: "checking registration" },
      { attempt: 2, attempts: 3, elapsedMs: 64_000, phase: "proving" },
    ]);
    expect(progress.map(preparationProgressText)).toEqual([
      "Starting · 0 s",
      "Checking registration · 1 s",
      "Proving (attempt 2 of 3) · 1 min 4 s",
    ]);
  });

  test("settles on the job's own refusal with its reason", async () => {
    const { client: wallet } = client([
      running(),
      { error: "Not enough STRK for the amount and pool fee" },
    ]);
    await expect(
      wallet.preparePrivacyDeposit(preparation.tokenId, "1.25", RECIPIENT),
    ).rejects.toThrow("Not enough STRK for the amount and pool fee");
  });

  test("settles on the background's interruption reason after a worker restart", async () => {
    const interrupted =
      "The private operation was interrupted because the wallet's background worker stopped. Try again.";
    const { client: wallet } = client([running(), running(), { error: interrupted }]);
    await expect(
      wallet.preparePrivacyDeposit(preparation.tokenId, "1.25", RECIPIENT),
    ).rejects.toThrow(interrupted);
  });

  test("settles with a named reason when the channel itself fails", async () => {
    const channel = new Error(
      "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received",
    );
    const midPoll = client([running(), running(), channel]);
    await expect(
      midPoll.client.preparePrivacyDeposit(preparation.tokenId, "1.25", RECIPIENT),
    ).rejects.toThrow(PREPARATION_CHANNEL_LOST);

    const atStart = client([channel]);
    await expect(
      atStart.client.preparePrivacyDeposit(preparation.tokenId, "1.25", RECIPIENT),
    ).rejects.toThrow(PREPARATION_CHANNEL_LOST);
  });

  test("treats a refusal at the gate and a malformed job as the reply's own failure", async () => {
    const { client: refused, seen } = client([{ error: "Enter a valid Starknet address" }]);
    await expect(
      refused.preparePrivacyDeposit(preparation.tokenId, "1.25", RECIPIENT),
    ).rejects.toThrow("Enter a valid Starknet address");
    expect(seen).toHaveLength(1);

    for (const malformed of [
      { ok: true, strk20Job: { elapsedMs: 0, id: "job-1", state: "running" } },
      { ok: true, strk20Job: { elapsedMs: 0, id: JOB_ID, state: "done" } },
      { ok: true, strk20Job: { id: JOB_ID, state: "running" } },
      { ok: true, strk20Job: { elapsedMs: -1, id: JOB_ID, state: "running" } },
      { ok: true, strk20Job: { elapsedMs: 0, id: JOB_ID, state: "running", extra: true } },
      { ok: true, strk20Job: JOB_ID },
      // Progress outside the fixed vocabulary or its bounds is not progress:
      // a phase the panel does not know, an attempt without its total, a round
      // past its total, an attempt count no bounded retry could reach.
      running({ phase: "reading note 0xabc" }),
      running({ attempt: 2, phase: "proving" }),
      running({ attempt: 4, attempts: 3, phase: "proving" }),
      running({ attempt: 1, attempts: 99, phase: "proving" }),
    ]) {
      const progress: PreparationProgress[] = [];
      const { client: wallet, onProgress, seen: polls } = client([malformed], [], progress);
      await expect(
        wallet.preparePrivacyDeposit(preparation.tokenId, "1.25", RECIPIENT, onProgress),
      ).rejects.toThrow("Shielding preparation failed");
      expect(polls).toHaveLength(1);
      expect(progress).toEqual([]);
    }
  });

  test("still accepts a review answered on the request itself", async () => {
    const { client: wallet, seen } = client([{ ok: true, strk20Preparation: preparation }]);
    await expect(
      wallet.preparePrivacyDeposit(preparation.tokenId, "1.25", RECIPIENT),
    ).resolves.toEqual(preparation);
    expect(seen).toHaveLength(1);
  });
});

describe("activation preparation job", () => {
  test("polls the registration proof the same way and settles on its review", async () => {
    const progress: PreparationProgress[] = [];
    const {
      client: wallet,
      onProgress,
      seen,
    } = client(
      [
        running(),
        running({ elapsedMs: 3_000, phase: "waiting for pool maturity" }),
        { ok: true, strk20Preparation: registration },
      ],
      [],
      progress,
    );
    await expect(wallet.preparePrivacyRegistration(onProgress)).resolves.toEqual(registration);
    expect(seen).toEqual([
      { type: "wallet.strk20PrepareRegistration" },
      { jobId: JOB_ID, type: "wallet.strk20PreparationStatus" },
      { jobId: JOB_ID, type: "wallet.strk20PreparationStatus" },
    ]);
    expect(progress.at(-1)).toEqual({ elapsedMs: 3_000, phase: "waiting for pool maturity" });
  });

  test("settles on the job's refusal and on a lost channel", async () => {
    const refused = client([running(), { error: "Private balances are already active" }]);
    await expect(refused.client.preparePrivacyRegistration()).rejects.toThrow(
      "Private balances are already active",
    );
    const lost = client([running(), new Error("channel closed")]);
    await expect(lost.client.preparePrivacyRegistration()).rejects.toThrow(
      PREPARATION_CHANNEL_LOST,
    );
  });
});

describe("execution job", () => {
  test("polls the submission and settles on its hash", async () => {
    const progress: PreparationProgress[] = [];
    const {
      client: wallet,
      onProgress,
      seen,
    } = client(
      [
        running(),
        running({ elapsedMs: 20_000, phase: "proving" }),
        running({ elapsedMs: 41_000, phase: "relaying privately" }),
        { ok: true, transactionHash: "0x789" },
      ],
      [],
      progress,
    );
    await expect(wallet.executePrivacyPreparation(digest, onProgress)).resolves.toBe("0x789");
    expect(seen).toEqual([
      { preparationId: digest, type: "wallet.strk20Execute" },
      { jobId: JOB_ID, type: "wallet.strk20PreparationStatus" },
      { jobId: JOB_ID, type: "wallet.strk20PreparationStatus" },
      { jobId: JOB_ID, type: "wallet.strk20PreparationStatus" },
    ]);
    expect(progress.map((value) => value.phase)).toEqual([
      undefined,
      "proving",
      "relaying privately",
    ]);
  });

  test("still accepts a hash answered on the request, and rejects anything else", async () => {
    const direct = client([{ ok: true, transactionHash: "0x789" }]);
    await expect(direct.client.executePrivacyPreparation(digest)).resolves.toBe("0x789");
    expect(direct.seen).toHaveLength(1);

    const refused = client([{ error: "Privacy preparation not found" }]);
    await expect(refused.client.executePrivacyPreparation(digest)).rejects.toThrow(
      "Privacy preparation not found",
    );
    const malformed = client([running(), { ok: true, transactionHash: 7 }]);
    await expect(malformed.client.executePrivacyPreparation(digest)).rejects.toThrow(
      "Private transaction failed",
    );
    const lost = client([running(), new Error("channel closed")]);
    await expect(lost.client.executePrivacyPreparation(digest)).rejects.toThrow(
      PREPARATION_CHANNEL_LOST,
    );
  });
});
