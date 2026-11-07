/**
 * Construction options for the official-SDK STRK20 service. Every seam here is
 * for timing, transport, or a test double; none of them changes what is signed.
 */

import type { submitInvokeTransaction } from "@bramble/starknet/rpc-submit";
import type { RpcProvider } from "starknet";
import type { Strk20FeeReference } from "../policy/fee-policy";
import type { Strk20MaturityStore } from "../policy/maturity";
import type { Strk20WaitBudgets, WaitScheduler } from "./official-sdk-budget";
import type { ServiceRetryPause } from "./official-sdk-retry";
import type { PrivacySdkRuntime } from "./official-sdk-runtime";

/** Options for `createOfficialStrk20Service`. */
export type OfficialServiceOptions = {
  /**
   * Independent price used only to bound a converted (non-STRK) relay fee.
   * Omitting it leaves the converted route refused; the STRK route never
   * consults it, because the pool's own charge bounds that one on-chain.
   */
  readonly feeReference?: Strk20FeeReference;
  readonly http?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readonly maturityStore?: Strk20MaturityStore;
  readonly nowSeconds?: () => number;
  readonly pauseForMaturity?: () => Promise<void>;
  readonly pauseForServiceRetry?: ServiceRetryPause;
  readonly providerFor?: (nodeUrl: string) => RpcProvider;
  readonly sdk: PrivacySdkRuntime;
  readonly submitInvoke?: typeof submitInvokeTransaction;
  /** Wall-clock ceilings per phase; see ./official-sdk-budget. */
  readonly waitBudgets?: Partial<Strk20WaitBudgets>;
  readonly waitForAccepted?: (provider: RpcProvider, transactionHash: string) => Promise<number>;
  /** Timer seam for the wait budgets; tests inject a manual scheduler. */
  readonly waitScheduler?: WaitScheduler;
};
