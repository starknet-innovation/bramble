/**
 * Shared harness for the sidepanel transfer/activity UI suites: a fragment
 * paint helper, a real-macrotask flush that survives setTimeout stubbing, and
 * the instrumented sidepanel wallet stub both suites steer per branch. Test
 * support only — never imported by production code.
 */
import type { WalletStatus } from "../../src/popup/responses";
import { account } from "./sidepanel-fixtures";

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

/** Per-method invocation counters recorded by the `makeWallet` stub. */
export type WalletCalls = {
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
    async loadStatus() {
      calls.loadStatus += 1;
      return walletStatus;
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
