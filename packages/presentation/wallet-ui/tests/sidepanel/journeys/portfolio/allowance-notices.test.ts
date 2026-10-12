/**
 * The Allowances screen states what a listing could not vouch for, so a
 * partial or failed reading never reads as "nothing outstanding"
 * (Sherlock 181, 183, 190).
 */
import { describe, expect, test } from "bun:test";
import { account, preferences } from "@bramble/testkit/sidepanel";
import type { AllowanceView } from "@bramble/transactions/allowance-discovery";
import {
  type AllowanceListing,
  allowanceListingFrom,
  type WalletStatus,
} from "../../../../src/popup/responses/responses";
import { emptyRenderCache } from "../../../../src/sidepanel/app/rendering/render-cache";
import { allowancesFlow } from "../../../../src/sidepanel/journeys/portfolio/allowance-views";

const status: WalletStatus = {
  accountCount: 1,
  accounts: [account],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Sepolia",
  networkId: account.networkId,
  networks: [{ id: account.networkId, name: "Starknet Sepolia" }],
  ready: true,
};
const row: AllowanceView = {
  accountId: account.id,
  amount: "1000",
  id: `${account.id}:0x123:0xabc`,
  networkId: account.networkId,
  source: "wallet",
  spender: "0xabc",
  token: "0x123",
};
const render = (listing: Partial<AllowanceListing>): string =>
  allowancesFlow(
    status,
    account,
    { entries: [], notices: [], unavailable: false, ...listing },
    preferences,
  );

const EMPTY = "No outstanding allowances found for this account.";

describe("allowance listing notices", () => {
  test("before the first answer it claims neither a count nor none found", () => {
    const html = render(emptyRenderCache().allowances);
    expect(html).toContain("Loading allowances…");
    expect(html).not.toContain(EMPTY);
    expect(html).not.toContain("0 outstanding");
    expect(html).not.toContain("Not loaded");
  });

  test("a failed listing says it could not be loaded instead of none found", () => {
    const html = render({ unavailable: true });
    expect(html).toContain("Allowances could not be loaded. Refresh to try again.");
    expect(html).not.toContain(EMPTY);
    expect(html).toContain("Not loaded");
    expect(html).not.toContain("0 outstanding");
  });

  test("an incomplete scan is stated above the empty line", () => {
    const html = render({ notices: ["scan-incomplete"] });
    expect(html).toContain(
      "This list may be incomplete. Some older approvals on your tokens could not be checked.",
    );
    expect(html.indexOf("may be incomplete")).toBeLessThan(html.indexOf(EMPTY));
  });

  test("an unread multisig and a full log are each stated, with rows still listed", () => {
    const html = render({ entries: [row], notices: ["multisig-unread", "retention-full"] });
    expect(html).toContain(
      "A watched multisig could not be read, so approvals it granted may be missing.",
    );
    expect(html).toContain(
      "This wallet keeps 50 approvals per account and drops the smallest first, so some may be missing.",
    );
    expect(html).toContain("1 outstanding");
  });

  test("a row with a revoke pending says so and keeps its revoke control", () => {
    const html = render({ entries: [{ ...row, revoking: true }] });
    expect(html).toContain("Revoke sent. It stays listed until the network confirms it.");
    expect(html).toContain(`data-revoke-allowance="${row.id}"`);
    expect(render({ entries: [row] })).not.toContain("Revoke sent");
  });

  test("a complete listing shows no notice", () => {
    expect(render({ entries: [row] })).not.toContain("allowance-notice");
  });
});

describe("allowance listing from the background", () => {
  test("carries notices, and reads an error as unavailable rather than empty", () => {
    expect(
      allowanceListingFrom({ allowances: [row], notices: ["scan-incomplete"], ok: true }),
    ).toEqual({ entries: [row], notices: ["scan-incomplete"], unavailable: false });
    expect(allowanceListingFrom({ error: "multisig read failed" })).toEqual({
      entries: [],
      notices: [],
      unavailable: true,
    });
  });

  test("refuses an unknown or repeated notice", () => {
    for (const notices of [["all-clear"], ["scan-incomplete", "scan-incomplete"], "scan"]) {
      expect(allowanceListingFrom({ allowances: [], notices, ok: true }).unavailable).toBe(true);
    }
  });
});
