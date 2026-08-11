/**
 * On-chain verification of an account's OpenZeppelin class hash. The account
 * screen shows the class hash Krusty KMS advertises; this confirms, against the
 * live network, that the contract deployed at the account address actually runs
 * that class before the wallet presents the hash as trusted.
 *
 * Fails closed: only an exact felt match yields `verified`. Every other outcome
 * — a different on-chain class, an undeployed account, or an unreachable node —
 * is surfaced as its own state, and an unexpected (semantic) RPC error
 * propagates rather than being downgraded into a benign "verified" result.
 */

import { WalletError } from "@mc-wallet/core/errors";
import { asFelt, isNonZeroStarkFieldElement, sameFelt } from "@mc-wallet/wallet-model/networks";
import type { RpcProvider } from "starknet";
import { isContractNotFoundError, isTransportRpcError, withRpcFallback } from "./provider";

/**
 * Outcome of comparing the wallet-advertised class hash to the class deployed
 * at the account address. A discriminated union so callers must handle every
 * case and `verified` cannot be represented without the matching on-chain hash.
 */
export type ClassHashVerification =
  | { readonly status: "verified"; readonly onChainClassHash: string }
  | {
      readonly status: "mismatch";
      readonly expectedClassHash: string;
      readonly onChainClassHash: string;
    }
  | { readonly status: "undeployed" }
  | { readonly status: "unreachable" };

/**
 * Inputs for {@link verifyAccountClassHash}. `makeProvider` is injectable so
 * the verification is unit-testable without a live node; production callers
 * omit it and get the default `RpcProvider` per endpoint.
 */
export type VerifyClassHashInput = {
  readonly accountAddress: string;
  readonly expectedClassHash: string;
  readonly makeProvider?: ((nodeUrl: string) => RpcProvider) | undefined;
  readonly rpcUrls: readonly string[];
};

/**
 * Verifies the account's advertised class hash against the class deployed at
 * its address via `starknet_getClassHashAt` — the same RPC the deployment
 * check already uses. That call returns the deployed class hash directly, and a
 * class hash uniquely identifies a declared class, so a match proves both that
 * the class is declared on the target network and that the account genuinely
 * runs the advertised OpenZeppelin `AccountUpgradeable` class — without the
 * heavier full-class body fetch. Comparison is felt-level (leading-zero and
 * case differences normalized by {@link sameFelt}). Returns:
 *
 * - `verified` — the deployed class hash equals the advertised hash.
 * - `mismatch` — a contract is deployed but runs a different class; a security
 *   signal the caller must surface prominently.
 * - `undeployed` — no contract exists at the address yet.
 * - `unreachable` — every configured endpoint failed at the transport level
 *   (offline / node down) or returned an unusable non-felt answer, so the
 *   class could not be checked.
 *
 * Any other (semantic) RPC error propagates: the wallet never turns an
 * unexpected failure into a `verified` or otherwise benign state.
 */
export const verifyAccountClassHash = async ({
  accountAddress,
  expectedClassHash,
  makeProvider,
  rpcUrls,
}: VerifyClassHashInput): Promise<ClassHashVerification> => {
  if (!isNonZeroStarkFieldElement(accountAddress)) {
    throw new WalletError("Invalid account address");
  }
  if (!isNonZeroStarkFieldElement(expectedClassHash)) {
    throw new WalletError("Invalid account class hash");
  }
  try {
    return await withRpcFallback(
      rpcUrls,
      async (provider): Promise<ClassHashVerification> => {
        const onChainClassHash = await provider.getClassHashAt(accountAddress, "latest");
        const onChainFelt = asFelt(onChainClassHash);
        if (onChainFelt === null) {
          // A healthy node returns the deployed class hash as a felt. A
          // non-felt answer means this endpoint is malfunctioning (or hostile),
          // so throw to fail over to the next endpoint; if every endpoint is
          // unusable the outcome degrades to `unreachable`. This keeps the
          // `verified` and `mismatch` on-chain hashes genuine felts and never
          // lets a garbage response masquerade as a benign result.
          throw new Error("RPC returned a non-felt class hash");
        }
        if (onChainFelt === 0n) {
          // Some nodes answer a not-yet-deployed address with a zero class hash
          // instead of a CONTRACT_NOT_FOUND error. A zero class hash means no
          // contract, so this is an undeployed account — not a `mismatch` (the
          // advertised hash is always non-zero), which would otherwise raise a
          // false "do not trust this account" alarm for a merely-undeployed one.
          return { status: "undeployed" };
        }
        return sameFelt(onChainClassHash, expectedClassHash)
          ? { onChainClassHash, status: "verified" }
          : { expectedClassHash, onChainClassHash, status: "mismatch" };
      },
      makeProvider,
    );
  } catch (error) {
    if (isContractNotFoundError(error)) {
      return { status: "undeployed" };
    }
    if (isTransportRpcError(error)) {
      return { status: "unreachable" };
    }
    throw error;
  }
};
