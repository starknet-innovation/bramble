/**
 * The terminal network layer must bound every request: an internal deadline that
 * fires even when the caller detaches, and a response-byte cap applied before
 * JSON parsing or error storage. The final case guards that no production module
 * reaches around the boundary with a raw `fetch` or `RpcProvider`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCache, getJson } from "../src/data/core/cache";
import { fetchJson } from "../src/data/core/client";
import { ResponseTooLargeError, boundedFetch } from "../src/protocols/support/bounded-network";

// A fetch that never produces headers but still honours an abort, the way a real
// stalled upstream would.
const stallingFetch = (): typeof fetch =>
  vi.fn(
    (_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(init?.signal?.reason ?? new DOMException("Aborted", "AbortError")),
        );
      }),
  ) as unknown as typeof fetch;

// Attaches both handlers immediately so a rejection is never unhandled while the
// test advances timers.
const outcome = (promise: Promise<unknown>): Promise<string> =>
  promise.then(
    () => "resolved",
    () => "rejected",
  );

const stateAfter = (promise: Promise<string>): Promise<string> =>
  Promise.race([promise, Promise.resolve("pending")]);

beforeEach(() => {
  clearCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("bounded terminal network", () => {
  it("aborts a request that never produces headers and frees the in-flight slot", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", stallingFetch());
    const settled = outcome(getJson("https://example.test/hang"));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await stateAfter(settled)).toBe("rejected");

    // The slot is freed, so a later call reaches the network again.
    const retry = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", retry);
    await expect(getJson("https://example.test/hang")).resolves.toEqual({ ok: true });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("settles a shared request within its total budget", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", stallingFetch());
    const settled = outcome(getJson("https://example.test/budget", { deadlineMs: 2_000 }));
    await vi.advanceTimersByTimeAsync(1_500);
    expect(await stateAfter(settled)).toBe("pending");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await stateAfter(settled)).toBe("rejected");
  });

  it("rejects a streamed success body that passes the byte cap", async () => {
    const huge = "x".repeat(5_000);
    const fetch = vi.fn(async () => new Response(JSON.stringify({ huge }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchJson("https://example.test/huge", { maxBytes: 1_024 })).rejects.toBeInstanceOf(
      ResponseTooLargeError,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized body from its Content-Length precheck", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { headers: { "content-length": "5000" }, status: 200 })),
    );
    await expect(
      boundedFetch("https://example.test/declared", { maxBytes: 1_024 }),
    ).rejects.toBeInstanceOf(ResponseTooLargeError);
  });

  it("stores only a bounded error-body prefix", async () => {
    const huge = "e".repeat(5_000);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(huge, { status: 500 })));
    const error = (await fetchJson("https://example.test/error", { maxBytes: 1_024 }).catch(
      (cause: unknown) => cause,
    )) as { readonly body: string };
    expect(error.body.length).toBeLessThanOrEqual(300);
  });

  it("passes through a response with no body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const response = await boundedFetch("https://example.test/empty");
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
  });

  it("keeps a shared request alive when one consumer aborts", async () => {
    let release: (() => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = () => resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
          }),
      ),
    );
    const controller = new AbortController();
    const first = getJson("https://example.test/shared", { signal: controller.signal }).catch(
      (cause: unknown) => cause,
    );
    controller.abort();
    const second = getJson("https://example.test/shared");
    release?.();
    expect(await first).toMatchObject({ name: "AbortError" });
    await expect(second).resolves.toEqual({ ok: true });
  });
});

describe("network boundary coverage", () => {
  const sources = import.meta.glob("../src/**/*.{ts,tsx}", {
    eager: true,
    import: "default",
    query: "?raw",
  }) as Record<string, string>;

  it("routes every production fetch and RpcProvider through the boundary", () => {
    const boundaryFiles = new Set([
      "../src/protocols/support/bounded-network.ts",
      "../src/protocols/support/provider.ts",
    ]);
    const offenders: string[] = [];
    for (const [path, text] of Object.entries(sources)) {
      if (boundaryFiles.has(path) || /\.test\.tsx?$/.test(path)) {
        continue;
      }
      if (/(^|[^A-Za-z0-9_$])fetch\s*\(/.test(text)) {
        offenders.push(`${path}: raw fetch`);
      }
      if (/new RpcProvider\s*\(/.test(text)) {
        offenders.push(`${path}: raw RpcProvider`);
      }
      if (/AbortSignal\.timeout\s*\(/.test(text)) {
        offenders.push(`${path}: direct timeout`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
