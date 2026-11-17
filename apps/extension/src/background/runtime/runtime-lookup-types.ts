/**
 * Response shapes for the background's read-only on-chain lookups: an
 * account's class-hash verification and a typed Starknet name's resolution.
 * Each carries a discriminated outcome, so the panel never re-reads the chain
 * to tell a failure from an answer. Part of the `RuntimeResponse` union in
 * `runtime-types.ts`; neither carries secret material.
 */
import type { ClassHashVerification } from "@bramble/starknet/class-hash-verify";
import type { StarkNameResolution } from "@bramble/starknet/stark-name";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";

/**
 * On-chain class-hash verification: the discriminated
 * {@link ClassHashVerification} outcome, so the UI need not re-read the chain.
 */
export type ClassHashVerificationResponse = {
  readonly accountId: string;
  readonly ok: true;
  readonly verification: ClassHashVerification;
};

/**
 * A typed Starknet ID name resolved on the active network. `resolution` carries
 * the discriminated {@link StarkNameResolution} outcome so the UI can
 * distinguish resolved / not-found / unsupported-network / unreachable without
 * re-reading the chain. `networkId` names the network the read was made on, so
 * a panel that changed network mid-read never commits an address from another.
 */
export type StarkNameResolutionResponse = {
  readonly networkId: StarknetNetworkId;
  readonly ok: true;
  readonly resolution: StarkNameResolution;
};
