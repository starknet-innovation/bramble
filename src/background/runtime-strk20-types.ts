/**
 * STRK20 response envelopes returned by privileged background handlers.
 */

import type { StarknetNetworkId } from "../starknet/networks";
import type { Strk20BalanceEntry, Strk20CallAndProof } from "../starknet/strk20/schemas";
import type { Strk20WalletPreparationReview } from "./strk20-wallet-preparations";

/**
 * STRK20 private balances returned through the dapp provider bridge.
 */
export type Strk20BalancesResponse = {
  readonly balances: readonly Strk20BalanceEntry[];
  readonly ok: true;
};

/**
 * STRK20 prepared call-and-proof returned through the dapp provider bridge.
 */
export type Strk20PrepareResponse = {
  readonly callAndProof: Strk20CallAndProof;
  readonly ok: true;
};

/**
 * Locally derived dapp-scoped STRK20 sub-account commitment.
 */
export type Strk20SubaccountCommitmentResponse = {
  readonly commitment: string;
  readonly ok: true;
};

/**
 * Private-balance state returned only to an extension-controlled page after the
 * user explicitly enables disclosure.
 */
export type Strk20WalletStateResponse = {
  readonly ok: true;
  readonly strk20State: {
    readonly accountId: string;
    readonly balances: readonly {
      readonly balance: string;
      readonly formatted: string;
      readonly symbol: string;
      readonly token: string;
      readonly tokenId: string;
    }[];
    readonly networkId: StarknetNetworkId;
    readonly registration: "registered" | "unregistered";
  };
};

/**
 * Frozen registration, deposit, or private-send review returned to the
 * extension side panel.
 */
export type Strk20WalletPreparationResponse = {
  readonly ok: true;
  readonly strk20Preparation: Strk20WalletPreparationReview;
};

/**
 * Pool-registration status of a prospective private-send recipient, returned
 * only to an extension-controlled page.
 */
export type Strk20RecipientStatusResponse = {
  readonly ok: true;
  readonly strk20RecipientRegistration: "registered" | "unregistered";
};
