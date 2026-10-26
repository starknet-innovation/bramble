/** The daily live phishing feed check grades the source the way the extension reads it. */
import { describe, expect, test } from "bun:test";
import { MAX_PHISHING_DOMAINS } from "../../packages/features/permissions/src/phishing-feed-cache";
import { runPhishingFeedCheck } from "../../scripts/check-phishing-feed";

const domains = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `evil${index}.example`);
const feed =
  (body: unknown, headers: Record<string, string> = { "access-control-allow-origin": "*" }) =>
  async (_input: RequestInfo | URL, init?: RequestInit) => {
    expect(init).toMatchObject({
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { headers });
  };

describe("phishing feed check", () => {
  test("a reachable, open, well-sized list is ok, reported as counts only", async () => {
    const result = await runPhishingFeedCheck({ fetch: feed({ blacklist: domains(110_000) }) });
    expect(result).toEqual({ domains: 110_000, outcome: "ok", percentOfCap: 73 });
    expect(JSON.stringify(result)).not.toContain("http");
  });

  test("a missing CORS header fails, since the extension has no host permission for it", async () => {
    const result = await runPhishingFeedCheck({ fetch: feed({ blacklist: domains(110_000) }, {}) });
    expect(result.outcome).toBe("no-cors");
  });

  test("a 404, a malformed body, a shrunken list and a list near the cap all fail", async () => {
    const notFound = async () => new Response("", { status: 404 });
    expect((await runPhishingFeedCheck({ fetch: notFound })).outcome).toBe("http-error");
    expect((await runPhishingFeedCheck({ fetch: feed("not json") })).outcome).toBe("malformed");
    expect((await runPhishingFeedCheck({ fetch: feed({ list: [] }) })).outcome).toBe("malformed");
    expect((await runPhishingFeedCheck({ fetch: feed({ blacklist: domains(10) }) })).outcome).toBe(
      "too-small",
    );
    const nearCap = { blacklist: domains(Math.ceil(MAX_PHISHING_DOMAINS * 0.95)) };
    expect((await runPhishingFeedCheck({ fetch: feed(nearCap) })).outcome).toBe("near-cap");
  });

  test("a transport failure is reported without its error text", async () => {
    const result = await runPhishingFeedCheck({
      fetch: async () => {
        throw new TypeError("getaddrinfo ENOTFOUND raw.githubusercontent.com");
      },
    });
    expect(result).toEqual({ domains: 0, outcome: "transport-error", percentOfCap: 0 });
  });
});
