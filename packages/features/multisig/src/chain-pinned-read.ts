/**
 * Pinned-block read policy for Argent multisig chain reads.
 *
 * A multisig read must describe ONE state: a threshold from block N paired with
 * a signer set from block N+1 is a different account than either. So reads pin
 * an accepted block and ask every question at it. The policy itself (re-pinning
 * when a load-balanced sibling node does not know the pinned hash) is shared
 * with the other pinned readers and lives in @bramble/starknet/pinned-block.
 */
export { withPinnedBlock } from "@bramble/starknet/pinned-block";
