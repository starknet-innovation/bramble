/**
 * MCW-V09-121: every Starknet RPC request must carry an abort deadline, so a
 * hung or slow-loris endpoint cannot park a read forever or hold worker state
 * open on a submit path. These cases pin the deadline at the provider boundary
 * where all wallet providers are built, including that it is composed with —
 * never replaced by — a caller-supplied signal, so no future caller can hand in
 * a plain AbortController and silently remove every RPC deadline.
 */

import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RpcProvider, RpcProviderOptions } from "starknet";
import {
  createRpcProvider,
  RPC_BODY_LIMIT_BYTES,
  RPC_REQUEST_TIMEOUT_MS,
  timedRpcFetch,
} from "../../src/starknet/provider";

// Captures the options the pinned constructor would have received.
const capturedOptions = (
  options: Omit<RpcProviderOptions, "nodeUrl" | "specVersion"> = {},
): RpcProviderOptions => {
  let captured: RpcProviderOptions = {};
  createRpcProvider("https://rpc.example", options, (given) => {
    captured = given;
    return {} as RpcProvider;
  });
  return captured;
};

describe("Starknet RPC request deadlines", () => {
  test("gives every provider a bounded transport by default", () => {
    const { baseFetch } = capturedOptions();
    expect(typeof baseFetch).toBe("function");
    expect(RPC_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
  });

  test("lets a caller that needs a tighter deadline supply its own transport", () => {
    const own: NonNullable<RpcProviderOptions["baseFetch"]> = async () => new Response("{}");
    expect(capturedOptions({ baseFetch: own }).baseFetch).toBe(own);
  });

  test("aborts a request the endpoint never answers", async () => {
    const aborts: string[] = [];
    const hung: NonNullable<RpcProviderOptions["baseFetch"]> = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborts.push("abort");
          reject(new Error("aborted"));
        });
      });
    await expect(timedRpcFetch(5, hung)("https://rpc.example", { method: "POST" })).rejects.toThrow(
      "aborted",
    );
    expect(aborts).toEqual(["abort"]);
  });

  test("composes a caller's own signal with the deadline instead of deferring to it", async () => {
    const controller = new AbortController();
    const seen: (AbortSignal | undefined)[] = [];
    const capture: NonNullable<RpcProviderOptions["baseFetch"]> = async (_input, init) => {
      seen.push(init?.signal ?? undefined);
      return new Response("{}");
    };
    await timedRpcFetch(5_000, capture)("https://rpc.example", { signal: controller.signal });
    const composed = seen[0];
    expect(composed).toBeInstanceOf(AbortSignal);
    // The caller's own signal still aborts the request...
    expect(composed?.aborted).toBe(false);
    controller.abort();
    expect(composed?.aborted).toBe(true);
  });

  test("keeps the deadline when a caller supplies a signal that never aborts", async () => {
    const controller = new AbortController();
    const seen: (AbortSignal | undefined)[] = [];
    const capture: NonNullable<RpcProviderOptions["baseFetch"]> = async (_input, init) => {
      seen.push(init?.signal ?? undefined);
      return new Response("{}");
    };
    // A plain AbortController signal must not be able to disable every RPC
    // deadline in the wallet: the composed signal still fires on its own.
    await timedRpcFetch(5, capture)("https://rpc.example", { signal: controller.signal });
    const composed = seen[0];
    const aborted = await new Promise<boolean>((resolve) => {
      composed?.addEventListener("abort", () => resolve(true), { once: true });
    });
    expect(aborted).toBe(true);
    expect(controller.signal.aborted).toBe(false);
  });

  test("leaves a request that answers in time untouched", async () => {
    const answered: NonNullable<RpcProviderOptions["baseFetch"]> = async () =>
      new Response(JSON.stringify({ ok: true }));
    const response = await timedRpcFetch(5_000, answered)("https://rpc.example");
    expect(await response.json()).toEqual({ ok: true });
  });
});

// Every `.ts` under src/, so a new read lane is scanned the day it is written.
const sourceFiles = async (dir: string): Promise<readonly string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(path)));
    } else if (entry.isFile() && path.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
};

describe("one RPC transport, not one per read lane", () => {
  /**
   * MCW-V09-122 (follow-up): a lane that needs a tighter deadline than the
   * wallet-wide default must override the NUMBER, never write its own transport.
   * The multisig read lane once carried a private `baseFetch` that REPLACED a
   * caller's signal instead of composing with it, so the composition guarantee
   * pinned above simply did not hold there. Whoever adds the next lane inherits
   * that guarantee only if they reach for the shared helper.
   */
  test("no module outside provider.ts builds its own provider transport", async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles("src")) {
      if (file.endsWith(join("starknet", "provider.ts"))) {
        continue;
      }
      const text = await readFile(file, "utf8");
      for (const match of text.matchAll(/baseFetch:\s*(\S+)/g)) {
        if (!(match[1] ?? "").startsWith("timedRpcFetch")) {
          offenders.push(`${file}: ${match[1] ?? ""}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * MCW-V09-122 at the wallet's largest untrusted boundary. The JSON-RPC endpoint
 * is a body starknet.js reads with `.json()`, a dapp can propose its URL through
 * `wallet_addStarknetChain`, and a deadline alone is not a bound: at any real
 * link speed hundreds of megabytes buffer into the service worker before the
 * clock runs out. The cap is enforced on the stream, in the transport, so the
 * bytes are refused as they arrive rather than measured after they land.
 */
describe("Starknet RPC response bodies are bounded", () => {
  const CHUNK = 4 * 1024 * 1024;
  const endlessBody = (): {
    readonly emitted: { bytes: number };
    readonly base: NonNullable<RpcProviderOptions["baseFetch"]>;
  } => {
    const emitted = { bytes: 0 };
    const padding = new TextEncoder().encode("a".repeat(CHUNK));
    return {
      base: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              emitted.bytes += padding.byteLength;
              controller.enqueue(padding);
            },
          }),
        ),
      emitted,
    };
  };

  test("cuts off a body that never ends instead of buffering it", async () => {
    const { base, emitted } = endlessBody();
    await expect(timedRpcFetch(30_000, base)("https://rpc.example")).rejects.toThrow(
      "exceeded its size limit",
    );
    // Bounded by the budget plus the chunk that crossed it and the one the
    // stream had already queued behind it — the mark of a cap spent as the
    // bytes arrive rather than one applied to a body that has already landed.
    expect(emitted.bytes).toBeLessThanOrEqual(RPC_BODY_LIMIT_BYTES + 2 * CHUNK);
  });

  test("refuses a single declared-huge body before reading a byte of it", async () => {
    const declared: NonNullable<RpcProviderOptions["baseFetch"]> = async () =>
      new Response("{}", { headers: { "content-length": String(RPC_BODY_LIMIT_BYTES + 1) } });
    await expect(timedRpcFetch(30_000, declared)("https://rpc.example")).rejects.toThrow(
      "exceeded its size limit",
    );
  });

  test("passes an ordinary answer through with its status and body intact", async () => {
    const answered: NonNullable<RpcProviderOptions["baseFetch"]> = async () =>
      new Response(JSON.stringify({ result: "0x1" }), { status: 200 });
    const response = await timedRpcFetch(5_000, answered)("https://rpc.example");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "0x1" });
  });
});
