/**
 * Where Bramble's QSB vaults are coordinated: qsb-app's deployment, called
 * directly from the background at its stable `/v1` prefix. The origin itself
 * is defined in `@bramble/wallet-model/qsb-vaults`, which the UI shares to ask
 * the user for access to it at runtime (its API allows no other CORS origin).
 *
 * The coordinator is trusted for nothing it says about a vault's secrets:
 * every script Bramble registers or pays is rebuilt locally from Krusty's
 * commitments, and every answer is parsed strictly before use.
 */

import { QSB_COORDINATOR_ORIGIN } from "@bramble/wallet-model/qsb-vaults";

/** The coordinator's origin, single-sourced in the UI/background contract. */
export { QSB_COORDINATOR_ORIGIN };

/** The coordinator's stable API prefix. */
export const QSB_API_BASE_PATH = "/v1";

/** The network the coordinator must say it serves, and every vault names. */
export const QSB_COORDINATOR_NETWORK = "mainnet";
