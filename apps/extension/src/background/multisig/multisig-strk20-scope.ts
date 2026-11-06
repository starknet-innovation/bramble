/**
 * This wallet's own view of a multisig for STRK20 review and binding: its
 * address, chain, network name, pool, tracked tokens, and the live signer set.
 * Nothing here is read from a co-owner's package.
 */

import type { ArgentMultisigRecord } from "@bramble/multisig/repository";
import type { MultisigStrk20Binding } from "@bramble/privacy/multisig-strk20-binding";
import type { MultisigStrk20ReviewScope } from "@bramble/privacy/multisig-strk20-review";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";

/**
 * The scope a card is decoded against. Only tokens tracked on the multisig's
 * network can name an amount; any other token makes the card refuse.
 */
export const multisigStrk20ReviewScope = (
  record: Pick<ArgentMultisigRecord, "address" | "networkId">,
  poolAddress: string,
  tokens: readonly {
    readonly address: string;
    readonly decimals: number;
    readonly networkId: string;
    readonly symbol: string;
  }[],
): MultisigStrk20ReviewScope => ({
  accountAddress: record.address,
  chainId: STARKNET_NETWORKS[record.networkId].chainId,
  network: STARKNET_NETWORKS[record.networkId].name,
  poolAddress,
  tokens: tokens
    .filter((token) => token.networkId === record.networkId)
    .map(({ address, decimals, symbol }) => ({ address, decimals, symbol })),
});

/** The binding a co-owner's package must match: record facts plus the live signer set. */
export const multisigStrk20Binding = (
  record: Pick<ArgentMultisigRecord, "address" | "id" | "networkId">,
  config: { readonly signerPublicKeys: readonly string[]; readonly threshold: number },
): MultisigStrk20Binding => ({
  accountAddress: record.address,
  accountId: record.id,
  chainId: STARKNET_NETWORKS[record.networkId].chainId,
  signerPublicKeys: config.signerPublicKeys,
  threshold: config.threshold,
});
