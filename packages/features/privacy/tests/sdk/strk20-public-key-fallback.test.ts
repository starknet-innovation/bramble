/**
 * The pool public-key read walks every configured endpoint. Fee reads stay on
 * the first one. A rate limit with a numeric JSON-RPC code is not a transport
 * error, and still has to fail over once the same-node retry is exhausted.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import { readStrk20PoolFee, readStrk20PublicKey } from "@bramble/privacy/official-sdk-values";
import type { RpcProvider } from "starknet";

const POOL = "0x123";
const ADDRESS = "0xabc";
const pause = async (): Promise<void> => undefined;

// Each case uses its own hosts. A failed read cools that endpoint down for
// later calls, and these tests share one process.
const endpoints = (name: string): readonly [string, string] => [
  `https://${name}-a.example`,
  `https://${name}-b.example`,
];

const providerFor =
  (calls: Map<string, () => Promise<readonly string[]>>) =>
  (nodeUrl: string): RpcProvider =>
    ({
      async callContract() {
        const answer = calls.get(nodeUrl);
        if (!answer) throw new Error(`unexpected endpoint ${nodeUrl}`);
        return answer();
      },
    }) as unknown as RpcProvider;

const rateLimited = (): Error =>
  Object.assign(new Error("rate limit exceeded"), { baseError: { code: -32_005 } });

const pair = (
  name: string,
  first: () => Promise<readonly string[]>,
  second: () => Promise<readonly string[]>,
): {
  readonly seen: string[];
  readonly urls: readonly [string, string];
  readonly calls: Map<string, () => Promise<readonly string[]>>;
} => {
  const [left, right] = endpoints(name);
  const seen: string[] = [];
  return {
    calls: new Map([
      [
        left,
        async () => {
          seen.push(left);
          return first();
        },
      ],
      [
        right,
        async () => {
          seen.push(right);
          return second();
        },
      ],
    ]),
    seen,
    urls: [left, right],
  };
};

describe("readStrk20PublicKey", () => {
  test("fails over a numeric rate limit and a transport error onto the next endpoint", async () => {
    const { calls, seen, urls } = pair(
      "rate",
      async () => {
        throw rateLimited();
      },
      async () => ["0x2"],
    );
    await expect(readStrk20PublicKey(providerFor(calls), urls, POOL, ADDRESS, pause)).resolves.toBe(
      "0x2",
    );
    // Three same-node retries, then the next endpoint.
    expect(seen).toEqual([urls[0], urls[0], urls[0], urls[1]]);
  });

  test("fails over a node that does not answer", async () => {
    const { calls, seen, urls } = pair(
      "down",
      async () => {
        throw new Error("Failed to fetch");
      },
      async () => ["0x10"],
    );
    await expect(readStrk20PublicKey(providerFor(calls), urls, POOL, ADDRESS, pause)).resolves.toBe(
      "0x10",
    );
    expect(seen).toEqual([...urls]);
  });

  test("does not fail over a semantic contract error", async () => {
    const { calls, seen, urls } = pair(
      "semantic",
      async () => {
        throw Object.assign(new Error("proof rejected"), { baseError: { code: 63 } });
      },
      async () => ["0x2"],
    );
    await expect(
      readStrk20PublicKey(providerFor(calls), urls, POOL, ADDRESS, pause),
    ).rejects.toThrow("could not read pool registration");
    expect(seen).toEqual([urls[0]]);
  });

  test("does not fail over a WalletError from the read", async () => {
    const { calls, seen, urls } = pair(
      "wallet",
      async () => {
        throw new WalletError("pool refused");
      },
      async () => ["0x2"],
    );
    await expect(
      readStrk20PublicKey(providerFor(calls), urls, POOL, ADDRESS, pause),
    ).rejects.toThrow("could not read pool registration");
    expect(seen).toEqual([urls[0]]);
  });
});

describe("readStrk20PoolFee", () => {
  test("stays on the first endpoint when that endpoint does not answer", async () => {
    const { calls, seen, urls } = pair(
      "fee",
      async () => {
        throw new Error("Failed to fetch");
      },
      async () => ["0x1"],
    );
    await expect(readStrk20PoolFee(providerFor(calls), urls, POOL, pause)).rejects.toThrow(
      "could not read the pool fee",
    );
    expect(seen).toEqual([urls[0]]);
  });
});
