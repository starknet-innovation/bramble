/**
 * The app directory schema and lookups (mc-wallet issue 749). The bundled data
 * test is the CI schema check: a listing PR whose entry breaks a rule fails
 * here. Fixtures use reserved example domains; no real app is listed by a test.
 */
import { describe, expect, test } from "bun:test";
import {
  APP_DIRECTORY,
  appDirectoryErrors,
  createAppDirectory,
  exactHttpsOrigin,
  type ListedApp,
} from "@bramble/permissions/app-directory";
import { LISTED_APPS, REVOKED_APPS } from "../src/app-directory-data";

const app = (overrides: Partial<ListedApp> = {}): ListedApp => ({
  audit: "https://audits.example.org/dex.pdf",
  category: "defi",
  chains: { SN_MAIN: { contracts: ["0x123", "0x456"] }, SN_SEPOLIA: { contracts: ["0x789"] } },
  id: "example-dex",
  name: "Example DEX",
  origin: "https://app.example.com",
  ...overrides,
});

const errorsFor = (entry: ListedApp): readonly string[] => appDirectoryErrors([entry], []);

describe("bundled app directory", () => {
  test("every bundled entry and revoked origin passes the schema", () => {
    expect(appDirectoryErrors(LISTED_APPS, REVOKED_APPS)).toEqual([]);
  });

  test("the bundled lookups load", () => {
    expect(APP_DIRECTORY.appsFor("SN_MAIN")).toEqual(
      [...LISTED_APPS].filter((entry) => entry.chains.SN_MAIN !== undefined),
    );
  });
});

describe("exactHttpsOrigin", () => {
  test("accepts an exact https origin, with or without a port", () => {
    expect(exactHttpsOrigin("https://app.example.com")).toBe("https://app.example.com");
    expect(exactHttpsOrigin("https://app.example.com:8443")).toBe("https://app.example.com:8443");
  });

  test("refuses other schemes, paths, queries, credentials, wildcards and junk", () => {
    for (const value of [
      "http://app.example.com",
      "https://app.example.com/",
      "https://app.example.com/swap",
      "https://app.example.com?x=1",
      "https://app.example.com#top",
      "https://user@app.example.com",
      "https://*.example.com",
      "https://app.example.com.",
      "app.example.com",
      "",
    ]) {
      expect(exactHttpsOrigin(value)).toBeNull();
    }
  });
});

describe("appDirectoryErrors", () => {
  test("a well-formed entry has no errors", () => {
    expect(errorsFor(app())).toEqual([]);
  });

  test("rejects a malformed id, name, category or audit link", () => {
    expect(errorsFor(app({ id: "Example DEX" })).join()).toContain("id must be a lowercase slug");
    expect(errorsFor(app({ name: "" })).join()).toContain("name must be");
    expect(errorsFor(app({ name: " Example" })).join()).toContain("name must be");
    expect(errorsFor(app({ name: "x".repeat(41) })).join()).toContain("name must be");
    expect(errorsFor(app({ category: "casino" as ListedApp["category"] })).join()).toContain(
      "unknown category",
    );
    expect(errorsFor(app({ audit: "http://audits.example.org" })).join()).toContain("audit");
  });

  test("rejects a non-https, non-canonical or path origin", () => {
    for (const origin of [
      "https://app.example.com:443",
      "http://app.example.com",
      "https://APP.example.com",
      "https://app.example.com/",
    ]) {
      expect(errorsFor(app({ origin })).join()).toContain("origin must be an exact https origin");
    }
  });

  test("rejects non-felt, zero, non-canonical and repeated contracts", () => {
    const withContracts = (contracts: readonly string[]): readonly string[] =>
      errorsFor(app({ chains: { SN_MAIN: { contracts } } }));
    expect(withContracts(["0xnope"]).join()).toContain("not a canonical non-zero felt");
    expect(withContracts(["0x0"]).join()).toContain("not a canonical non-zero felt");
    expect(withContracts(["0x0123"]).join()).toContain("not a canonical non-zero felt");
    expect(withContracts(["0x123", "0x123"]).join()).toContain("repeats a contract");
    expect(withContracts([]).join()).toContain("declares no contract");
  });

  test("rejects an entry with no network or an unknown one", () => {
    expect(errorsFor(app({ chains: {} })).join()).toContain("declares no network");
    const devnet = { SN_DEVNET: { contracts: ["0x1"] } } as unknown as ListedApp["chains"];
    expect(errorsFor(app({ chains: devnet })).join()).toContain("unknown network SN_DEVNET");
  });

  test("rejects duplicate ids and duplicate origins", () => {
    const other = app({ id: "other", name: "Other" });
    expect(appDirectoryErrors([app(), other], []).join()).toContain(
      "duplicate origin https://app.example.com",
    );
    const sameId = app({ origin: "https://other.example.com" });
    expect(appDirectoryErrors([app(), sameId], []).join()).toContain("duplicate id example-dex");
  });

  test("rejects a revoked origin that is malformed, repeated or still listed", () => {
    expect(appDirectoryErrors([], ["http://old.example.com"]).join()).toContain(
      "is not an exact https origin",
    );
    expect(appDirectoryErrors([app()], ["https://app.example.com"]).join()).toContain(
      "is still listed",
    );
    expect(
      appDirectoryErrors([], ["https://old.example.com", "https://old.example.com"]).join(),
    ).toContain("repeated");
  });
});

