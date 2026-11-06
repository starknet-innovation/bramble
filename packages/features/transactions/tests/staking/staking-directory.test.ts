/**
 * The staking directory reader: Starkscan's page is untrusted, so every field
 * the wallet reads is bounded and checked, a malformed page is refused whole,
 * incomplete coverage is reported, null figures stay unknown, and only active
 * validators with an active pool for a tracked token are offered. Fixtures are
 * schema-derived, not live (see ../support/staking-directory-fixture).
 */
import { describe, expect, test } from "bun:test";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import {
  directoryEntries,
  isDirectoryCursor,
  parseStakingDirectoryPage,
  ppmPercent,
  type StakingDirectoryPage,
} from "../../src/staking/staking-directory";
import {
  DIRECTORY_BTC_TOKEN,
  directoryPage,
  directoryParts,
  directoryValidator,
} from "../support/staking-directory-fixture";

const A = "0x0a1";
const B = "0xb2";
const STRK = { address: STRK_TOKEN_ADDRESS, decimals: 18, symbol: "STRK" };
const BTC = { address: DIRECTORY_BTC_TOKEN, decimals: 8, symbol: "WBTC" };
const format = (raw: bigint, decimals: number) => `${raw}e-${decimals}`;

const parse = (page: unknown) => parseStakingDirectoryPage(page, "SN_MAIN");
const parsed = (page: unknown): StakingDirectoryPage => {
  const result = parse(page);
  if (!result) throw new Error("fixture page did not parse");
  return result;
};
const withValidator = (overrides: Readonly<Record<string, unknown>>) =>
  directoryPage([directoryValidator(A, overrides)]);

describe("parseStakingDirectoryPage", () => {
  test("reads a schema-shaped page, canonicalising addresses and keeping the order", () => {
    const page = parsed(
      directoryPage([directoryValidator(A), directoryValidator(B, { name: null })], {
        nextCursor: "opaque:cursor_1",
      }),
    );
    expect(page.coverage).toBe("prepared");
    expect(page.nextCursor).toBe("opaque:cursor_1");
    expect(page.validators.map((validator) => validator.staker)).toEqual(["0xa1", "0xb2"]);
    expect(page.validators[0]).toMatchObject({
      commissionPpm: 50_000,
      liveness30dPpm: 995_000,
      name: "Validator One",
      status: "active",
      website: "validator.example",
    });
    expect(page.validators[1]?.name).toBeNull();
  });

  test("null figures stay unknown, never zero", () => {
    const page = parsed(
      withValidator({
        commission: null,
        liveness30d: null,
        stake: [directoryParts.stake(STRK_TOKEN_ADDRESS, null)],
      }),
    );
    expect(page.validators[0]).toMatchObject({
      commissionPpm: null,
      delegated: [{ raw: null }],
      liveness30dPpm: null,
    });
  });

  test("reports coverage other than prepared as such", () => {
    for (const status of ["catching_up", "unavailable"] as const) {
      const page = directoryPage([directoryValidator(A)]);
      page["coverage"] = { ...(page["coverage"] as object), status };
      expect(parse(page)?.coverage).toBe(status);
    }
  });

  test("a website is only ever an https hostname", () => {
    const site = (website: unknown) => parse(withValidator({ website }))?.validators[0]?.website;
    expect(site("https://ok.example/path?x=1")).toBe("ok.example");
    for (const dropped of [
      "javascript:alert(1)",
      "http://plain.example",
      "data:text/html,hi",
      "https://user:pw@creds.example",
      "not a url",
    ]) {
      expect(site(dropped)).toBeNull();
    }
    expect(site(null)).toBeNull();
    // Over-long or not text at all rejects the page.
    expect(parse(withValidator({ website: `https://${"a".repeat(200)}.example` }))).toBeNull();
    expect(parse(withValidator({ website: 7 }))).toBeNull();
  });

  test("refuses the whole page on anything malformed or out of bounds", () => {
    const many = Array.from({ length: 51 }, (_, index) => directoryValidator(`0x${index + 1}`));
    const pools = Array.from({ length: 33 }, (_, index) =>
      directoryParts.pool(STRK_TOKEN_ADDRESS, `0x${index + 1}`),
    );
    const cases: readonly unknown[] = [
      null,
      [],
      directoryPage([directoryValidator(A)], { chainId: "SN_SEPOLIA" }),
      directoryPage([directoryValidator(A)], { source: "live" }),
      directoryPage([directoryValidator(A)], { coverage: { status: "done" } }),
      directoryPage([directoryValidator(A)], { coverage: null }),
      directoryPage([directoryValidator(A)], { nextCursor: "has space" }),
      directoryPage([directoryValidator(A)], { nextCursor: "c".repeat(1025) }),
      directoryPage([directoryValidator(A)], { items: {} }),
      directoryPage(many),
      directoryPage([directoryValidator(A), directoryValidator("0xa1")]),
      withValidator({ address: "0x0" }),
      withValidator({ address: "a1" }),
      withValidator({ address: `0x${"f".repeat(64)}` }),
      withValidator({ name: "n".repeat(65) }),
      withValidator({ name: "Evil\u202eName" }),
      withValidator({ name: "Line\nbreak" }),
      withValidator({ name: 5 }),
      withValidator({ status: "paused" }),
      withValidator({ commission: { denominatorRaw: "0", numeratorRaw: "0" } }),
      withValidator({ commission: { denominatorRaw: "10", numeratorRaw: "11" } }),
      withValidator({ commission: { denominatorRaw: "10", numeratorRaw: "-1" } }),
      withValidator({ commission: { denominatorRaw: "10", extra: 1, numeratorRaw: "1" } }),
      withValidator({ liveness30d: "99%" }),
      withValidator({ liveness30d: { denominatorRaw: "1".repeat(79), numeratorRaw: "1" } }),
      withValidator({ pools }),
      withValidator({ pools: [directoryParts.pool(STRK_TOKEN_ADDRESS, "0x5a3", "exiting")] }),
      withValidator({ pools: [directoryParts.pool("0xnope", "0x5a3")] }),
      withValidator({
        pools: [{ ...directoryParts.pool(STRK_TOKEN_ADDRESS, "0x5a3"), address: 1 }],
      }),
      withValidator({ pools: "none" }),
      withValidator({ stake: [directoryParts.stake(STRK_TOKEN_ADDRESS, "1.5")] }),
      withValidator({ stake: [directoryParts.stake("0x", "1")] }),
      withValidator({ stake: null }),
    ];
    for (const page of cases) expect(parse(page)).toBeNull();
  });

  test("tolerates fields it does not read, so an added Starkscan field is not an outage", () => {
    expect(parse(withValidator({ futureMetric: { anything: true } }))).not.toBeNull();
  });
});

