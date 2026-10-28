/**
 * The "Signed for relay" rows (issue 299) say only what each record proves,
 * never link a message hash to an explorer as if it were a transaction, escape
 * the site name, and sit outside the transaction feed so its filters, search
 * and counts never include them. The activity response accepts them only when
 * every row validates.
 */
import { describe, expect, test } from "bun:test";
import { account } from "@bramble/testkit/sidepanel";
import type { RelaySignature } from "@bramble/transactions/relay-signatures";
import { isActivityResponse, type WalletStatus } from "../../../../src/popup/responses/responses";
import { activityScreen } from "../../../../src/sidepanel/journeys/portfolio/activity-views";
import { relayRow, relaySection } from "../../../../src/sidepanel/journeys/portfolio/relay-rows";

const status: WalletStatus = {
  accountCount: 1,
  accounts: [account],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const relay = (overrides: Partial<RelaySignature> = {}): RelaySignature => ({
  accountId: account.id,
  callCount: 2,
  checkable: true,
  executeBefore: 1_900_000_000,
  messageHash: "0xabc",
  networkId: "SN_MAIN",
  nonce: "0x2a",
  origin: "https://app.example",
  revision: "2",
  signedAt: 1_800_000_000_000,
  status: "signed",
  ...overrides,
});

describe("relay rows", () => {
  test("a signed row is not seen on chain yet and can still be relayed", () => {
    const html = relayRow(relay());
    expect(html).toContain("https://app.example");
    expect(html).toContain("Not seen on chain");
    expect(html).toContain(
      "Not seen on chain yet. A relayer may still be able to submit it until it expires.",
    );
    expect(html).not.toContain("can still submit");
    expect(html).toContain("Valid until");
    expect(html).toContain("0xabc");
    expect(html).not.toContain("Network fee");
    // A message hash has no transaction page.
    expect(html).not.toContain("starkscan");
    expect(html).not.toContain("<a ");
  });

  test("a used nonce is reported as exactly that, never as this request executing", () => {
    const html = relayRow(relay({ status: "nonce-used" }));
    expect(html).toContain("Nonce used on chain");
    expect(html).toContain("Its nonce is used on chain, so this request can no longer run.");
    expect(html).toContain("confirm it was this request that ran.");
    expect(html).not.toMatch(/executed/i);
    expect(html).not.toContain("a relayer ran it");
  });

  test("two messages sharing a used nonce both read the same, neither claims it ran", () => {
    const rows = [
      relay({ messageHash: "0xa1", status: "nonce-used" }),
      relay({ messageHash: "0xb2", status: "nonce-used" }),
    ];
    const html = relaySection(rows);
    expect(html.match(/>Nonce used on chain</g)).toHaveLength(2);
    expect(html).not.toMatch(/executed/i);
  });

  test("an expired row says it can no longer run", () => {
    const html = relayRow(relay({ status: "expired" }));
    expect(html).toContain("Expired");
    expect(html).toContain("It passed its deadline unused and can no longer run.");
  });

  test("an untracked account type says so instead of implying a status", () => {
    const html = relayRow(relay({ checkable: false }));
    expect(html).toContain("Not tracked");
    expect(html).toContain("check relayed requests for this account type.");
    expect(html).not.toContain("Not seen on chain");
  });

  test("a message without a deadline shows no expiry", () => {
    const { executeBefore: _deadline, ...open } = relay();
    const html = relayRow(open);
    expect(html).toContain("Not seen on chain yet. A relayer may still be able to submit it.");
    expect(html).not.toContain("can still submit");
    expect(html).not.toContain("Valid until");
  });

  test("escapes the site name", () => {
    const html = relayRow(relay({ origin: "https://x.example/<script>" }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("shows the signed network fee", () => {
    const html = relayRow(relay({ userFee: { amount: "1000", decimals: 6, token: "USDC" } }));
    expect(html).toContain("Network fee");
    expect(html).toContain("0.001 USDC");
  });

  test("renders no section without records", () => {
    expect(relaySection([])).toBe("");
  });

  test("the section sits outside the filtered transaction feed", () => {
    const html = activityScreen([], status, [], false, null, undefined, null, [], [relay()]);
    const section = html.indexOf("Signed for relay");
    expect(section).toBeGreaterThan(-1);
    expect(html.indexOf('id="activity-feed"')).toBe(-1);
    expect(activityScreen([], status, [], false)).not.toContain("Signed for relay");
  });
});

describe("activity response relays", () => {
  test("accepts valid relay rows and rejects an invalid one", () => {
    expect(isActivityResponse({ activity: [], ok: true, relays: [relay()] })).toBe(true);
    expect(isActivityResponse({ activity: [], ok: true, relays: [] })).toBe(true);
    expect(
      isActivityResponse({ activity: [], ok: true, relays: [relay({ status: "done" as never })] }),
    ).toBe(false);
    expect(isActivityResponse({ activity: [], ok: true, relays: "nope" })).toBe(false);
  });
});
