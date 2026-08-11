/**
 * MCW-V09-122: the shared reader every untrusted HTTP boundary goes through must
 * close both halves of the finding — an unbounded body AND an unbounded wait —
 * and must send the request hardening the NFT metadata boundary already models.
 *
 * A size cap alone does not save the worker: a host that answers `200` with a
 * chunked body, writes eight bytes, and then simply stops parks the read
 * forever, because the byte budget is never reached and nothing else is
 * counting. These cases drive that exact shape, plus a transport that never
 * answers at all, and pin that each one fails closed on its deadline with the
 * response stream cancelled rather than left open.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "../../src/shared/errors";
import { fetchBoundedJson, HTTP_REQUEST_TIMEOUT_MS } from "../../src/shared/http-json";

const DEADLINE_MS = 25;
const BUDGET = 4096;

// A body that opens with valid-looking JSON and then never sends another byte
// and never closes: the shape a slow-loris endpoint uses to hold a reader open
// without ever tripping a size cap.
const stalledBody = (): { readonly cancelled: () => boolean; readonly response: Response } => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"pad":"'));
    },
  });
  return { cancelled: () => cancelled, response: new Response(stream) };
};

const okJson = (body: unknown): Response => new Response(JSON.stringify(body));

describe("bounded boundary reads", () => {
  test("gives up on a body that stalls mid-stream and cancels it", async () => {
    const { cancelled, response } = stalledBody();
    const read = fetchBoundedJson(
      async () => response,
      "https://feed.example",
      BUDGET,
      DEADLINE_MS,
    );
    await expect(read).rejects.toBeInstanceOf(WalletError);
    await expect(read).rejects.toThrow("Response timed out");
    expect(cancelled()).toBe(true);
  });

  test("gives up on a transport that never answers", async () => {
    const read = fetchBoundedJson(
      () => new Promise<Response>(() => undefined),
      "https://feed.example",
      BUDGET,
      DEADLINE_MS,
    );
    await expect(read).rejects.toThrow("Response timed out");
  });

  test("hands the transport an unaborted deadline signal so a real fetch can drop the socket", async () => {
    const seen: { aborted: boolean | undefined; signal: AbortSignal | null | undefined } = {
      aborted: undefined,
      signal: undefined,
    };
    await fetchBoundedJson(
      async (_url, init) => {
        seen.signal = init.signal;
        seen.aborted = init.signal?.aborted;
        return okJson({ ok: true });
      },
      "https://feed.example",
      BUDGET,
      DEADLINE_MS,
    );
    expect(seen.signal).toBeInstanceOf(AbortSignal);
    expect(seen.aborted).toBe(false);
  });

  test("withholds cookies and referrer and refuses to follow a redirect", async () => {
    let init: RequestInit | undefined;
    await fetchBoundedJson(
      async (_url, given) => {
        init = given;
        return okJson({});
      },
      "https://feed.example",
      BUDGET,
    );
    expect(init?.credentials).toBe("omit");
    expect(init?.redirect).toBe("error");
    expect(init?.referrerPolicy).toBe("no-referrer");
  });

  test("cuts a body off at its byte budget rather than buffering it", async () => {
    const padding = new TextEncoder().encode("a".repeat(1024));
    let emitted = 0;
    const endless = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          emitted += padding.byteLength;
          controller.enqueue(padding);
        },
      }),
    );
    await expect(
      fetchBoundedJson(async () => endless, "https://feed.example", BUDGET, 5_000),
    ).rejects.toThrow("Response exceeded its size limit");
    expect(emitted).toBeLessThanOrEqual(BUDGET + 2 * padding.byteLength);
  });

  test("refuses a declared length that is already over budget", async () => {
    await expect(
      fetchBoundedJson(
        async () => new Response("{}", { headers: { "content-length": String(BUDGET + 1) } }),
        "https://feed.example",
        BUDGET,
      ),
    ).rejects.toThrow("Response exceeded its size limit");
  });

  test("refuses a non-ok answer without reading its body", async () => {
    await expect(
      fetchBoundedJson(
        async () => new Response("{}", { status: 500 }),
        "https://feed.example",
        BUDGET,
      ),
    ).rejects.toBeInstanceOf(WalletError);
  });

  test("refuses bytes that are not JSON", async () => {
    await expect(
      fetchBoundedJson(async () => new Response("not json"), "https://feed.example", BUDGET),
    ).rejects.toThrow("Response was not JSON");
  });

  test("reads a normal body under the default deadline", async () => {
    expect(HTTP_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(
      await fetchBoundedJson(async () => okJson({ blocklist: ["evil.example"] }), "u", BUDGET),
    ).toEqual({ blocklist: ["evil.example"] });
  });
});
