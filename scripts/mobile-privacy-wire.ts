/**
 * The privacy half of the mobile parity fixture that talks to services: viewing keys from the
 * extension's real Krusty path, and every discovery/pool read driven through the extension's own
 * `createOfficialStrk20Service` over the vendored official SDK bundle, against a recording `fetch`
 * stub. Nothing reaches a network: the stub answers every request from the case's script.
 *
 * Every key here is derived from the published parity phrase (PARITY_MNEMONIC), so every value is
 * public by construction.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { DEFAULT_STRK20_NETWORKS, STRK20_MAINNET_POOL } from "@bramble/privacy/config";
import {
  createOfficialStrk20Service,
  type PrivacySdkRuntime,
} from "@bramble/privacy/official-sdk-service";
import {
  readStrk20Balances,
  readStrk20RegistrationStatus,
  type Strk20AccountContext,
} from "@bramble/privacy/service";
import { createRpcProvider, resetRpcEndpointCooldownsForTests } from "@bramble/starknet/provider";
import { deriveAccount } from "@bramble/vault/accounts";
import { canonicalFelt, DEFAULT_TOKENS, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { PARITY_MNEMONIC } from "./mobile-parity";
import {
  PRIVACY_CASES,
  type PrivacyCase,
  type ScriptedReply,
  synthPages,
} from "./mobile-privacy-cases";

/**
 * The vendored privacy SDK bundle the wire capture drives. `bun run vendor:privacy` builds it; the
 * offline fast-checks tier does not, so the capture cannot run there.
 */
export const PRIVACY_SDK_BUNDLE = "vendor/starknet-privacy/sdk/dist/browser/starknet-sdk.js";
// The bundled routing, exactly as the mobile core embeds it; the stub answers, nothing is sent.
const MAINNET_ROUTING = DEFAULT_STRK20_NETWORKS.SN_MAIN;
const RPC_URL = STARKNET_NETWORKS.SN_MAIN.rpcUrls[0] ?? "";
const MAINNET_TOKENS = DEFAULT_TOKENS.filter((token) => token.networkId === "SN_MAIN");

const kmsPromise = import("@starknetfoundation/krusty-kms-wasm").then(createKrustyKms);

const scopedPool = (): string => {
  const pool = canonicalFelt(STRK20_MAINNET_POOL);
  if (!pool) throw new Error("mainnet pool is not a felt");
  return pool;
};

/** Account 0/1 on Starknet Mainnet: address and scoped viewing key, as the extension derives them. */
export const parityPrivacyAccount = async (accountIndex: number) => {
  const kms = await kmsPromise;
  const derived = await deriveAccount(kms, {
    accountContractType: "openzeppelin",
    accountIndex,
    mnemonic: PARITY_MNEMONIC,
    networkId: "SN_MAIN",
  });
  const viewingKey = await kms.deriveStrk20ViewingKey(
    derived.privateKey,
    STARKNET_NETWORKS.SN_MAIN.chainId,
    scopedPool(),
  );
  return { address: derived.account.address, viewingKey };
};

const refused = async (run: () => Promise<unknown>): Promise<boolean> => {
  try {
    await run();
    return false;
  } catch {
    return true;
  }
};

/** Fixture 1: scoped viewing keys from the WASM adapter, the crate's vectors, and refusals. */
export const computeViewingKeys = async () => {
  const kms = await kmsPromise;
  const accounts = [];
  for (const accountIndex of [0, 1]) {
    const { address, viewingKey } = await parityPrivacyAccount(accountIndex);
    accounts.push({ accountIndex, address, viewingKey });
  }
  const crateVectors = [
    ["0x1", "0x534e5f5345504f4c4941", "0x123"],
    ["0x1", "0x534e5f4d41494e", "0x123"],
    ["0xdeadbeef", "0x534e5f5345504f4c4941", "0x456"],
  ] as const;
  const chainId = STARKNET_NETWORKS.SN_MAIN.chainId;
  return {
    accounts,
    chainId,
    crate: await Promise.all(
      crateVectors.map(async ([privateKey, chain, pool]) => ({
        chainId: chain,
        pool,
        privateKey,
        viewingKey: await kms.deriveStrk20ViewingKey(privateKey, chain, pool),
      })),
    ),
    pool: scopedPool(),
    refusals: await Promise.all(
      ["0x01", "0xABC", "0x0"].map(async (pool) => ({
        pool,
        refused: await refused(() => kms.deriveStrk20ViewingKey("0x1", chainId, pool)),
      })),
    ),
  };
};

type Recorded = {
  readonly kind: "preflight" | "incoming" | "rpc";
  readonly url: string;
  readonly body: string;
};

