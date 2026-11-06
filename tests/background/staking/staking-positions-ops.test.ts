/**
 * "Your stakes" from the background (issue 750): read through the explorer
 * lane's Starkscan client with the active account's address and nothing
 * else, only where the user's explorer choice allows it, strictly validated,
 * and shown only where the chain confirms it.
 * Incomplete or truncated coverage, an unverifiable candidate or an untracked
 * token make the list incomplete, never "no stakes". Also: the production
 * wiring uses the explorer lane's base (starkscan.co, or the user's override)
 * and its hardened transport, and any failure leaves the paste field usable.
 * Fixtures are schema-derived, not live.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { MAX_CHECKED_POSITIONS } from "@bramble/transactions/staking-positions";
import { createStarkscanClient, type StarkscanHttp } from "@bramble/transactions/starkscan";
import { canonicalAddress, canonicalFelt } from "@bramble/wallet-model/networks";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { createDefaultRuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  position,
  positionsView,
} from "../../../packages/features/transactions/tests/support/staking-positions-fixture";
import { testExtension } from "../../support/background-wallet-stub";
import {
  invokeAccount,
  invokeExtensionSender,
  invokeVaultPassphrase,
  invokeWalletStub,
} from "../../support/invoke-approval-harness";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";
import {
  makeStakingChain,
  offStakingNetworks,
  STAKER,
  type StakingChainState,
  stakingReader,
  testStakingNetworks,
} from "../../support/staking-chain";

const BASE = "https://starkscan.test/v1";
const ROUTE = `${BASE}/SN_MAIN/staking/address/`;
const ACCOUNT = canonicalAddress(invokeAccount.address) ?? "";
const UNREADABLE = { error: "Couldn't load your stakes." };
const POSITIONS = { type: "wallet.stakingPositions" } as const;

type Reply = { readonly body: unknown; readonly status?: number } | Error;

const harness = async (
  options: {
    readonly chain?: StakingChainState;
    readonly enabled?: boolean;
    readonly explorer?: { readonly enabled: boolean } | { readonly rpcOverride: string };
    readonly reply?: Reply;
    readonly starkscan?: boolean;
  } = {},
) => {
  const requests: { readonly init: RequestInit; readonly url: string }[] = [];
  const reply = options.reply ?? { body: positionsView(ACCOUNT, [position(ACCOUNT, STAKER)]) };
  const http: StarkscanHttp = async (url, init) => {
    requests.push({ init, url });
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  };
  const chain = options.chain ?? makeStakingChain();
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  const explorer = options.explorer;
  if (explorer && "enabled" in explorer) {
    await preferencesStore.setExplorerFallback({ enabled: explorer.enabled, networkId: "SN_MAIN" });
  }
  if (explorer && "rpcOverride" in explorer) {
    await preferencesStore.setRpcOverride({ networkId: "SN_MAIN", rpcUrl: explorer.rpcOverride });
  }
  const session = createUnlockSession();
  session.unlock(invokeVaultPassphrase);
  const handler = createMessageHandler(invokeWalletStub([invokeAccount]), testExtension, {
    now: () => 1_800_000_000_000,
    preferencesStore,
    runtimeRpc: makeRuntimeRpc({
      readAtPinnedBlock: stakingReader(chain),
      ...(options.starkscan === false
        ? {}
        : { starkscanFor: () => createStarkscanClient({ baseUrl: BASE, http }) }),
    }),
    session,
    stakingNetworks: options.enabled === false ? offStakingNetworks : testStakingNetworks,
  });
  const send = (message: Record<string, unknown>) => handler(message, invokeExtensionSender);
  return { chain, requests, send };
};

const member = (overrides: Partial<NonNullable<StakingChainState["member"]>> = {}) => ({
  amount: 5n * 10n ** 18n,
  rewardAddress: invokeAccount.address,
  unclaimed: 0n,
  unpoolAmount: 0n,
  unpoolTime: null,
  ...overrides,
});

const staked = (): StakingChainState => {
  const chain = makeStakingChain();
  chain.member = member({ unclaimed: 25n * 10n ** 16n });
  return chain;
};

const ready = (response: unknown) =>
  (
    response as {
      stakingPositions: { complete: boolean; rows: { staker: string }[]; state: string };
    }
  ).stakingPositions;

describe("staking positions", () => {
  test("is off, with no request, without a Starkscan client", async () => {
    const { requests, send } = await harness({ chain: staked(), starkscan: false });
    expect(await send(POSITIONS)).toEqual({ ok: true, stakingPositions: { state: "off" } });
    expect(requests).toEqual([]);
  });

  test("is off, with no request, where the user's explorer choice keeps addresses from Starkscan", async () => {
    for (const explorer of [{ enabled: false }, { rpcOverride: "https://rpc.example/v0_8" }]) {
      const { requests, send } = await harness({ chain: staked(), explorer });
      expect(await send(POSITIONS)).toEqual({ ok: true, stakingPositions: { state: "off" } });
      expect(requests).toEqual([]);
    }
    const allowed = await harness({ chain: staked(), explorer: { enabled: true } });
    expect(ready(await allowed.send(POSITIONS)).rows).toHaveLength(1);
  });

  test("is refused, with no request, while staking is switched off", async () => {
    const { requests, send } = await harness({ enabled: false });
    expect(await send(POSITIONS)).toEqual({ error: "Staking isn't available on this network." });
    expect(requests).toEqual([]);
  });

  test("sends only the active account's address through the Starkscan client, hardened and with no key", async () => {
    const { requests, send } = await harness({ chain: staked() });
    await send(POSITIONS);
    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]?.url ?? "");
    expect(`${url.origin}${url.pathname}`).toBe(`${ROUTE}${canonicalFelt(ACCOUNT)}`);
    // `limit` only bounds the history, which the wallet doesn't read.
    expect([...url.searchParams.entries()]).toEqual([["limit", "1"]]);
    expect(requests[0]?.init).toMatchObject({
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(requests[0]?.init.headers).toEqual({ accept: "application/json" });
  });

  test("shows a position only once the chain confirms it, with the chain's figures", async () => {
    const chain = staked();
    const { send } = await harness({
      chain,
      // Starkscan's own figure is ignored: the row shows the chain's 5 STRK.
      reply: { body: positionsView(ACCOUNT, [position(ACCOUNT, STAKER, { delegatedRaw: "9" })]) },
    });
    expect(await send(POSITIONS)).toMatchObject({
      ok: true,
      stakingPositions: {
        complete: true,
        rows: [{ staked: "5", staker: STAKER, symbol: "STRK", unclaimed: "0.25" }],
        state: "ready",
      },
    });
    expect(chain.reads).toContain("get_pool_member_info_v1");
  });

  test("a listed position the chain doesn't confirm is not shown as a stake", async () => {
    const { send } = await harness();
    expect(ready(await send(POSITIONS))).toEqual({ complete: true, rows: [], state: "ready" });
  });

  test("a pending unstake alone is still a position", async () => {
    const chain = makeStakingChain();
    chain.member = member({ amount: 0n, unpoolAmount: 10n ** 18n, unpoolTime: 1_900_000_000 });
    const { send } = await harness({ chain });
    expect(ready(await send(POSITIONS)).rows).toMatchObject([
      { state: "exit-pending", unpoolAmount: "1", unpoolTime: 1_900_000_000 },
    ]);
  });

  test("an unverifiable candidate is not shown and makes the list incomplete", async () => {
    const chain = staked();
    chain.poolStaker = "0x999";
    const { send } = await harness({ chain });
    expect(ready(await send(POSITIONS))).toEqual({ complete: false, rows: [], state: "ready" });
    const other = await harness({
      chain: staked(),
      reply: { body: positionsView(ACCOUNT, [position(ACCOUNT, "0x777")]) },
    });
    expect(ready(await other.send(POSITIONS))).toEqual({
      complete: false,
      rows: [],
      state: "ready",
    });
  });

  test("incomplete coverage or a truncated list is incomplete, never 'no stakes'", async () => {
    for (const overrides of [
      {
        coverage: { ...(positionsView(ACCOUNT, [])["coverage"] as object), status: "catching_up" },
      },
      {
        coverage: { ...(positionsView(ACCOUNT, [])["coverage"] as object), status: "unavailable" },
      },
      { positionsTruncated: true },
    ]) {
      const { send } = await harness({
        chain: staked(),
        reply: { body: positionsView(ACCOUNT, [position(ACCOUNT, STAKER)], overrides) },
      });
      expect(ready(await send(POSITIONS))).toMatchObject({
        complete: false,
        rows: [{ staker: STAKER }],
      });
      const empty = await harness({ reply: { body: positionsView(ACCOUNT, [], overrides) } });
      expect(ready(await empty.send(POSITIONS))).toEqual({
        complete: false,
        rows: [],
        state: "ready",
      });
    }
  });

  test("a token the account doesn't track, or too many candidates, is incomplete", async () => {
    const untracked = await harness({
      chain: staked(),
      reply: {
        body: positionsView(ACCOUNT, [position(ACCOUNT, STAKER, { tokenAddress: "0xb7c" })]),
      },
    });
    expect(ready(await untracked.send(POSITIONS))).toEqual({
      complete: false,
      rows: [],
      state: "ready",
    });
    // Every candidate verifies on chain: the cap alone makes the list incomplete.
    const chain = staked();
    chain.extraStakers = Array.from(
      { length: MAX_CHECKED_POSITIONS },
      (_, index) => `0x${(index + 0x700).toString(16)}`,
    );
    const stakers = [STAKER, ...chain.extraStakers];
    const atCap = await harness({
      chain,
      reply: {
        body: positionsView(
          ACCOUNT,
          stakers.slice(0, MAX_CHECKED_POSITIONS).map((staker) => position(ACCOUNT, staker)),
        ),
      },
    });
    const full = ready(await atCap.send(POSITIONS));
    expect(full.complete).toBe(true);
    expect(full.rows).toHaveLength(MAX_CHECKED_POSITIONS);
    chain.reads = [];
    const over = await harness({
      chain,
      reply: {
        body: positionsView(
          ACCOUNT,
          stakers.map((staker) => position(ACCOUNT, staker)),
        ),
      },
    });
    const answer = ready(await over.send(POSITIONS));
    expect(answer.complete).toBe(false);
    expect(answer.rows).toHaveLength(MAX_CHECKED_POSITIONS);
    expect(chain.reads.filter((read) => read === "staker_pool_info")).toHaveLength(
      MAX_CHECKED_POSITIONS,
    );
  });

  test("fails closed on a failed, malformed, oversized, wrong-chain or wrong-address answer", async () => {
    const replies: readonly Reply[] = [
      new Error("offline"),
      { body: "Forbidden", status: 403 },
      { body: { code: "unauthorized" }, status: 401 },
      { body: { code: "rate_limited" }, status: 429 },
      { body: positionsView(ACCOUNT, [], { chainId: "SN_SEPOLIA" }) },
      { body: positionsView(`0x${"2".repeat(63)}`, []) },
      { body: positionsView(ACCOUNT, [position(ACCOUNT, STAKER, { status: "gone" })]) },
      { body: { padding: "x".repeat(2 * 1024 * 1024 + 1) } },
    ];
    for (const reply of replies) {
      const { send } = await harness({ chain: staked(), reply });
      expect(await send(POSITIONS)).toEqual(UNREADABLE);
    }
  });

  test("fails closed when the chain can't be read", async () => {
    const chain = staked();
    chain.rewardToken = "0x123";
    const { send } = await harness({ chain });
    expect(await send(POSITIONS)).toEqual(UNREADABLE);
  });

  test("refuses a request carrying anything but its type", async () => {
    const { requests, send } = await harness();
    expect(await send({ ...POSITIONS, address: ACCOUNT })).toEqual({
      error: "invalid staking request",
    });
    expect(requests).toEqual([]);
  });
});

describe("the production wiring: the explorer lane's Starkscan client", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("uses starkscan.co (or the user's explorer override) through the hardened transport, and fails cleanly", async () => {
    const fetched: { readonly init: RequestInit | undefined; readonly url: string }[] = [];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      fetched.push({ init, url: String(input) });
      return new Response("Forbidden", { status: 403 });
    }) as unknown as typeof fetch;
    const rpc = createDefaultRuntimeRpc({ readPreferences: async () => ({}) });
    const client = rpc.starkscanFor?.("SN_MAIN", {});
    await expect(client?.getStakingAddress("SN_MAIN", ACCOUNT)).rejects.toThrow();
    await expect(client?.getStakingValidators("SN_MAIN")).rejects.toThrow();
    const custom = rpc.starkscanFor?.("SN_MAIN", {
      explorerApiUrls: { SN_MAIN: "https://explorer.example/v1" },
    });
    await expect(custom?.getStakingValidators("SN_MAIN", "c1")).rejects.toThrow();
    expect(fetched.map(({ url }) => url)).toEqual([
      `https://starkscan.co/v1/SN_MAIN/staking/address/${canonicalFelt(ACCOUNT)}?limit=1`,
      "https://starkscan.co/v1/SN_MAIN/staking/validators?limit=50",
      "https://explorer.example/v1/SN_MAIN/staking/validators?limit=50&cursor=c1",
    ]);
    for (const { init } of fetched) {
      expect(init).toMatchObject({
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
      expect(init?.headers).toEqual({ accept: "application/json" });
    }
  });
});
