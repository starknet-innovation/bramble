/**
 * The status-unknown refusal crosses the runtime boundary as untrusted data
 * (audit #173). Only its exact shape may become a typed error the Send screen
 * acts on; anything else stays an ordinary error.
 */
import { describe, expect, test } from "bun:test";
import {
  readSubmissionUnknownError,
  SubmissionUnknownError,
  submissionUnknownResponse,
} from "@bramble/wallet-protocol/submission-unknown";

const HASH = "0x5eed";

describe("readSubmissionUnknownError", () => {
  test("accepts the exact shape, with or without a hash", () => {
    const withHash = readSubmissionUnknownError({
      error: "status unknown",
      submissionUnknown: true,
      transactionHash: HASH,
    });
    expect(withHash).toBeInstanceOf(SubmissionUnknownError);
    expect(withHash?.message).toBe("status unknown");
    expect(withHash?.transactionHash).toBe(HASH);
    expect(
      readSubmissionUnknownError({ error: "status unknown", submissionUnknown: true })
        ?.transactionHash,
    ).toBeNull();
  });

  test("rejects extra keys, a false flag, empty text, and malformed hashes", () => {
    for (const value of [
      { error: "status unknown" },
      { error: "status unknown", submissionUnknown: false },
      { error: "status unknown", submissionUnknown: "true" },
      { error: "", submissionUnknown: true },
      { error: 1, submissionUnknown: true },
      { error: "status unknown", privacyBlocker: "service", submissionUnknown: true },
      { error: "status unknown", submissionUnknown: true, transactionHash: "0x0" },
      { error: "status unknown", submissionUnknown: true, transactionHash: "0xZZ" },
      { error: "status unknown", submissionUnknown: true, transactionHash: 5 },
      null,
      "status unknown",
    ]) {
      expect(readSubmissionUnknownError(value)).toBeNull();
    }
  });

  test("round-trips the background builder and drops an invalid hash", () => {
    expect(readSubmissionUnknownError(submissionUnknownResponse("x", HASH))?.transactionHash).toBe(
      HASH,
    );
    expect(submissionUnknownResponse("x", "not-a-hash")).toEqual({
      error: "x",
      submissionUnknown: true,
    });
  });
});
