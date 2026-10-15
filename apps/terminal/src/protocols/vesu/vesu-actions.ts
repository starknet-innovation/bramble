/**
 * Additional Vesu V2 actions used by the professional lending desk. Builders
 * are pure and return calls for the terminal/wallet review path; they never
 * sign, submit, or touch browser state.
 */
import { type Call, CallData, cairo } from "starknet";
import { VESU_ADDRESSES, VESU_VAULT_DEPOSITS_ENABLED } from "../constants";
import { CAIRO_U256_MAX } from "../support/cairo-integers";
import { WalletError } from "../support/errors";
import {
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
} from "../support/networks";
import { buildErc20ApproveCall } from "../support/rpc-assets";

const assertAddress = (value: string, label: string): void => {
  if (!isNonZeroStarkFieldElement(value)) throw new WalletError(`Invalid ${label}`);
};

/** Refusal while vault deposits are paused (see `VESU_VAULT_DEPOSITS_ENABLED`). */
export const VESU_VAULT_DEPOSITS_PAUSED =
  "Vesu vault deposits are paused until vault addresses can be verified on chain";

/**
 * Builds an ERC-4626 vault deposit and immediately revokes its allowance.
 * Refuses while `VESU_VAULT_DEPOSITS_ENABLED` is off (Sherlock 169).
 */
export const buildVesuVaultDepositCalls = (
  vaultAddress: string,
  assetAddress: string,
  amountRaw: bigint,
  receiver: string,
  depositsEnabled: boolean = VESU_VAULT_DEPOSITS_ENABLED,
): readonly Call[] => {
  if (!depositsEnabled) throw new WalletError(VESU_VAULT_DEPOSITS_PAUSED);
  assertAddress(vaultAddress, "Vesu vault");
  assertAddress(assetAddress, "Vesu vault asset");
  assertAddress(receiver, "Vesu vault receiver");
  if (amountRaw <= 0n || amountRaw > CAIRO_U256_MAX) {
    throw new WalletError("Vesu vault amount must be a positive u256");
  }
  return [
    buildErc20ApproveCall(assetAddress, vaultAddress, amountRaw),
    {
      calldata: CallData.compile([cairo.uint256(amountRaw), receiver]),
      contractAddress: vaultAddress,
      entrypoint: "deposit",
    },
    buildErc20ApproveCall(assetAddress, vaultAddress, 0n),
  ];
};

/** Starts an asynchronous vault redemption for an exact share amount. */
export const buildVesuVaultRedeemCalls = (
  vaultAddress: string,
  sharesRaw: bigint,
  accountAddress: string,
): readonly Call[] => {
  assertAddress(vaultAddress, "Vesu vault");
  assertAddress(accountAddress, "Vesu vault owner");
  if (sharesRaw <= 0n || sharesRaw > CAIRO_U256_MAX) {
    throw new WalletError("Vesu redeem shares must be a positive u256");
  }
  return [
    {
      calldata: CallData.compile([
        cairo.uint256(sharesRaw),
        accountAddress,
        accountAddress,
      ]),
      contractAddress: vaultAddress,
      entrypoint: "request_redeem",
    },
  ];
};

/** Claims a completed asynchronous vault redemption by request id. */
export const buildVesuVaultClaimCalls = (
  vaultAddress: string,
  redemptionId: bigint,
): readonly Call[] => {
  assertAddress(vaultAddress, "Vesu vault");
  if (redemptionId < 0n || redemptionId > CAIRO_U256_MAX) {
    throw new WalletError("Invalid Vesu redemption id");
  }
  return [
    {
      calldata: CallData.compile([cairo.uint256(redemptionId)]),
      contractAddress: vaultAddress,
      entrypoint: "claim_redeem",
    },
  ];
};

/** Builds a BTCFi Merkle reward claim from Vesu API proof calldata. */
export const buildVesuRewardClaimCalls = (
  amountRaw: bigint,
  proof: readonly string[],
): readonly Call[] => {
  if (amountRaw <= 0n || amountRaw > CAIRO_U256_MAX || proof.length === 0) {
    throw new WalletError("No claimable Vesu rewards");
  }
  for (const node of proof) {
    if (!isStarkFieldElement(node)) throw new WalletError("Invalid Vesu reward proof");
  }
  return [
    {
      calldata: CallData.compile([cairo.uint256(amountRaw), proof]),
      contractAddress: VESU_ADDRESSES.btcFiDistributor,
      entrypoint: "claim",
    },
  ];
};
