/**
 * Where Bramble's QSB vaults are coordinated: qsb-app's deployment, called
 * directly from the background at its stable `/v1` prefix. This is the one
 * definition of the origin. The extension manifest grants exactly this
 * origin as a host permission (its API allows no other CORS origin), and a
 * conformance test holds the manifest and this constant together.
 *
 * The coordinator is trusted for nothing it says about a vault's secrets:
 * every script Bramble registers or pays is rebuilt locally from Krusty's
 * commitments, and every answer is parsed strictly before use.
 */

/** The coordinator's origin, exactly as its sign-in challenge names it. */
export const QSB_COORDINATOR_ORIGIN = "https://d1pjwwq89sze3g.cloudfront.net";

/** The coordinator's stable API prefix. */
export const QSB_API_BASE_PATH = "/v1";

/** The network the coordinator must say it serves, and every vault names. */
export const QSB_COORDINATOR_NETWORK = "mainnet";
