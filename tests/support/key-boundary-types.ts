/**
 * Shapes shared by the enforced background key-boundary scan: one catalog
 * entry, and the live identifiers an entry needs so it reaches a real handler
 * instead of bouncing off a validator.
 *
 * Kept in its own module so the catalog (which declares entries) and the
 * harness (which mints the identifiers) can both depend on the contract
 * without depending on each other.
 */

import type { StarkSignature } from "@bramble/wallet-model/signing";
import type {
  ArgentMultisigDeploymentReview,
  ArgentMultisigIntentPackage,
} from "../../apps/extension/src/background/multisig/multisig-inputs";
import type { RuntimeSender } from "../../apps/extension/src/background/routing/senders";

/**
 * Identifiers minted by the key-boundary harness against its own live stores
 * and queues. Everything here is real state the background produced — a queued
 * approval, a stored proposal, a one-time preparation — because a hand-written
 * id would make the request fail its lookup and the response would then carry
 * nothing for the secret scan to inspect.
 *
 * The function-valued members mint fresh state on each call and must therefore
 * be invoked at scan time, not while the catalog is being declared.
 */
export type KeyBoundaryLiveIds = {
  /** Id of the address-book contact seeded into the preferences store. */
  readonly addressBookId: string;
  /** Id of the allowance record seeded into the allowance log. */
  readonly allowanceId: string;
  /** Queues a fresh connection approval and returns its id. */
  readonly connectApprovalId: () => Promise<string>;
  /** Id of the account folder seeded into the preferences store. */
  readonly groupId: string;
  /** Parks a device signing request and returns its queue id. */
  readonly ledgerSignId: () => Promise<string>;
  /** Id of the watched multisig seeded into the multisig registry. */
  readonly multisigId: string;
  /** Fresh exact deploy review consumed by the matching submit request. */
  readonly multisigDeploymentReview: () => Promise<ArgentMultisigDeploymentReview>;
  /** Stored full intent package for cross-wallet import. */
  readonly multisigIntentPackage: ArgentMultisigIntentPackage;
  /** Collecting intent id reserved for local signing. */
  readonly multisigSignIntentId: string;
  /** Collecting intent id and valid fragment reserved for signature import. */
  readonly multisigSignatureImport: {
    readonly intentId: string;
    readonly signature: StarkSignature;
  };
  /** Ready intent id reserved for exact-hash submission. */
  readonly multisigSubmitIntentId: string;
  /** Id of the watched NFT seeded into the preferences store. */
  readonly nftId: string;
  /** Queues an unanswered dapp invoke approval and returns its id. */
  readonly invokeApprovalId: () => Promise<string>;
  /** Runs a private-send preparation and returns its one-time id. */
  readonly strk20PreparationId: () => Promise<string>;
  /** Runs a swap preparation and returns its one-time id. */
  readonly swapPreparationId: () => Promise<string>;
  /** Id of a token tracked for the active network. */
  readonly tokenId: string;
  /**
   * Makes the active account read as not yet registered with the privacy pool.
   * One-way and permanent, for the same reason: registration is the only STRK20
   * journey that requires an unregistered account, and its entries are ordered
   * after every entry that needs a registered one.
   */
  readonly unregisterStrk20Account: () => void;
};

/**
 * One catalog entry: a request, the runtime sender allowed to issue it, and how
 * the scan should judge the response.
 *
 * `live` supplies the fields that can only be known once the harness has minted
 * them; it is merged over `message`, and the merged request must keep the same
 * `type` so an entry can never silently start covering a different handler.
 *
 * `negative` is the only way an entry may answer with `{ error }`. It holds the
 * reason that refusal is the point of the entry (a wrong passphrase, a sender
 * that must be turned away). Every other entry has to produce a live success,
 * or the scan is grepping an error string instead of a handler's real response.
 */
export type KeyBoundaryMessage = {
  readonly live?: (ids: KeyBoundaryLiveIds) => Promise<Record<string, unknown>>;
  readonly message: Record<string, unknown>;
  readonly negative?: string;
  readonly sender: RuntimeSender;
};