describe("directoryEntries", () => {
  test("offers only active validators with an active pool for a tracked token", () => {
    const page = parsed(
      directoryPage([
        directoryValidator("0x1"),
        directoryValidator("0x2", { status: "inactive" }),
        directoryValidator("0x3", { status: "exiting" }),
        directoryValidator("0x4", { status: null }),
        directoryValidator("0x5", {
          pools: [directoryParts.pool(STRK_TOKEN_ADDRESS, "0x5a3", "retired")],
        }),
        directoryValidator("0x6", { pools: [directoryParts.pool("0x999", "0x5a3")] }),
        directoryValidator("0x7", { pools: [] }),
        directoryValidator("0x8", {
          pools: [
            directoryParts.pool(STRK_TOKEN_ADDRESS, "0x5a3", "retired"),
            directoryParts.pool(DIRECTORY_BTC_TOKEN, "0x5a4"),
          ],
          stake: [],
        }),
      ]),
    );
    const entries = directoryEntries(page, [STRK, BTC], format);
    expect(entries.map((entry) => entry.staker)).toEqual(["0x1", "0x8"]);
    expect(entries[0]?.pools).toEqual([
      { delegated: "1500000000000000000000e-18", symbol: "STRK" },
    ]);
    // A pool with no stake figure shows its total as unknown.
    expect(entries[1]?.pools).toEqual([{ delegated: null, symbol: "WBTC" }]);
    expect(directoryEntries(page, [], format)).toEqual([]);
  });

  test("formats figures for display and keeps unknown as null", () => {
    const page = parsed(
      directoryPage([
        directoryValidator("0x1"),
        directoryValidator("0x2", { commission: null, liveness30d: null }),
      ]),
    );
    const [known, unknown] = directoryEntries(page, [STRK], format);
    expect(known).toMatchObject({
      commission: "5%",
      uptime: "99.5%",
      website: "validator.example",
    });
    expect(unknown).toMatchObject({
      commission: null,
      commissionPpm: null,
      uptime: null,
      uptimePpm: null,
    });
  });

  test("percentages round down, so 99.996% never reads as 100%", () => {
    expect(ppmPercent(999_960)).toBe("99.99%");
    expect(ppmPercent(1_000_000)).toBe("100%");
    expect(ppmPercent(0)).toBe("0%");
    expect(ppmPercent(123_400)).toBe("12.34%");
  });
});

describe("isDirectoryCursor", () => {
  test("accepts bounded printable ASCII only", () => {
    expect(isDirectoryCursor("eyJhIjoxfQ==")).toBe(true);
    for (const bad of ["", " ", "a b", "\u00fc", "x".repeat(1025), 3, null]) {
      expect(isDirectoryCursor(bad)).toBe(false);
    }
  });
});
