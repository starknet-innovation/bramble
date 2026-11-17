/**
 * Historical state checks keep newly deployed accounts and recently funded
 * ERC20 balances behind the privacy proof base.
 */

import { describe, expect, test } from "bun:test";
import {
  areHistoricalDepositsReady,
  isHistoricalAccountReady,
} from "@bramble/privacy/official-sdk-readiness";
import type { RpcProvider } from "starknet";

describe("STRK20 historical state readiness", () => {
  test("checks account deployment at the exact proving block", async () => {
    const seen: unknown[] = [];
    const ready = {
      async getClassHashAt(address: string, block: number) {
        seen.push([address, block]);
        return "0x123";
      },
    } as unknown as RpcProvider;
    const missing = {
      async getClassHashAt() {
        throw new Error("contract not found");
      },
    } as unknown as RpcProvider;

    await expect(isHistoricalAccountReady(ready, "0xabc", 42)).resolves.toBe(true);
    await expect(isHistoricalAccountReady(missing, "0xabc", 42)).resolves.toBe(false);
    expect(seen).toEqual([["0xabc", 42]]);
  });

  test("aggregates each deposit and requires its balance at the proving block", async () => {
    const calls: unknown[] = [];
    const provider = {
      async callContract(call: unknown, block: number) {
        calls.push([call, block]);
        return ["0x0", "0x1"];
      },
    } as unknown as RpcProvider;
    const amount = `0x${(1n << 127n).toString(16)}`;

    await expect(
      areHistoricalDepositsReady(
        provider,
        "0xabc",
        [
          { amount, token: "0x123", type: "deposit" },
          { amount, token: "0x123", type: "deposit" },
        ],
        42,
      ),
    ).resolves.toBe(true);
    expect(calls).toEqual([
      [
        {
          calldata: ["0xabc"],
          contractAddress: "0x123",
          entrypoint: "balanceOf",
        },
        42,
      ],
    ]);
  });

  test("aggregates numerically equivalent token aliases before checking the balance", async () => {
    const calls: unknown[] = [];
    const provider = {
      async callContract(call: unknown, block: number) {
        calls.push([call, block]);
        return ["0x6", "0x0"];
      },
    } as unknown as RpcProvider;

    await expect(
      areHistoricalDepositsReady(
        provider,
        "0xabc",
        [
          { amount: "0x6", token: "0x123", type: "deposit" },
          { amount: "0x6", token: "0x0123", type: "deposit" },
        ],
        42,
      ),
    ).resolves.toBe(false);
    expect(calls).toEqual([
      [
        {
          calldata: ["0xabc"],
          contractAddress: "0x123",
          entrypoint: "balanceOf",
        },
        42,
      ],
    ]);
  });

  test("fails closed on insufficient or malformed historical balances", async () => {
    const action = [{ amount: "0x2", token: "0x123", type: "deposit" as const }];
    const providerWith = (response: readonly string[]) =>
      ({
        async callContract() {
          return response;
        },
      }) as unknown as RpcProvider;

    await expect(
      areHistoricalDepositsReady(providerWith(["0x1", "0x0"]), "0xabc", action, 42),
    ).resolves.toBe(false);
    await expect(
      areHistoricalDepositsReady(
        providerWith(["0x1", "0x100000000000000000000000000000000"]),
        "0xabc",
        action,
        42,
      ),
    ).resolves.toBe(false);
    await expect(
      areHistoricalDepositsReady(
        {
          async callContract() {
            throw new Error("RPC unavailable");
          },
        } as unknown as RpcProvider,
        "0xabc",
        action,
        42,
      ),
    ).resolves.toBe(false);
  });
});
