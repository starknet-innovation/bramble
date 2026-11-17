/**
 * Public, audited mainnet anchors shared by Terminal browser and server code.
 * Private discovery/prover upstream URLs and API keys are environment-only.
 */
export const PRIVACY_POOL_ADDRESS =
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
export const AVNU_PAYMASTER_URL = "https://starknet.paymaster.avnu.fi";
export const PRIVATE_SWAP_FEE_TOKEN =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

/** Maximum requested private-swap slippage, shared by build and review. */
export const PRIVATE_SWAP_SLIPPAGE_BPS = 50;

/**
 * The AVNU private-swap executor (AVNU PrivacySwapHelper, #269). It receives
 * the tokens withdrawn for one swap, so it is pinned here and never learned
 * from a quote or build response; a build that names any other executor is
 * refused.
 *
 * Provenance, verified 2026-11-06 at mainnet block 17546459:
 * - listed as "AVNU PrivacySwapHelper" on https://strk20.starknet.io/docs/contract-addresses;
 * - returned as `executorAddress` by AVNU's public `POST /swap/v3/build` with `private: true`;
 * - `starknet_getClassHashAt` on https://mainnet.nodes.starknet.org returns
 *   {@link PRIVATE_SWAP_EXECUTOR_CLASS_HASH}.
 * The class ABI has no upgrade or admin entrypoint; no verified source or audit
 * was found. If AVNU rotates the executor or the class changes, private swaps
 * refuse until this pin is updated by PR. Set it to null to turn them off.
 */
export const PRIVATE_SWAP_EXECUTOR: string | null =
  "0x0426dcd1ab5fa2f852f138d07cb37708b00a4db999677fe2d0c9a440702dbe5e";

/**
 * Class hash the pinned executor must run. Read live at plan time and again
 * before the wallet proves the swap; a different class or a failed read refuses.
 */
export const PRIVATE_SWAP_EXECUTOR_CLASS_HASH =
  "0x3ff37c9dc8c2ea3930fbf27f62d7b9bdd6f0a63c8e77b11c64be4a69230fcee";

/** Outcome of {@link checkPinnedExecutorClass}. */
export type ExecutorClassCheck = "ok" | "not_pinned" | "class_mismatch" | "class_unavailable";

const FELT_HEX = /^0x[0-9a-fA-F]{1,64}$/;

/**
 * Reads `executor`'s live class hash with `readClassHash` and compares it with
 * `expectedClassHash` (callers pass {@link PRIVATE_SWAP_EXECUTOR} and
 * {@link PRIVATE_SWAP_EXECUTOR_CLASS_HASH}). Fails closed: a thrown read
 * or a value that is not one hex felt is `class_unavailable`, never `ok`. Used
 * by both the browser and the server route, each with its own RPC reader.
 */
export const checkPinnedExecutorClass = async (
  readClassHash: (address: string) => Promise<unknown>,
  executor: string | null,
  expectedClassHash: string,
): Promise<ExecutorClassCheck> => {
  if (executor === null) return "not_pinned";
  let live: unknown;
  try {
    live = await readClassHash(executor);
  } catch {
    return "class_unavailable";
  }
  if (typeof live !== "string" || !FELT_HEX.test(live)) return "class_unavailable";
  return BigInt(live) === BigInt(expectedClassHash) ? "ok" : "class_mismatch";
};
