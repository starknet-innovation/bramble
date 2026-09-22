/**
 * What a review quotes when the account does not exist on chain yet.
 *
 * Creating the account and sending are two transactions and the user pays for
 * both, so the review leads with one total — quoting the transaction alone
 * understates what leaves the account, and quoting two figures asks the user to
 * add them up. The deployment share is still named, because an account being
 * created is not a detail to hide.
 */
import { describe, expect, test } from "bun:test";
import { reviewFeeSection } from "@bramble/wallet-ui/lab";
import type { WalletStatus } from "../../../src/popup/responses/responses";
import { homeScreen } from "../../../src/sidepanel/journeys/portfolio/home-view";
import { securityFlow } from "../../../src/sidepanel/journeys/settings/settings-views";

const status = {
  accountCount: 1,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
} as unknown as WalletStatus;

const fee = (overallFee: string) => ({ overallFee, unit: "FRI" as const });

const render = (state: Parameters<typeof reviewFeeSection>[0]): string =>
  reviewFeeSection(state, { id: "retry" });

describe("undeployed-account fee review", () => {
  test("leads with the total of both transactions", () => {
    const html = render({
      deploymentFee: fee("28335000000000000"),
      fee: fee("31929000000000000"),
      feeEstimateFailed: false,
      requiresDeployment: true,
    });

    // 0.028335 + 0.031929 = 0.060264 STRK, the figure the account actually pays.
    expect(html).toContain("Estimated fee: 0.060264 STRK");
    expect(html).toContain("Creating this account on Starknet is 0.028335 STRK of that");
    // The old two-line pair, which read as if the transaction fee were the whole cost.
    expect(html).not.toContain("Estimated transaction fee");
    expect(html).not.toContain("Estimated account deployment fee");
  });

  test("says a device will sign twice, when it is a device that signs", () => {
    const state = {
      deploymentFee: fee("1000"),
      fee: fee("2000"),
      feeEstimateFailed: false,
      requiresDeployment: true,
    };

    expect(render(state)).not.toContain("Ledger");
    expect(render({ ...state, signsTwice: true })).toContain("and your Ledger asks to sign both");
  });

  test("a deployed account still reads as one plain fee", () => {
    const html = render({
      fee: fee("31929000000000000"),
      feeEstimateFailed: false,
      requiresDeployment: false,
    });

    expect(html).not.toContain("Creating this account");
    expect(html).toContain("0.031929 STRK");
  });

  test("names a missing component instead of quoting a partial total", () => {
    const html = render({
      deploymentFee: null,
      deploymentFeeEstimateFailed: true,
      fee: fee("2000"),
      feeEstimateFailed: false,
      requiresDeployment: true,
    });

    expect(html).toContain("Couldn't estimate");
    expect(html).not.toContain("Estimated fee:");
  });

  test("deploying is a setting, not a flag on Home", () => {
    // Home used to carry a danger-coloured "Deploy account" chip. An account
    // that is not on chain yet is normal — the first send creates it and the
    // review quotes both halves — so the shortcut moved to Security &
    // permissions, where a user who wants to deploy first can find it.
    const settings = securityFlow(status);

    expect(settings).toContain('data-view="deploy-account"');
    expect(settings).toContain("Deploy account");
    expect(settings).toContain("created on Starknet by its first send");
    const home = homeScreen(
      status,
      { address: "0x1", derivation: { kind: "imported-raw-key" } } as never,
      { balances: [] } as never,
      0,
      false,
      null,
      {},
      {},
      "usd",
      { error: null, loading: false, value: null },
    );
    expect(home).not.toContain("deploy-chip");
    expect(home).not.toContain("Deploy account");
  });
});
