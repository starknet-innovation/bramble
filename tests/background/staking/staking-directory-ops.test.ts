/**
 * The validator directory from the background (issue 750): read through the
 * explorer lane's Starkscan client, never with a key, bounded and strictly
 * validated, listed while Starkscan is catching up only just behind and
 * hidden when its coverage is incomplete, filtered to
 * active validators with an active pool for a tracked token, and never a
 * shortcut past on-chain verification. Fixtures are schema-derived, not live.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { MAX_CATCHING_UP_LAG_BLOCKS } from "@bramble/transactions/staking-coverage";
import { createStarkscanClient, type StarkscanHttp } from "@bramble/transactions/starkscan";
import { STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  CATCHING_UP_COVERAGE,
  directoryCoverage,
  directoryPage,
  directoryParts,
  directoryValidator,
} from "../../../packages/features/transactions/tests/support/staking-directory-fixture";
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
  stakingReader,
  testStakingNetworks,
} from "../../support/staking-chain";

const BASE = "https://starkscan.test/v1";
const ROUTE = `${BASE}/SN_MAIN/staking/validators`;
const UNREADABLE = {
  error: "Couldn't load the validator list. Paste a validator address instead.",
};

type Reply = { readonly body: unknown; readonly status?: number } | Error;

const harness = async (
  options: {
    readonly enabled?: boolean;
    readonly reply?: Reply;
    readonly starkscan?: boolean;
  } = {},
) => {
  const requests: { readonly init: RequestInit; readonly url: string }[] = [];
  const reply = options.reply ?? { body: directoryPage([directoryValidator(STAKER)]) };
  const http: StarkscanHttp = async (url, init) => {
    requests.push({ init, url });
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  };
  const chain = makeStakingChain();
  const session = createUnlockSession();
  session.unlock(invokeVaultPassphrase);
  const estimated: unknown[] = [];
  const handler = createMessageHandler(invokeWalletStub([invokeAccount]), testExtension, {
    now: () => 1_800_000_000_000,
    preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
    runtimeRpc: makeRuntimeRpc({
      async estimateInvokeFee(input) {
        estimated.push(input);
        return { overallFee: "1", unit: "FRI" };
      },
      readAtPinnedBlock: stakingReader(chain),
      ...(options.starkscan === false
        ? {}
        : { starkscanFor: () => createStarkscanClient({ baseUrl: BASE, http }) }),
    }),
    session,
    stakingNetworks: options.enabled === false ? offStakingNetworks : testStakingNetworks,
  });
  const send = (message: Record<string, unknown>) => handler(message, invokeExtensionSender);
  return { chain, estimated, requests, send };
};

const directory = { type: "wallet.stakingDirectory" } as const;

describe("staking directory", () => {
  test("is off, with no request, without a Starkscan client", async () => {
    const { requests, send } = await harness({ starkscan: false });
    expect(await send(directory)).toEqual({ ok: true, stakingDirectory: { state: "off" } });
    expect(requests).toEqual([]);
  });

  test("is refused, with no request, while staking is switched off", async () => {
    const { requests, send } = await harness({ enabled: false });
    expect(await send(directory)).toEqual({ error: "Staking isn't available on this network." });
    expect(requests).toEqual([]);
  });

  test("reads one bounded page through the Starkscan client, hardened and with no key", async () => {
    const { requests, send } = await harness();
    const response = await send({ ...directory, cursor: "next/page=2" });
    expect(response).toMatchObject({
      ok: true,
      stakingDirectory: {
        entries: [
          {
            commission: "5%",
            name: "Validator One",
            pools: [{ delegated: "1500", symbol: "STRK" }],
            staker: STAKER,
            uptime: "99.5%",
            website: "validator.example",
          },
        ],
        nextCursor: null,
        state: "ready",
      },
    });
    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]?.url ?? "");
    expect(`${url.origin}${url.pathname}`).toBe(ROUTE);
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("cursor")).toBe("next/page=2");
    expect(requests[0]?.init).toMatchObject({ credentials: "omit", redirect: "error" });
    expect(requests[0]?.init).toMatchObject({ referrerPolicy: "no-referrer" });
    // The explorer lane's own headers: JSON only, no key, no account.
    expect(requests[0]?.init.headers).toEqual({ accept: "application/json" });
  });

  test("offers only active validators with an active pool for a tracked token", async () => {
    const { send } = await harness({
      reply: {
        body: directoryPage([
          directoryValidator("0x1"),
          directoryValidator("0x2", { status: "inactive" }),
          directoryValidator("0x3", {
            pools: [directoryParts.pool(STRK_TOKEN_ADDRESS, "0x9", "retired")],
          }),
          directoryValidator("0x4", { pools: [directoryParts.pool("0x777", "0x9")] }),
        ]),
      },
    });
    const response = await send(directory);
    const entries =
      "stakingDirectory" in response && "entries" in response.stakingDirectory
        ? response.stakingDirectory.entries
        : [];
    expect(entries.map((entry) => entry.staker)).toEqual(["0x1"]);
  });

  test("lists exactly as for prepared while Starkscan is catching up only just behind", async () => {
    const { send } = await harness({
      reply: {
        body: directoryPage([directoryValidator(STAKER)], { coverage: CATCHING_UP_COVERAGE }),
      },
    });
    const answer = await send(directory);
    expect(answer).toMatchObject({
      ok: true,
      stakingDirectory: { entries: [{ staker: STAKER, uptime: "99.5%" }], state: "ready" },
    });
    const prepared = await harness();
    expect(answer).toEqual(await prepared.send(directory));
  });

  test("offers no validators while Starkscan reports its snapshot incomplete", async () => {
    for (const coverage of [
      directoryCoverage({ status: "unavailable" }),
      { ...CATCHING_UP_COVERAGE, lagBlocks: MAX_CATCHING_UP_LAG_BLOCKS + 1 },
      { ...CATCHING_UP_COVERAGE, gapIntervals: [{}] },
      { ...CATCHING_UP_COVERAGE, outstandingMaterializationIntervals: [{}] },
      { ...CATCHING_UP_COVERAGE, finalizedOnly: false },
    ]) {
      const body = directoryPage([directoryValidator(STAKER)], { coverage });
      const { send } = await harness({ reply: { body } });
      expect(await send(directory)).toEqual({
        ok: true,
        stakingDirectory: { state: "incomplete" },
      });
    }
  });

  test("fails closed on a failed (403 included), malformed, oversized or wrong-chain answer", async () => {
    const replies: readonly Reply[] = [
      new Error("offline"),
      { body: "Forbidden", status: 403 },
      { body: { code: "unauthorized" }, status: 401 },
      { body: { code: "staking_directory_capacity_exceeded" }, status: 503 },
      { body: directoryPage([directoryValidator(STAKER)], { chainId: "SN_SEPOLIA" }) },
      { body: directoryPage([directoryValidator(STAKER, { name: "x".repeat(65) })]) },
      { body: directoryPage([directoryValidator(STAKER, { address: "0x0" })]) },
      { body: directoryPage([directoryValidator(STAKER)], { coverage: { status: "prepared" } }) },
      {
        body: directoryPage([directoryValidator(STAKER)], {
          coverage: { ...CATCHING_UP_COVERAGE, lagBlocks: -1 },
        }),
      },
      { body: { padding: "x".repeat(2 * 1024 * 1024 + 1) } },
    ];
    for (const reply of replies) {
      const { send } = await harness({ reply });
      expect(await send(directory)).toEqual(UNREADABLE);
    }
  });

  test("a validator picked from the list is still verified on chain before anything is built", async () => {
    // Prepared or catching up, a listed validator takes the pasted address's path.
    for (const coverage of [directoryCoverage(), CATCHING_UP_COVERAGE]) {
      const { chain, estimated, send } = await harness({
        reply: { body: directoryPage([directoryValidator(STAKER)], { coverage }) },
      });
      chain.poolStaker = "0x999";
      const preferences = await createPreferencesStore({ store: createMemoryStore() }).read();
      const strk = preferences.tokens.find(
        (token) => token.networkId === "SN_MAIN" && sameFelt(token.address, STRK_TOKEN_ADDRESS),
      );
      expect(await send(directory)).toMatchObject({
        stakingDirectory: { entries: [{ staker: STAKER }], state: "ready" },
      });
      const review = await send({
        action: "stake",
        amount: "1",
        staker: STAKER,
        tokenId: strk?.id ?? "",
        type: "wallet.stakingPrepare",
      });
      expect(review).toEqual({ error: "Couldn't verify this validator on chain." });
      expect(estimated).toEqual([]);
    }
  });
});