describe("createAppDirectory", () => {
  const directory = createAppDirectory(
    [
      app(),
      app({
        chains: { SN_SEPOLIA: { contracts: ["0x1"] } },
        id: "alpha",
        name: "Alpha",
        origin: "https://alpha.example.com",
      }),
    ],
    ["https://old.example.com"],
  );

  test("invalid data lists nothing but still warns on well-formed delistings", () => {
    const broken = createAppDirectory(
      [app(), app({ id: "bad", name: "Bad", origin: "http://bad.example.com" })],
      ["https://old.example.com"],
    );
    expect(broken.listing("https://app.example.com")).toBeUndefined();
    expect(broken.appsFor("SN_MAIN")).toEqual([]);
    // A broken listing must not silence a well-formed delisting.
    expect(broken.revoked("https://old.example.com")).toBe(true);
  });

  test("matches an origin exactly, never a lookalike, suffix or other scheme", () => {
    expect(directory.listing("https://app.example.com")?.id).toBe("example-dex");
    expect(directory.listing("https://app.example.com/")).toBeUndefined();
    expect(directory.listing("https://APP.example.com")?.id).toBe("example-dex");
    expect(directory.listing("https://app.example.com.evil.io")).toBeUndefined();
    expect(directory.listing("https://app.example.com.")).toBeUndefined();
    expect(directory.listing("https://user@app.example.com")).toBeUndefined();
    expect(directory.listing("https://evil-app.example.com")).toBeUndefined();
    expect(directory.listing("http://app.example.com")).toBeUndefined();
    expect(directory.listing("https://app.example.com:8443")).toBeUndefined();
    expect(directory.listing("not an origin")).toBeUndefined();
  });

  test("lists only apps declaring the network, by name", () => {
    expect(directory.appsFor("SN_MAIN").map((entry) => entry.id)).toEqual(["example-dex"]);
    expect(directory.appsFor("SN_SEPOLIA").map((entry) => entry.id)).toEqual([
      "alpha",
      "example-dex",
    ]);
    expect(directory.appsFor("SN_DEVNET")).toEqual([]);
  });

  test("knows revoked origins exactly", () => {
    expect(directory.revoked("https://old.example.com")).toBe(true);
    expect(directory.revoked("https://old.example.com.evil.io")).toBe(false);
    expect(directory.revoked("https://app.example.com")).toBe(false);
    expect(directory.revoked("junk")).toBe(false);
  });

  test("names the called contracts a listing does not declare on that network", () => {
    expect(
      directory.undeclaredContracts("https://app.example.com", "SN_MAIN", ["0x123", "0x0456"]),
    ).toEqual([]);
    expect(
      directory.undeclaredContracts("https://app.example.com", "SN_MAIN", [
        "0x123",
        "0xabc",
        "0xABC",
      ]),
    ).toEqual(["0xabc"]);
    expect(
      directory.undeclaredContracts("https://app.example.com", "SN_SEPOLIA", ["0x123"]),
    ).toEqual(["0x123"]);
    expect(
      directory.undeclaredContracts("https://unlisted.example.com", "SN_MAIN", ["0xabc"]),
    ).toEqual([]);
  });
});
