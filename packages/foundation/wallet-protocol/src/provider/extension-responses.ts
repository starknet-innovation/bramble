/**
 * Shared wire DTOs emitted by the privileged background and parsed again by
 * extension presentation surfaces. These are shapes only: consumers must
 * still validate unknown runtime messages before trusting them.
 */

import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import type { Strk20Action, Strk20WithdrawAction } from "../privacy/strk20";
import type { FeeEstimate } from "../transactions/fee-estimate";
import type { ProviderInvokeCall } from "../transactions/invoke";

/**
 * Every approval kind that may cross the background-to-UI boundary.
 */
export type ApprovalKind =
  | "add-chain"
  | "connect"
  | "declare"
  | "invoke"
  | "sign-typed-data"
  | "strk20-balances"
  | "strk20-invoke"
  | "strk20-prepare"
  | "strk20-register"
  | "strk20-subaccount"
  | "switch-chain"
  | "watch-asset";

/**
 * Exact account/network/payload identity frozen into an approval.
 */
export type ApprovalContext = {
  readonly accountId: string;
  readonly chainId: string;
  readonly networkId: StarknetNetworkId;
  readonly payloadDigest: string;
};

/**
 * Display-safe risk flag returned with a reviewed approval.
 */
export type ApprovalRiskFlag = {
  readonly code: string;
  readonly message: string;
};

/**
 * Display-safe declaration facts; the contract class never crosses this wire.
 */
export type DeclarationReview = {
  readonly abiEntryCount: number;
  readonly accountDeployment: "deployed" | "undeployed" | "unknown";
  readonly classHash?: string;
  readonly compiledClassHash: string;
  readonly deploymentFee: FeeEstimate | null;
  readonly deploymentFeeEstimateFailed: boolean;
  readonly entryPointCount: number;
  readonly fee: FeeEstimate | null;
  readonly feeEstimateFailed: boolean;
  readonly sierraProgramLength: number;
};

/**
 * ERC-20 metadata carried by a watch-asset approval.
 */
export type WatchAssetToken = {
  readonly address: string;
  readonly decimals: number;
  readonly name: string;
  readonly networkId: StarknetNetworkId;
  readonly symbol: string;
};

/**
 * Trusted token identity referenced by a decoded approval summary. The
 * background supplies the address alongside the symbol so presentation can
 * show the bundled mark without inferring token identity from display copy.
 */
export type ApprovalReviewAsset = {
  readonly address: string;
  readonly symbol: string;
};

/**
 * One display-only approval snapshot returned by the background.
 */
export type PendingApproval = {
  readonly actionReviews?: readonly Strk20Action[];
  readonly blocked?: boolean;
  /** Exact, display-only invoke calls retained beside decoded summaries. */
  readonly callReviews?: readonly ProviderInvokeCall[];
  readonly context?: ApprovalContext;
  readonly declaration?: DeclarationReview;
  /**
   * Invoke only: the account is an undeployed Braavos counterfactual, which
   * deploys only through its own reviewed step, so this request cannot be
   * approved until it is deployed. Present only when true, with no fee.
   */
  readonly deployFirst?: true;
  /**
   * Connect only: the site already holds a grant, so approving adds the
   * reviewed account to it rather than sharing a first one. Absent when the
   * queue could not tell (a locked wallet at request time).
   */
  readonly existingGrant?: boolean;
  readonly fee?: FeeEstimate | null;
  readonly feeAffordability?: "insufficient" | "ok" | "unknown";
  readonly feeEstimateFailed?: boolean;
  readonly feeEstimatePending?: boolean;
  readonly flags?: readonly ApprovalRiskFlag[];
  readonly id: string;
  readonly insights?: readonly string[];
  readonly kind: ApprovalKind;
  readonly origin: string;
  readonly relayFeeAction?: Strk20WithdrawAction;
  readonly reviewAssets?: readonly ApprovalReviewAsset[];
  readonly requiresDeployment?: boolean;
  readonly summaries?: readonly string[];
  readonly token?: WatchAssetToken;
  readonly typedData?: unknown;
};

/**
 * A persisted origin grant summarized for trusted extension surfaces.
 */
export type { ConnectedSite } from "@bramble/core/origin";

/**
 * One selectable Starknet network returned in wallet status.
 */
export type NetworkOption = {
  readonly id: StarknetNetworkId;
  readonly name: string;
};

/**
 * Complete public wallet status returned to trusted extension pages.
 */
export type WalletStatus = {
  readonly accountCount: number;
  readonly activeAccountId: string | null;
  readonly accounts: readonly AccountRef[];
  readonly hasVault: boolean;
  readonly locked: boolean;
  readonly network: string;
  readonly networkId: StarknetNetworkId;
  readonly networks: readonly NetworkOption[];
  readonly ready: boolean;
};
