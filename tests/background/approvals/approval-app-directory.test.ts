/**
 * App directory signals on pending approvals (mc-wallet issue 749): a listed
 * origin carries its listed name, a delisted one is warned about, and a listed
 * app calling a contract outside its listing is flagged. Every signal comes
 * from the queued origin and the background's own directory. Fixture domains
 * are reserved examples.
 */
import { describe, expect, test } from "bun:test";
import { createAppDirectory, type ListedApp } from "@bramble/permissions/app-directory";
import { memoryOriginHistory } from "@bramble/permissions/origin-history";
import {
  DELISTED_APP_WARNING,
  enrichApprovals,
  UNDECLARED_CONTRACT_WARNING,
} from "../../../apps/extension/src/background/approvals/approval-insights";
import type { PendingApproval } from "../../../apps/extension/src/background/approvals/approvals";

const listed = (origin: string, name: string, contracts: readonly string[]): ListedApp => ({
  audit: "https://audits.example.org/report.pdf",
  category: "defi",
  chains: { SN_MAIN: { contracts } },
  id: name.toLowerCase().replaceAll(" ", "-"),
  name,
  origin,
});

const directory = createAppDirectory(
  [
    listed("https://app.example.com", "Example DEX", ["0x123"]),
    // Listed in the fixture yet on the bundled blocklist: blocking wins.
    listed("https://starknet-airdrop.com", "Airdrop", ["0x1"]),
  ],
  ["https://old.example.com"],
);

const approval = (overrides: Partial<PendingApproval>): PendingApproval => ({
  id: "00000000-0000-4000-8000-000000000001",
  kind: "connect",
  origin: "https://app.example.com",
  ...overrides,
});

const invoke = (origin: string, contracts: readonly string[]): PendingApproval =>
  approval({
    callReviews: contracts.map((contractAddress) => ({
      calldata: [],
      contractAddress,
      entrypoint: "swap",
    })),
    context: {
      accountId: "SN_MAIN:0x1",
      chainId: "0x534e5f4d41494e",
      networkId: "SN_MAIN",
      payloadDigest: "0".repeat(64),
    },
    kind: "invoke",
    origin,
  });

const enrich = async (pending: PendingApproval): Promise<PendingApproval> => {
  const [result] = await enrichApprovals([pending], memoryOriginHistory(), undefined, directory);
  if (!result) throw new Error("no approval");
  return result;
};

describe("app directory approval signals", () => {
  test("a listed origin carries its listed name", async () => {
    expect((await enrich(approval({}))).listing).toBe("Example DEX");
  });

  test("an unlisted origin, a lookalike or another scheme carries none", async () => {
    for (const origin of [
      "https://other.example.com",
      "https://app.example.com.evil.io",
      "http://app.example.com",
    ]) {
      expect((await enrich(approval({ origin }))).listing).toBeUndefined();
    }
  });

  test("a blocked origin is never shown as listed", async () => {
    const result = await enrich(approval({ origin: "https://starknet-airdrop.com" }));
    expect(result.blocked).toBe(true);
    expect(result.listing).toBeUndefined();
  });

  test("a delisted origin is warned about, and its existing warnings stay", async () => {
    const result = await enrich(approval({ origin: "https://old.example.com" }));
    expect(result.listing).toBeUndefined();
    expect(result.insights?.[0]).toBe(DELISTED_APP_WARNING);
    expect(result.insights?.length).toBeGreaterThan(1);
  });

  test("a listed app calling an undeclared contract is flagged; a declared one is not", async () => {
    const clean = await enrich(invoke("https://app.example.com", ["0x0123"]));
    expect(clean.listing).toBe("Example DEX");
    expect(clean.insights).not.toContain(UNDECLARED_CONTRACT_WARNING);
    const stray = await enrich(invoke("https://app.example.com", ["0x123", "0xbad"]));
    expect(stray.listing).toBe("Example DEX");
    expect(stray.insights).toContain(UNDECLARED_CONTRACT_WARNING);
  });

  test("an unlisted origin's calls are not checked against any listing", async () => {
    const result = await enrich(invoke("https://other.example.com", ["0xbad"]));
    expect(result.insights).not.toContain(UNDECLARED_CONTRACT_WARNING);
  });

  test("the bundled directory, empty today, changes nothing", async () => {
    const [result] = await enrichApprovals([approval({})], memoryOriginHistory());
    expect(result?.listing).toBeUndefined();
    expect(result?.insights).not.toContain(DELISTED_APP_WARNING);
  });
});
