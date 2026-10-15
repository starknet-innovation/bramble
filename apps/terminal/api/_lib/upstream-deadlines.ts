/**
 * The STRK20 gateway's upstream deadlines, kept apart from the request checks
 * so the wallet's conformance test can read them without loading the gateway.
 */

/**
 * How long the STRK20 gateway waits for each upstream before answering 504
 * `upstream_timeout`. The wallet's own paymaster deadline must end first
 * (`PAYMASTER_TIMEOUT_MS` in `packages/features/privacy`, pinned by a
 * conformance test), so a slow relay surfaces in the wallet as its own
 * deadline expiry rather than as a gateway status.
 */
export const PAYMASTER_UPSTREAM_TIMEOUT_MS = 25_000;
/** The prover's upstream deadline: proving takes far longer than a relay call. */
export const PROVER_UPSTREAM_TIMEOUT_MS = 110_000;
