/**
 * Approval-card rendering: the activity screen renders an invoke approval with
 * its decoded call summaries and risk flags (A-H1), and a watch-asset approval
 * surfaces phishing insights and disables its Add button when the origin is
 * blocked (A-L1).
 */
import { describe, expect, test } from "bun:test";
import { account, preferences } from "@bramble/testkit/sidepanel";
import type { PendingApproval, WalletStatus } from "../../../../src/popup/responses/responses";
import { dashboard } from "../../../../src/sidepanel/app/screens/views";

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

const INVOKE_ID = "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14";
const WATCH_ID = "c92d6ee2-64aa-4c8c-b282-1a1b19f1aa25";

const activity = (pending: readonly PendingApproval[]): string =>
  dashboard("activity", status, pending, preferences, { balances: [] });

describe("invoke approval card (A-H1)", () => {
  const invoke: PendingApproval = {
    callReviews: [
      {
        calldata: ["0x0005", "0x3e8", "0x0"],
        contractAddress: "0x049d36570d4e46f8",
        entrypoint: "transfer",
      },
    ],
    flags: [{ code: "unknown-contract", message: "Verify the contract before continuing." }],
    id: INVOKE_ID,
    kind: "invoke",
    origin: "https://dapp.example",
    summaries: ["Send 1000 units to 0x0005…0005"],
  };

  test("renders decoded call summaries, risk flags, and decision buttons", () => {
    const html = activity([invoke]);

    expect(html).toContain("Transaction request");
    expect(html).toContain("https://dapp.example");
    expect(html).toContain("Send 1000 units to 0x0005…0005");
    expect(html).toContain("Verify the contract before continuing.");
    expect(html).toContain("Exact call parameters");
    expect(html).toContain("0x049d36570d4e46f8");
    expect(html).toContain("0x0005, 0x3e8, 0x0");
    expect(html).toContain(`data-approval-action="approve" data-approval-id="${INVOKE_ID}"`);
    expect(html).toContain(`data-approval-action="deny" data-approval-id="${INVOKE_ID}"`);
  });

  test("disables approve while the wallet is locked", () => {
    const locked = dashboard("activity", { ...status, locked: true }, [invoke], preferences, {
      balances: [],
    });
    expect(locked).toContain(`data-approval-id="${INVOKE_ID}" type="button" disabled`);
  });
});

describe("watch-asset approval card insights (A-L1)", () => {
  test("renders insights and disables Add for a blocked origin", () => {
    const blocked: PendingApproval = {
      blocked: true,
      id: WATCH_ID,
      insights: ["This domain is on the wallet blocklist of known phishing and scam sites."],
      kind: "watch-asset",
      origin: "https://starknet-airdrop.com",
      token: {
        address: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
        decimals: 6,
        name: "USD Coin",
        networkId: "SN_MAIN",
        symbol: "USDC",
      },
    };
    const html = activity([blocked]);

    expect(html).toContain("This domain is on the wallet blocklist");
    expect(html).toContain(`data-approval-id="${WATCH_ID}" type="button" disabled`);
  });
});

