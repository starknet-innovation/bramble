/** The dev-only app directory manifest check fetches safely and reports per app. */
import { describe, expect, test } from "bun:test";
import type { ListedApp } from "../../packages/features/permissions/src/app-directory-types";
import { checkAppManifest } from "../../scripts/check-app-manifest";

const app: ListedApp = {
  audit: "https://audits.example.org/dex.pdf",
  category: "defi",
  chains: { SN_MAIN: { contracts: ["0x123"] } },
  id: "example-dex",
  name: "Example DEX",
  origin: "https://app.example.com",
};

const serve =
  (body: string, status = 200) =>
  async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe("https://app.example.com/.well-known/starknet-app.json");
    expect(init).toMatchObject({
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    return new Response(body, { status });
  };

describe("app manifest check", () => {
  test("a matching manifest is ok", async () => {
    const body = JSON.stringify({
      chains: { SN_MAIN: { contracts: ["0x123"] } },
      name: "Example DEX",
    });
    expect(await checkAppManifest(app, { fetch: serve(body) })).toEqual({
      id: "example-dex",
      problems: [],
    });
  });

  test("a mismatch, an HTTP error, non-JSON and a transport failure are each reported", async () => {
    const wrong = JSON.stringify({
      chains: { SN_MAIN: { contracts: ["0x999"] } },
      name: "Example DEX",
    });
    expect((await checkAppManifest(app, { fetch: serve(wrong) })).problems).toEqual([
      "SN_MAIN contracts differ from the listing",
    ]);
    expect((await checkAppManifest(app, { fetch: serve("", 404) })).problems).toEqual([
      "manifest answered HTTP 404",
    ]);
    expect((await checkAppManifest(app, { fetch: serve("<html>") })).problems).toEqual([
      "manifest is not JSON",
    ]);
    const down = async () => {
      throw new TypeError("network down");
    };
    expect((await checkAppManifest(app, { fetch: down })).problems).toEqual([
      "manifest could not be fetched",
    ]);
  });
});
