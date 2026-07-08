/**
 * The STRK20 proving backend boundary.
 *
 * Generating a real STRK20 privacy proof requires the protocol's zero-knowledge
 * proving system, which a browser extension cannot run in-process: it needs the
 * proving keys and prover machinery that live outside the wallet. This module
 * isolates that dependency behind a typed interface so the rest of the wallet
 * can build and validate the STRK20_CALL_AND_PROOF envelope honestly. A real
 * deployment injects a backend that talks to a configured prover; when none is
 * configured the wallet refuses rather than fabricating a proof or claiming a
 * privacy guarantee it cannot meet.
 */
import { WalletError } from "../../shared/errors";
import type { AccountRef } from "../../storage/vault-schema";
import type { Strk20Action, Strk20BalanceEntry, Strk20CallAndProof } from "./schemas";

/**
 * Stable error message returned when no proving backend is configured. Maps to
 * the spec UNKNOWN_ERROR (163) on the dapp wire — the wallet cannot itself
 * produce a proof.
 */
export const STRK20_PROVING_UNAVAILABLE = "strk20 proving backend unavailable";

/**
 * Inputs a proving backend needs to build the call and its proof for a batch of
 * validated actions. `simulate` requests a dry-run proof for a prepare call.
 */
export type Strk20ProvingRequest = {
  readonly account: AccountRef;
  readonly actions: readonly Strk20Action[];
  readonly balances: readonly Strk20BalanceEntry[];
  readonly rpcUrls: readonly string[];
  readonly simulate: boolean;
};

/**
 * The proving backend interface: turns a validated action batch into a
 * spec-shaped STRK20_CALL_AND_PROOF.
 */
export type Strk20ProvingBackend = {
  readonly prove: (request: Strk20ProvingRequest) => Promise<Strk20CallAndProof>;
};

/**
 * The default backend used when no prover is wired: it never invents a proof and
 * always fails with {@link STRK20_PROVING_UNAVAILABLE}.
 */
export const unconfiguredProvingBackend: Strk20ProvingBackend = {
  async prove(): Promise<Strk20CallAndProof> {
    throw new WalletError(STRK20_PROVING_UNAVAILABLE);
  },
};
