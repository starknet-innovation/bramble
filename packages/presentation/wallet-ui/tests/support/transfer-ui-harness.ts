/**
 * Shared harness for the sidepanel transfer/activity UI suites: a fragment
 * paint helper, a real-macrotask flush that survives setTimeout stubbing, and
 * the instrumented sidepanel wallet stub both suites steer per branch. Test
 * support only — never imported by production code.
 */

import { account } from "@mc-wallet/testkit/sidepanel";
import type { WalletStatus } from "../../src/popup/responses/responses";

const originalSetTimeout = globalThis.setTimeout;

/**
 * Flushes queued promise jobs on a real macrotask, independent of any
 * immediate setTimeout stub a test installs for the code under test.
 */
export const flush = (): Promise<void> =>
  new Promise((resolve) => originalSetTimeout(resolve as () => void, 0));

/**
 * Replaces a container's children from markup without assigning markup as a
 * property, matching the shared harness's fragment-based paint.
 */
export const paint = (host: HTMLElement, markup: string): void => {
  host.replaceChildren(document.createRange().createContextualFragment(markup));
};

/** Wallet status fixture matching the shared `account` sidepanel fixture. */
export const walletStatus: WalletStatus = {
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

/**
 * Per-method invocation counters recorded by the `makeWallet` stub.
 *
 * The three pool-route preparations are recorded with their arguments, not just
 * counted: the recipient the panel hands a preparation is the recipient the
 * background applies its recipient policy to, so a route that dropped or
 * substituted it would be exactly the parity gap MCW-V09-109 describes.
 */
export type WalletCalls = {
  preparePrivacyDeposit: unknown[][];
  preparePrivacyTransfer: unknown[][];
  preparePrivacyWithdraw: unknown[][];
  reviewTransfer: unknown[][];
  submitTransfer: unknown[][];
  loadStatus: number;
  loadActivity: number;
  loadDeploymentStatus: number;
};

const feeReview = {
  fee: { overallFee: "1000", unit: "FRI" },
  feeEstimateFailed: false,
  flags: [],
  requiresDeployment: false,
  summaries: ["Transfer 1 ETH"],
};

// A benign preparation, shaped like the one-time record the background mints.
// Tests that need a refusal override the matching method with a rejection
// carrying the verifier's wording, which is what the background really returns.
const poolPreparation = {
  amount: "1",
  id: "prep-1",
  poolFeeFri: "0",
  recipient: "0x0",
  summary: "Private send",
  token: { id: "SN_MAIN:ETH", symbol: "ETH" },
};

/**
 * Builds the instrumented sidepanel wallet stub. Every method resolves a
 * benign fixture and records its calls; tests override individual methods to
 * steer failure branches. The stub never touches real wallet state.
 */
export const makeWallet = (
  overrides: Record<string, unknown> = {},
): { calls: WalletCalls; wallet: Record<string, unknown> } => {
  const calls: WalletCalls = {
    loadActivity: 0,
    loadDeploymentStatus: 0,
    loadStatus: 0,
    preparePrivacyDeposit: [],
    preparePrivacyTransfer: [],
    preparePrivacyWithdraw: [],
    reviewTransfer: [],
    submitTransfer: [],
  };
  const wallet = {
    async loadActivity() {
      calls.loadActivity += 1;
      return {
        entries: [
          {
            accountId: account.id,
            hash: "0xdeadbeef",
            kind: "transfer",
            networkId: "SN_MAIN",
            status: "accepted",
            submittedAt: 1,
            summary: "Sent 1 ETH",
          },
        ],
        historyUnavailable: false,
      };
    },
    async loadDeploymentStatus() {
      calls.loadDeploymentStatus += 1;
      return { accountId: account.id, deployed: true, ok: true };
    },
    async loadPreferences() {
      // Present so a suite that drives a route reading preferences gets a
      // benign fixture rather than an undefined stub; no address book means no
      // trusted set, so no recipient rule fires by accident.
      return { activeNetworkId: "SN_MAIN", addressBook: [], schemaVersion: 1, tokens: [] };
    },
    async loadStatus() {
      calls.loadStatus += 1;
      return walletStatus;
    },
    async preparePrivacyDeposit(...args: unknown[]) {
      calls.preparePrivacyDeposit.push(args);
      return poolPreparation;
    },
    async preparePrivacyTransfer(...args: unknown[]) {
      calls.preparePrivacyTransfer.push(args);
      return poolPreparation;
    },
    async preparePrivacyWithdraw(...args: unknown[]) {
      calls.preparePrivacyWithdraw.push(args);
      return poolPreparation;
    },
    async reviewTransfer(...args: unknown[]) {
      calls.reviewTransfer.push(args);
      return feeReview;
    },
    async submitTransfer(...args: unknown[]) {
      calls.submitTransfer.push(args);
      return "0xdeadbeef";
    },
    ...overrides,
  };
  return { calls, wallet };
};
