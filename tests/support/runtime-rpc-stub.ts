/**
 * Shared Starknet {@link RuntimeRpc} stub for the background-dispatcher suites.
 *
 * Every method returns a benign default so a test only has to spell out the
 * calls it actually exercises; pass `overrides` to replace individual methods
 * (for example to capture inputs or return a failure). `submitErc20Transfer`
 * and `submitInvokeTransaction` echo their inputs so a transfer/invoke assertion
 * sees the token and calls it submitted without any override.
 */
import type { RuntimeRpc } from "../../apps/extension/src/background/runtime/runtime-rpc";

/**
 * Builds a complete RuntimeRpc stub from the shared defaults, applying any
 * per-test method overrides last.
 */
export const makeRuntimeRpc = (overrides: Partial<RuntimeRpc> = {}): RuntimeRpc => ({
  async estimateDeclareFee() {
    return { overallFee: "1", unit: "FRI" };
  },
  async estimateInvokeFee() {
    return { overallFee: "1", unit: "FRI" };
  },
  async getDeploymentStatus() {
    return true;
  },
  async getNftOwner() {
    return "0x0";
  },
  async getTokenBalances() {
    return [];
  },
  async getTokenMetadata() {
    return { decimals: 18, name: "Ether", symbol: "ETH" };
  },
  async getTransactionStatuses() {
    return {};
  },
  async submitAccountDeployment() {
    return { transactionHash: "0x7de" };
  },
  async submitDeclareTransaction() {
    return { classHash: "0x1", transactionHash: "0x1" };
  },
  async submitErc20Transfer(input) {
    return {
      call: { calldata: [], contractAddress: input.token.address, entrypoint: "transfer" },
      transactionHash: "0x7ab",
    };
  },
  async submitInvokeTransaction(input) {
    return { calls: input.calls, transactionHash: "0x7cd" };
  },
  async verifyAccountClassHash() {
    // Benign default: report the account as undeployed so no suite implies a
    // verification result it did not set up. Suites that assert verification
    // override this per test.
    return { status: "undeployed" };
  },
  ...overrides,
});
