/**
 * The extension's staking background, as every block of the staking fixture runs it (see
 * `./index.ts`): the real message handler over the test wallet stub, with a recording JSON-RPC
 * node behind the real `readAtPinnedBlock` and a recording Starkscan transport behind the real
 * Starkscan client. The chain is `tests/support/staking-chain.ts`, answered over the wire by
 * selector. Nothing reaches a network; every value is made up.
 */
import { createPreferencesStore, type TokenConfig } from "@bramble/settings/preferences";
import { readAtPinnedBlock } from "@bramble/starknet/pinned-block";
import { createRpcProvider, resetRpcEndpointCooldownsForTests } from "@bramble/starknet/provider";
import { createMemoryStore } from "@bramble/store/kv";
import { memoryActivityLog } from "@bramble/transactions/activity";
import { memoryAllowanceStore } from "@bramble/transactions/allowance-store";
import { createStarkscanClient } from "@bramble/transactions/starkscan";
import { hash, logger } from "starknet";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import type { RuntimeRpc } from "../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import { testExtension } from "../../tests/support/background-wallet-stub";
import {
  invokeAccount,
  invokeExtensionSender,
  invokeVaultPassphrase,
  invokeWalletStub,
} from "../../tests/support/invoke-approval-harness";
import { makeRuntimeRpc } from "../../tests/support/runtime-rpc-stub";
import {
  makeStakingChain,
  offStakingNetworks,
  type StakingChainState,
  stakingReader,
  testStakingNetworks,
} from "../../tests/support/staking-chain";

logger.setLogLevel("FATAL");

/** The account every case acts for (`invokeAccount`, Mainnet). */
export const ACCOUNT = invokeAccount.address;
/** The clock every case reads, in Unix seconds. */
export const NOW_SECONDS = 1_800_000_000;
/** The explorer lane's base every Starkscan request is made against; never resolved. */
export const STARKSCAN_BASE = "https://starkscan.test/v1";
const RPC_URLS = ["https://capture.invalid/rpc"];
const FEE = { overallFee: "1", unit: "FRI" } as const;

/** The entrypoints the staking reads name, by selector, so the node can answer a wire call. */
const ENTRYPOINTS = [
  "contract_parameters_v1",
  "get_active_tokens",
  "get_pool_member_info_v1",
  "get_staker_info_v1",
  "staker_pool_info",
];
const BY_SELECTOR = new Map(ENTRYPOINTS.map((name) => [hash.getSelectorFromName(name), name]));

/** One JSON-RPC exchange as the node saw it (no id) and what it answered. */
type Exchange = {
  readonly method: string;
  readonly params: unknown;
  readonly reply: { readonly result: unknown } | { readonly error: unknown };
};

/** One Starkscan exchange: the request as sent and the reply given. */
type StarkscanExchange = {
  readonly request: {
    readonly accept: string | null;
    readonly method: string;
    readonly url: string;
  };
  readonly reply: { readonly body: string; readonly status: number };
};

/** A Starkscan reply: a JSON value (or raw text) and a status. */
type StarkscanReply = {
  readonly body: unknown;
  readonly raw?: true;
  readonly status?: number;
};

/** How a case's node misbehaves: answers "Block not found" to this many pinned calls first. */
export type NodeQuirks = { readonly staleCalls?: number };

/** A member of the staking chain's pool; every field may be overridden. */
export const member = (
  overrides: Partial<NonNullable<StakingChainState["member"]>> = {},
): NonNullable<StakingChainState["member"]> => ({
  amount: 5n * 10n ** 18n,
  rewardAddress: ACCOUNT,
  unclaimed: 0n,
  unpoolAmount: 0n,
  unpoolTime: null,
  ...overrides,
});

/** A fresh staking chain with `overrides`. */
export const chainWith = (overrides: Partial<StakingChainState>): StakingChainState => ({
  ...makeStakingChain(),
  ...overrides,
});

const answerCall = async (chain: StakingChainState, params: Record<string, unknown>) => {
  const request = params["request"] as Record<string, unknown>;
  const entrypoint = BY_SELECTOR.get(String(request["entry_point_selector"]));
  if (entrypoint === undefined) throw new Error("unexpected staking selector");
  return stakingReader(chain)(RPC_URLS, (read) =>
    read(String(request["contract_address"]), entrypoint, request["calldata"] as readonly string[]),
  );
};

