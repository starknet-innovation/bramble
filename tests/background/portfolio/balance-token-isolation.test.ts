/**
 * Sherlock #134: a tracked token whose `balanceOf` reverts (for example one a
 * dapp added through `wallet_watchAsset`) must not freeze the portfolio. The
 * account and multisig balance messages still return fresh balances for every
 * other token, keep the failing token's last known value, and a fresh account
 * with no snapshot gets balances instead of an error.
 */
import { describe, expect, test } from "bun:test";
import { getTokenBalances, type TokenBalance } from "@bramble/starknet/rpc";
import { DEFAULT_TOKENS, sameFelt } from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";
import {
  HARNESS_MULTISIG_ID,
  harnessContentSender,
  harnessExtensionSender,
  makeMultisigHarness,
} from "../../support/multisig-harness";

const BAD = "0xbadc0ffee";
const mainnetDefaults = DEFAULT_TOKENS.filter((token) => token.networkId === "SN_MAIN");

type Chain = {
  readonly amounts: Map<string, bigint>;
  revert: boolean;
};

// The real RPC reader over a fake node: the bad token reverts like a contract
// error from a node that answered (numeric JSON-RPC code), everything else
// returns the amount set for it.
const chainReader = (chain: Chain) => (input: Parameters<typeof getTokenBalances>[0]) =>
  getTokenBalances(
    input,
    () =>
      ({
        callContract: async (call: { readonly contractAddress: string }) => {
          if (sameFelt(call.contractAddress, BAD) && chain.revert) {
            throw Object.assign(new Error("Contract error"), { baseError: { code: 40 } });
          }
          const amount = [...chain.amounts].find(([address]) =>
            sameFelt(address, call.contractAddress),
          )?.[1];
          return [`0x${(amount ?? 0n).toString(16)}`, "0x0"];
        },
      }) as unknown as RpcProvider,
  );

const setup = async () => {
  const chain: Chain = { amounts: new Map(), revert: false };
  let now = 1_000_000;
  const harness = await makeMultisigHarness({
    getTokenBalances: chainReader(chain),
    now: () => now,
  });
  await harness.preferencesStore.upsertToken(
    {
      address: BAD,
      decimals: 0,
      name: "Prize Token",
      networkId: "SN_MAIN",
      symbol: "PRZ",
    },
    "dapp",
  );
  return {
    advance: (ms: number) => {
      now += ms;
    },
    chain,
    harness,
    now: () => now,
  };
};

type BalancesResponse = {
  readonly asOf: number | null;
  readonly balances: readonly TokenBalance[];
  readonly ok: true;
  readonly stale: boolean;
};

const balanceOf = (response: BalancesResponse, address: string): string | undefined =>
  response.balances.find((balance) => sameFelt(balance.address, address))?.balance;

const cases = [
  ["wallet.getBalances", {}],
  ["wallet.multisigBalances", { multisigId: HARNESS_MULTISIG_ID }],
] as const;

describe("balance reads with a reverting tracked token (Sherlock audit 134)", () => {
  for (const [type, extra] of cases) {
    test(`${type} returns fresh balances on a first read with no snapshot`, async () => {
      const { chain, harness, now } = await setup();
      chain.revert = true;
      for (const token of mainnetDefaults) chain.amounts.set(token.address, 7n);
      const response = (await harness.handler(
        { ...extra, refresh: true, type },
        harnessExtensionSender,
      )) as BalancesResponse;
      expect(response.ok).toBe(true);
      expect(response.stale).toBe(false);
      expect(response.asOf).toBe(now());
      for (const token of mainnetDefaults) {
        expect(balanceOf(response, token.address)).toBe("7");
      }
      expect(balanceOf(response, BAD)).toBeUndefined();
    });

    test(`${type} keeps refreshing and carries the failing token's last value`, async () => {
      const { advance, chain, harness, now } = await setup();
      for (const token of mainnetDefaults) chain.amounts.set(token.address, 1n);
      chain.amounts.set(BAD, 5n);
      const first = (await harness.handler(
        { ...extra, refresh: true, type },
        harnessExtensionSender,
      )) as BalancesResponse;
      expect(balanceOf(first, BAD)).toBe("5");

      chain.revert = true;
      for (const token of mainnetDefaults) chain.amounts.set(token.address, 2n);
      advance(5_000);
      const second = (await harness.handler(
        { ...extra, refresh: true, type },
        harnessExtensionSender,
      )) as BalancesResponse;
      expect(second.stale).toBe(false);
      expect(second.asOf).toBe(now());
      expect(second.asOf).toBeGreaterThan(first.asOf ?? 0);
      for (const token of mainnetDefaults) {
        expect(balanceOf(second, token.address)).toBe("2");
      }
      expect(balanceOf(second, BAD)).toBe("5");
    });
  }
});

describe("wallet.removeToken recovery (Sherlock audit 134)", () => {
  test("removes a dapp-added token so later refreshes no longer read it", async () => {
    const { chain, harness } = await setup();
    chain.revert = true;
    const tokenId = (await harness.preferencesStore.read()).tokens.find((token) =>
      sameFelt(token.address, BAD),
    )?.id;
    const removed = await harness.handler(
      { tokenId, type: "wallet.removeToken" },
      harnessExtensionSender,
    );
    expect(removed).toMatchObject({ ok: true });
    const tracked = (await harness.preferencesStore.read()).tokens;
    expect(tracked.some((token) => sameFelt(token.address, BAD))).toBe(false);

    const response = (await harness.handler(
      { refresh: true, type: "wallet.getBalances" },
      harnessExtensionSender,
    )) as BalancesResponse;
    expect(response.stale).toBe(false);
    expect(response.balances.map((balance) => balance.symbol).sort()).toEqual(["ETH", "STRK"]);
  });

  test("refuses a built-in token and keeps it tracked", async () => {
    const { harness } = await setup();
    const eth = (await harness.preferencesStore.read()).tokens.find(
      (token) => token.networkId === "SN_MAIN" && token.symbol === "ETH",
    );
    await expect(
      harness.handler({ tokenId: eth?.id, type: "wallet.removeToken" }, harnessExtensionSender),
    ).resolves.toEqual({ error: "Built-in tokens can't be removed" });
    expect(
      (await harness.preferencesStore.read()).tokens.some((token) => token.id === eth?.id),
    ).toBe(true);
  });

  test("refuses the request from a web page", async () => {
    const { harness } = await setup();
    const response = await harness.handler(
      { tokenId: "SN_MAIN:PRZ:0x1", type: "wallet.removeToken" },
      harnessContentSender,
    );
    expect(response).toHaveProperty("error");
  });
});