// The fee review renders on the invoke card in every wallet state: a locked
// wallet still shows the fee estimated at queue time (no passphrase is ever
// needed merely to display a fee), and a failed estimate offers a retry while
// approval stays disabled (#189).
describe("invoke approval card fee review (#189)", () => {
  const withFee: PendingApproval = {
    fee: { overallFee: "2500000000000000", unit: "FRI" },
    feeEstimateFailed: false,
    id: INVOKE_ID,
    kind: "invoke",
    origin: "https://dapp.example",
    requiresDeployment: false,
    summaries: ["Send 1000 units to 0x0005…0005"],
  };

  test("renders the estimated fee in the card", () => {
    expect(activity([withFee])).toContain("Estimated fee: 0.0025 STRK");
  });

  test("still renders the queued fee while the wallet is locked", () => {
    const locked = dashboard("activity", { ...status, locked: true }, [withFee], preferences, {
      balances: [],
    });
    expect(locked).toContain("Estimated fee: 0.0025 STRK");
    expect(locked).toContain(`data-approval-id="${INVOKE_ID}" type="button" disabled`);
  });

  test("a failed estimate offers retry and keeps Approve disabled", () => {
    const failed: PendingApproval = { ...withFee, fee: null, feeEstimateFailed: true };
    const html = activity([failed]);

    expect(html).toContain("Couldn't estimate the network fee right now.");
    expect(html).toContain(`data-approval-retry-fee="${INVOKE_ID}"`);
    expect(html).toContain(
      `data-approval-action="approve" data-approval-id="${INVOKE_ID}" type="button" disabled`,
    );
  });

  test("a pending estimate is visible and prevents approval until review is complete", () => {
    const pending: PendingApproval = {
      ...withFee,
      fee: null,
      feeEstimatePending: true,
    };
    const html = activity([pending]);

    expect(html).toContain("Estimating network fee…");
    expect(html).toContain(
      `data-approval-action="approve" data-approval-id="${INVOKE_ID}" type="button" disabled`,
    );
  });

  test("an undeployed account reuses the Send wording instead of a fee amount", () => {
    const undeployed: PendingApproval = { ...withFee, fee: null, requiresDeployment: true };
    expect(activity([undeployed])).toContain(
      "The network fee is estimated once this account is deployed.",
    );
  });
});

// An OutsideExecution sign card lists the calls it authorizes and the same risk
// flags an invoke card shows, all escaped (audit 144).
describe("OutsideExecution sign card (audit 144)", () => {
  const SIGN_ID = "d03e7ff3-75bb-4d9d-a393-2b2c2a2a2b36";
  const sign: PendingApproval = {
    flags: [{ code: "unlimited-approval", message: "Unlimited <b>approval</b> for 0xabc…" }],
    id: SIGN_ID,
    kind: "sign-typed-data",
    origin: "https://dapp.example",
    summaries: ["OutsideExecution · Account.execute_from_outside", "Allow <i>0xabc</i> to spend"],
    typedData: { message: {}, primaryType: "Mail" },
  };

  test("renders decoded call summaries and risk flags, escaped", () => {
    const html = activity([sign]);
    expect(html).toContain("Sign request");
    expect(html).toContain("Allow &lt;i&gt;0xabc&lt;/i&gt; to spend");
    expect(html).toContain("Unlimited &lt;b&gt;approval&lt;/b&gt; for 0xabc…");
    expect(html).not.toContain("<i>0xabc</i>");
    expect(html).not.toContain("<b>approval</b>");
  });

  test("a plain message lists no calls", () => {
    const html = activity([
      {
        id: SIGN_ID,
        kind: "sign-typed-data",
        origin: sign.origin,
        summaries: ["Mail · Example"],
        typedData: sign.typedData,
      },
    ]);
    expect(html).not.toContain(`class="review-calls"`);
  });
});

// The add-token card says when a token borrows a known ticker (audit 171).
describe("watch-asset spoof warning (audit 171)", () => {
  const token = {
    address: "0x0bad00000000000000000000000000000000000000000000000000000000001",
    decimals: 6,
    name: "USD <b>Coin</b>",
    networkId: "SN_MAIN" as const,
    symbol: "USDC",
  };
  const watch: PendingApproval = {
    id: WATCH_ID,
    kind: "watch-asset",
    origin: "https://dapp.example",
    token,
  };

  test("warns on a ticker spoof and escapes token text", () => {
    const html = activity([watch]);
    expect(html).toContain("This token uses the ticker of a different, known token contract.");
    expect(html).toContain("If added, it stays hidden until you show it.");
    expect(html).toContain("USD &lt;b&gt;Coin&lt;/b&gt;");
    expect(html).not.toContain("<b>Coin</b>");
  });

  test("raises no warning for the curated contract", () => {
    const html = activity([
      {
        ...watch,
        token: {
          ...token,
          address: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
          name: "USD Coin",
        },
      },
    ]);
    expect(html).not.toContain("ticker of a different");
  });
});
