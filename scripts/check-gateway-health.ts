/** Sanitized synthetic health probe for bundled Starknet RPC lanes. */

import {
  HTTP_BODY_LIMITS,
  readBoundedText,
  UNTRUSTED_REQUEST_INIT,
} from "../packages/foundation/core/src/http-json";
import { STARKNET_NETWORKS } from "../packages/foundation/wallet-model/src/networks/networks";

type ProbeOutcome = "http-error" | "ok" | "rate-limited" | "timeout" | "transport-error";
type ProbeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** One identifier-free endpoint health result suitable for CI logs and alerts. */
export type GatewayProbeResult = {
  readonly lane: "foundation" | "wallet-gateway";
  readonly latencyMs: number;
  readonly network: "mainnet" | "sepolia";
  readonly outcome: ProbeOutcome;
};

type ProbeOptions = {
  readonly fetch?: ProbeFetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
};

const probes = [
  {
    chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
    lane: "wallet-gateway",
    network: "mainnet",
    url: STARKNET_NETWORKS.SN_MAIN.rpcUrls[0],
  },
  {
    chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
    lane: "foundation",
    network: "mainnet",
    url: STARKNET_NETWORKS.SN_MAIN.rpcUrls[1],
  },
  {
    chainId: STARKNET_NETWORKS.SN_SEPOLIA.chainId,
    lane: "wallet-gateway",
    network: "sepolia",
    url: STARKNET_NETWORKS.SN_SEPOLIA.rpcUrls[0],
  },
  {
    chainId: STARKNET_NETWORKS.SN_SEPOLIA.chainId,
    lane: "foundation",
    network: "sepolia",
    url: STARKNET_NETWORKS.SN_SEPOLIA.rpcUrls[1],
  },
] as const;

const normalizedChainId = (value: string): string => `0x${BigInt(value).toString(16)}`;

const probe = async (
  target: (typeof probes)[number],
  options: Required<ProbeOptions>,
): Promise<GatewayProbeResult> => {
  const startedAt = options.now();
  const deadline = AbortSignal.timeout(options.timeoutMs);
  let outcome: ProbeOutcome;
  try {
    const response = await options.fetch(target.url, {
      ...UNTRUSTED_REQUEST_INIT,
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "starknet_chainId", params: [] }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: deadline,
    });
    if (response.status === 429) {
      outcome = "rate-limited";
    } else if (!response.ok) {
      outcome = "http-error";
    } else {
      const body: unknown = JSON.parse(
        await readBoundedText(response, HTTP_BODY_LIMITS.errorDetail, deadline),
      );
      outcome =
        typeof body === "object" &&
        body !== null &&
        typeof Reflect.get(body, "result") === "string" &&
        normalizedChainId(Reflect.get(body, "result")) === normalizedChainId(target.chainId)
          ? "ok"
          : "http-error";
    }
  } catch (error) {
    outcome =
      deadline.aborted || (error instanceof DOMException && error.name === "TimeoutError")
        ? "timeout"
        : "transport-error";
  }
  return {
    lane: target.lane,
    latencyMs: Math.max(0, options.now() - startedAt),
    network: target.network,
    outcome,
  };
};

/** Probes primary and direct fallback lanes once per public network without account data. */
export const runGatewayHealthProbe = async (
  options: ProbeOptions = {},
): Promise<readonly GatewayProbeResult[]> => {
  const resolved: Required<ProbeOptions> = {
    fetch: options.fetch ?? fetch,
    now: options.now ?? Date.now,
    timeoutMs: options.timeoutMs ?? 10_000,
  };
  return Promise.all(probes.map((target) => probe(target, resolved)));
};

if (import.meta.main) {
  const results = await runGatewayHealthProbe();
  console.log(JSON.stringify(results));
  if (results.some((result) => result.outcome !== "ok" || result.latencyMs > 5_000)) {
    process.exitCode = 1;
  }
}
