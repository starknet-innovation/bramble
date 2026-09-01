/**
 * STRK20 retry policy for private reads. These requests never broadcast a
 * transaction, so a bounded retry can safely follow an explicit throttle.
 */

import { describe, expect, test } from "bun:test";
import { createOfficialStrk20Service } from "@bramble/privacy/official-sdk-service";
import {
  officialBuilder as builder,
  STRK20_SDK_CONTEXT as context,
  executeResult,
  providerFor,
  sdkRuntime as runtime,
  STRK20_SDK_TOKEN as token,
} from "../support/official-sdk";

const rateLimitError = (retryAfter: string): Error =>
  Object.assign(new Error("Discovery HTTP 429"), {
    response: { headers: { "retry-after": retryAfter } },
  });

describe("official STRK20 SDK read retries", () => {
  test("retries a throttled private balance read using a bounded retry hint", async () => {
    let attempts = 0;
    const pauses: (readonly [number, number | undefined])[] = [];
    const sdk = runtime(() => ({
      build: () => builder(executeResult()),
      async discoverNotes() {
        attempts += 1;
        if (attempts === 1) {
          throw rateLimitError("45");
        }
        return { notes: new Map([[BigInt(token), [{ amount: 5n }]]]) };
      },
      executeWithInvocation: async () => executeResult(),
    }));
    const service = createOfficialStrk20Service({
      pauseForServiceRetry: async (attempt, retryAfter) => {
        pauses.push([attempt, retryAfter]);
      },
      providerFor,
      sdk,
    });

    await expect(service.privateBalances({ ...context, tokens: [token] })).resolves.toEqual([
      { balance: "0x5", token },
    ]);
    expect(attempts).toBe(2);
    expect(pauses).toEqual([[1, 5_000]]);
  });

  test("reports persistent discovery throttling without service detail", async () => {
    let attempts = 0;
    const pauses: number[] = [];
    const sdk = runtime(() => ({
      build: () => builder(executeResult()),
      async discoverNotes() {
        attempts += 1;
        throw rateLimitError("1");
      },
      executeWithInvocation: async () => executeResult(),
    }));
    const service = createOfficialStrk20Service({
      pauseForServiceRetry: async (attempt) => {
        pauses.push(attempt);
      },
      providerFor,
      sdk,
    });

    await expect(service.privateBalances({ ...context, tokens: [token] })).rejects.toThrow(
      "strk20 services unavailable (rate limited; retry shortly)",
    );
    expect(attempts).toBe(3);
    expect(pauses).toEqual([1, 2]);
  });

  test("retries a throttled pool-fee read before returning a reviewed value", async () => {
    let attempts = 0;
    const pauses: (readonly [number, number | undefined])[] = [];
    const throttledProviderFor = () =>
      ({
        ...providerFor(),
        async callContract() {
          attempts += 1;
          if (attempts === 1) {
            throw rateLimitError("2");
          }
          return ["0x7"];
        },
      }) as unknown as ReturnType<typeof providerFor>;
    const service = createOfficialStrk20Service({
      pauseForServiceRetry: async (attempt, retryAfter) => {
        pauses.push([attempt, retryAfter]);
      },
      providerFor: throttledProviderFor,
      sdk: runtime(() => ({
        build: () => builder(executeResult()),
        discoverNotes: async () => ({ notes: new Map() }),
        executeWithInvocation: async () => executeResult(),
      })),
    });
    const poolFee = service.poolFee;
    if (!poolFee) {
      throw new Error("official STRK20 service must expose a pool-fee reader");
    }

    await expect(poolFee({ ...context })).resolves.toBe("0x7");
    expect(attempts).toBe(2);
    expect(pauses).toEqual([[1, 2_000]]);
  });

  test("retries a throttled subaccount discovery before deriving its commitment", async () => {
    let attempts = 0;
    const pauses: (readonly [number, number | undefined])[] = [];
    const sdk = runtime(() => ({
      build: () => builder(executeResult()),
      async discoverNotes() {
        attempts += 1;
        if (attempts === 1) {
          throw rateLimitError("2");
        }
        return { notes: new Map() };
      },
      executeWithInvocation: async () => executeResult(),
    }));
    const service = createOfficialStrk20Service({
      pauseForServiceRetry: async (attempt, retryAfter) => {
        pauses.push([attempt, retryAfter]);
      },
      providerFor,
      sdk,
    });

    await expect(service.subaccountCommitment({ ...context, dappName: "vesu" })).resolves.toBe(
      "0x456",
    );
    expect(attempts).toBe(2);
    expect(pauses).toEqual([[1, 2_000]]);
  });
});
