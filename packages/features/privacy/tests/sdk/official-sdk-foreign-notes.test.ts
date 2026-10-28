/**
 * Notes other accounts place in a victim's subchannels (Sherlock #162).
 *
 * The pool lets any registered account open a channel to any other, open
 * subchannels under made-up token felts, and create zero-amount notes there
 * with no deposit. Those notes can never be spent or removed, so they must not
 * fail a read or a spend of the tokens the wallet asked for: the wallet sums
 * only the requested tokens and counts only nonzero notes against the cap.
 */
import { describe, expect, test } from "bun:test";
import { createOfficialStrk20Service } from "@bramble/privacy/official-sdk-service";
import {
  prepareStrk20CallAndProof,
  quoteStrk20Actions,
  readStrk20Balances,
} from "@bramble/privacy/service";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import {
  officialBuilder as builder,
  STRK20_SDK_CONTEXT as context,
  executeResult,
  providerFor,
  sdkRuntime as runtime,
  STRK20_SDK_TOKEN,
} from "../support/official-sdk";

type Notes = Map<bigint, readonly { readonly amount: bigint }[]>;

const STRK = BigInt(STRK_TOKEN_ADDRESS);
const strk = `0x${STRK.toString(16)}`;
const REAL = 100n * 10n ** 18n;
const UNAVAILABLE = "strk20 services unavailable";
const withdraw: readonly Strk20Action[] = [
  { amount: "0x1", recipient: "0xbeef", token: strk, type: "withdraw" },
];

const serviceWith = (notes: Notes) => {
  let builds = 0;
  const service = createOfficialStrk20Service({
    pauseForServiceRetry: async () => undefined,
    providerFor,
    sdk: runtime(() => ({
      build: () => {
        builds += 1;
        return builder();
      },
      discoverNotes: async () => ({ notes }),
      executeWithInvocation: async () => executeResult(),
    })),
  });
  return { builds: () => builds, service };
};

// The victim's real STRK note plus one zero-amount note under each of `count`
// made-up token felts.
const madeUpTokens = (count: number): Notes => {
  const notes: Notes = new Map([[STRK, [{ amount: REAL }]]]);
  for (let index = 1; index <= count; index += 1) {
    notes.set(0x1000n + BigInt(index), [{ amount: 0n }]);
  }
  return notes;
};

const realBalance = [{ balance: `0x${REAL.toString(16)}`, token: strk }];

describe("notes other accounts place in made-up tokens", () => {
  test("do not fail a read of the requested token", async () => {
    const { service } = serviceWith(madeUpTokens(200));
    await expect(readStrk20Balances(service, { ...context, tokens: [strk] })).resolves.toEqual(
      realBalance,
    );
  });

  test("do not stop a proof for a spend of the requested token", async () => {
    const { builds, service } = serviceWith(madeUpTokens(200));
    await prepareStrk20CallAndProof(service, { ...context, actions: withdraw, simulate: false });
    expect(builds()).toBeGreaterThan(0);
  });

  test("do not stop a quote for an unshield or private send at the balance check", async () => {
    // The context has no relay, so the quote stops at the next check instead.
    const { service } = serviceWith(madeUpTokens(200));
    await expect(quoteStrk20Actions(service, { ...context, actions: withdraw })).rejects.toThrow(
      "no private relay is configured",
    );
  });

  test("are not listed when every balance is requested", async () => {
    const { service } = serviceWith(madeUpTokens(200));
    await expect(service.privateBalances({ ...context, tokens: [] })).resolves.toEqual(realBalance);
  });

  test("with nonzero amounts do not count against the requested token's note cap", async () => {
    const notes = madeUpTokens(0);
    notes.set(
      0x2000n,
      Array.from({ length: 4_097 }, () => ({ amount: 1n })),
    );
    const { service } = serviceWith(notes);
    await expect(service.privateBalances({ ...context, tokens: [strk] })).resolves.toEqual(
      realBalance,
    );
  });

  test("with malformed amounts do not fail a read of another token", async () => {
    const notes = madeUpTokens(0);
    notes.set(0x2000n, [{ amount: -1n }]);
    const { service } = serviceWith(notes);
    await expect(service.privateBalances({ ...context, tokens: [strk] })).resolves.toEqual(
      realBalance,
    );
  });
});

describe("zero-amount notes in the requested token", () => {
  test("do not count against the note cap", async () => {
    const notes: Notes = new Map([
      [STRK, [{ amount: REAL }, ...Array.from({ length: 10_000 }, () => ({ amount: 0n }))]],
    ]);
    const { service } = serviceWith(notes);
    await expect(service.privateBalances({ ...context, tokens: [strk] })).resolves.toEqual(
      realBalance,
    );
  });

  test("leave nonzero notes under the cap, and over it the read still fails", async () => {
    const atCap: Notes = new Map([[STRK, Array.from({ length: 4_096 }, () => ({ amount: 1n }))]]);
    await expect(
      serviceWith(atCap).service.privateBalances({ ...context, tokens: [strk] }),
    ).resolves.toEqual([{ balance: "0x1000", token: strk }]);
    const overCap: Notes = new Map([[STRK, [...(atCap.get(STRK) ?? []), { amount: 1n }]]]);
    await expect(
      serviceWith(overCap).service.privateBalances({ ...context, tokens: [strk] }),
    ).rejects.toThrow(UNAVAILABLE);
  });

  test("apply the cap to each requested token on its own", async () => {
    const other = BigInt(STRK20_SDK_TOKEN);
    const full = Array.from({ length: 4_096 }, () => ({ amount: 1n }));
    const notes: Notes = new Map([
      [STRK, full],
      [other, full],
    ]);
    await expect(
      serviceWith(notes).service.privateBalances({ ...context, tokens: [strk, STRK20_SDK_TOKEN] }),
    ).resolves.toEqual([
      { balance: "0x1000", token: strk },
      { balance: "0x1000", token: STRK20_SDK_TOKEN },
    ]);
  });

  test("still fail a read when a requested amount is malformed", async () => {
    const notes: Notes = new Map([[STRK, [{ amount: REAL }, { amount: -1n }]]]);
    await expect(
      serviceWith(notes).service.privateBalances({ ...context, tokens: [strk] }),
    ).rejects.toThrow(UNAVAILABLE);
  });
});