/** A recording JSON-RPC node answering from `chain`; each pin is a new block. */
const recordingNode = (chain: StakingChainState, quirks: NodeQuirks, exchanges: Exchange[]) => {
  let pins = 0;
  let stale = quirks.staleCalls ?? 0;
  return async (_input: unknown, init?: RequestInit): Promise<Response> => {
    const request = JSON.parse(String(init?.body)) as {
      readonly id: number;
      readonly method: string;
      readonly params?: Record<string, unknown>;
    };
    const params = request.params ?? {};
    let reply: Exchange["reply"];
    if (request.method === "starknet_blockHashAndNumber") {
      pins += 1;
      reply = { result: { block_hash: `0xb10c${pins}`, block_number: 7_000 + pins } };
    } else if (request.method === "starknet_call" && stale > 0) {
      stale -= 1;
      reply = { error: { code: 24, message: "Block not found" } };
    } else if (request.method === "starknet_call") {
      reply = { result: await answerCall(chain, params) };
    } else {
      reply = { error: { code: -32601, message: "Method not found" } };
    }
    exchanges.push({ method: request.method, params: request.params ?? null, reply });
    return new Response(JSON.stringify({ id: request.id, jsonrpc: "2.0", ...reply }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  };
};

/** What one case runs against. */
export type Setup = {
  readonly chain?: StakingChainState;
  readonly enabled?: boolean;
  readonly explorerFallback?: boolean;
  readonly quirks?: NodeQuirks;
  readonly starkscan?: StarkscanReply;
};

/** The extension's background for one case, recording everything it sends. */
export const background = async (setup: Setup = {}) => {
  resetRpcEndpointCooldownsForTests();
  const chain = setup.chain ?? makeStakingChain();
  const rpc: Exchange[] = [];
  const starkscan: StarkscanExchange[] = [];
  const node = recordingNode(chain, setup.quirks ?? {}, rpc);
  const reader: RuntimeRpc["readAtPinnedBlock"] = (_urls, run) =>
    readAtPinnedBlock(RPC_URLS, run, (url) => createRpcProvider(url, { baseFetch: node as never }));
  const reply = setup.starkscan;
  const http = async (url: string, init: RequestInit): Promise<Response> => {
    const body =
      reply === undefined ? "" : reply.raw ? String(reply.body) : JSON.stringify(reply.body);
    const status = reply?.status ?? 200;
    const headers = new Headers(init.headers);
    starkscan.push({
      reply: { body, status },
      request: { accept: headers.get("accept"), method: String(init.method), url },
    });
    return new Response(body, { status });
  };
  const activity = memoryActivityLog();
  const allowanceStore = memoryAllowanceStore();
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  if (setup.explorerFallback === false) {
    await preferencesStore.setExplorerFallback({ enabled: false, networkId: "SN_MAIN" });
  }
  const estimated: unknown[] = [];
  const session = createUnlockSession();
  session.unlock(invokeVaultPassphrase);
  const handler = createMessageHandler(invokeWalletStub([invokeAccount]), testExtension, {
    activity,
    allowanceStore,
    now: () => NOW_SECONDS * 1000,
    preferencesStore,
    runtimeRpc: makeRuntimeRpc({
      async estimateInvokeFee(input) {
        estimated.push(input.calls);
        return FEE;
      },
      readAtPinnedBlock: reader,
      starkscanFor: () => createStarkscanClient({ baseUrl: STARKSCAN_BASE, http }),
      async submitInvokeTransaction(input) {
        return { calls: input.calls, transactionHash: "0x5ab" };
      },
    }),
    session,
    stakingNetworks: setup.enabled === false ? offStakingNetworks : testStakingNetworks,
  });
  const send = (message: Record<string, unknown>) => handler(message, invokeExtensionSender);
  const tokens = (await preferencesStore.read()).tokens.filter(
    (token: TokenConfig) => token.networkId === "SN_MAIN",
  );
  return { activity, allowanceStore, estimated, rpc, send, starkscan, tokens };
};

/** The staking contract the test network table trusts. */
export const STAKING_CONTRACT = testStakingNetworks.SN_MAIN?.stakingContract ?? "";

/** JSON-clean: bigints as decimal strings, `undefined` keys dropped. */
export const plain = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  );