const jsonResponse = (reply: ScriptedReply, id?: number): Response =>
  new Response(id === undefined ? reply.body : reply.body.replaceAll('"id":0', `"id":${id}`), {
    headers: { "Content-Type": "application/json" },
    status: reply.status,
  });

/** Runs one case through the extension's `stateResponse` read order and records what it did. */
export const runPrivacyCase = async (scenario: PrivacyCase) => {
  const { address, viewingKey } = await parityPrivacyAccount(0);
  const queues = {
    fee: [...scenario.fee],
    incoming: [...(scenario.synth ? synthPages(scenario.synth) : scenario.pages)],
    preflight: [...scenario.preflight],
  };
  const recorded: Recorded[] = [];
  const pauses: { readonly attempt: number; readonly retryAfterMs: number | null }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? init.body : "";
    if (url.endsWith("/v1/sync/preflight_check") || url.endsWith("/v1/sync/incoming_state")) {
      const kind = url.endsWith("preflight_check") ? "preflight" : "incoming";
      recorded.push({ body, kind, url });
      const next = queues[kind].shift();
      return next ? jsonResponse(next) : new Response("exhausted", { status: 599 });
    }
    recorded.push({ body, kind: "rpc", url });
    const id = (JSON.parse(body) as { readonly id: number }).id;
    const next = queues.fee.shift();
    return next ? jsonResponse(next, id) : new Response("exhausted", { status: 599 });
  }) as typeof fetch;
  resetRpcEndpointCooldownsForTests();
  // The same pinned bundle the extension ships (verified by `check:privacy`), loaded the way
  // `check-privacy-sdk.ts` loads it: the vendored JavaScript has no type declarations.
  const sdk = (await import(pathToFileURL(resolve(PRIVACY_SDK_BUNDLE)).href)) as PrivacySdkRuntime;
  const service = createOfficialStrk20Service({
    pauseForServiceRetry: async (attempt, retryAfterMs) => {
      pauses.push({ attempt, retryAfterMs: retryAfterMs ?? null });
    },
    providerFor: createRpcProvider,
    sdk,
  });
  const context = {
    account: { address, id: `SN_MAIN:${address}`, networkId: "SN_MAIN" },
    config: MAINNET_ROUTING,
    isAuthorized: () => true,
    rpcUrls: [RPC_URL],
    signHash: async () => {
      throw new Error("reads never sign");
    },
    viewingKey: async () => viewingKey,
  } as unknown as Strk20AccountContext;
  let outcome: unknown;
  try {
    // The extension's `stateResponse` order, through the same service wrappers it calls.
    const registration = await readStrk20RegistrationStatus(service, {
      ...context,
      token: MAINNET_TOKENS[0]?.address ?? "",
    });
    const balances =
      registration === "registered"
        ? await readStrk20Balances(service, {
            ...context,
            tokens: MAINNET_TOKENS.map((t) => t.address),
          })
        : [];
    const poolFeeFri = await (service.poolFee?.(context) ?? Promise.reject(new Error("no fee")));
    outcome = {
      balances: balances.map((entry) => ({
        balance: BigInt(entry.balance).toString(),
        token: entry.token,
      })),
      poolFeeFri,
      registration,
    };
  } catch {
    outcome = { error: true };
  } finally {
    globalThis.fetch = original;
  }
  const count = (kind: Recorded["kind"]) => recorded.filter((entry) => entry.kind === kind).length;
  return {
    id: scenario.id,
    outcome,
    pauses,
    requests: { fee: count("rpc"), incoming: count("incoming"), preflight: count("preflight") },
    ...(scenario.mobile ? { mobile: scenario.mobile } : {}),
    recorded,
    script: {
      fee: scenario.fee,
      preflight: scenario.preflight,
      ...(scenario.synth ? { synth: scenario.synth } : { pages: scenario.pages }),
    },
  };
};

/** Fixture 3 and 4: request bytes of the three-page capture, and every judged case's outcome. */
export const computeWire = async () => {
  const cases = [];
  for (const scenario of PRIVACY_CASES) {
    cases.push(await runPrivacyCase(scenario));
  }
  const capture = cases.find((entry) => entry.id === "three-pages");
  if (!capture) throw new Error("three-page capture missing");
  return {
    capture: {
      discoveryUrl: MAINNET_ROUTING?.discoveryUrl,
      requests: capture.recorded.map((entry) =>
        entry.kind === "rpc"
          ? { kind: entry.kind, params: (JSON.parse(entry.body) as { params: unknown }).params }
          : entry,
      ),
    },
    cases: cases.map(({ recorded: _recorded, ...rest }) => rest),
  };
};
