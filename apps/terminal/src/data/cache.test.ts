import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCache, getJson } from "./cache";

beforeEach(() => clearCache());

describe("getJson", () => {
  it("keeps a shared request alive when one consumer aborts", async () => {
    let release: (() => void) | undefined;
    globalThis.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        }),
    ) as unknown as typeof fetch;

    const firstController = new AbortController();
    const first = getJson<{ readonly ok: boolean }>("https://example.test/data", {
      signal: firstController.signal,
    }).catch((cause: unknown) => cause);
    firstController.abort();

    const second = getJson<{ readonly ok: boolean }>("https://example.test/data");
    release?.();

    expect(await first).toBeInstanceOf(DOMException);
    await expect(second).resolves.toEqual({ ok: true });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
