/**
 * Starknet ID name resolution: turns a typed `name.stark` into the account
 * address it points at, as a read-only call on the active network.
 *
 * The call reuses the naming contract and label encoder the `starknet` library
 * ships (its pinned contract constants and `useEncoded`) rather than the
 * library's own high-level helper, because that helper collapses every failure
 * into one "could not get address" error. A node outage would then read as a
 * missing name. Here a transport fault still fails over to the next endpoint
 * ({@link withRpcFallback}), an unregistered name is the naming contract's own
 * zero answer, and any other answer fails closed.
 */

import { WalletError } from "@bramble/core/errors";
import { canonicalFelt, isNonZeroStarkFieldElement } from "@bramble/wallet-model/networks";
import { CallData, type RpcProvider, starknetId } from "starknet";
import { isContractNotFoundError, isTransportRpcError, withRpcFallback } from "./provider";

/** The suffix every Starknet ID name carries. */
const STARK_SUFFIX = ".stark";

/**
 * Outcome of resolving a typed name against the active network.
 *
 * - `resolved` — the naming contract answered a nonzero account address.
 * - `not-found` — the name is well formed but unregistered (the contract's zero answer).
 * - `unsupported-network` — the active chain has no Starknet ID deployment.
 * - `unreachable` — every configured endpoint failed at the transport level.
 */
export type StarkNameResolution =
  | { readonly status: "resolved"; readonly address: string }
  | { readonly status: "not-found" }
  | { readonly status: "unsupported-network" }
  | { readonly status: "unreachable" };

/**
 * Inputs for {@link resolveStarkName}. `makeProvider` is injectable so the
 * resolution is unit-testable without a live node; production callers omit it
 * and get the default `RpcProvider` per endpoint.
 */
export type ResolveStarkNameInput = {
  /**
   * The chain id the caller's network expects. An endpoint reporting another
   * chain is not trusted: its naming contract answers for a different network.
   */
  readonly expectedChainId?: string | undefined;
  readonly name: string;
  readonly rpcUrls: readonly string[];
  readonly makeProvider?: ((nodeUrl: string) => RpcProvider) | undefined;
};

/**
 * Normalizes a typed name to the canonical `name.stark` form the naming
 * contract expects, or `null` when it is not a syntactically valid Starknet
 * name. The suffix is required, never added: a bare label is not a name here,
 * so an ordinary word can never be turned into a lookup. Labels are 1-48
 * characters of a-z, 0-9 and '-', exactly as {@link starknetId.isStarkDomain}
 * checks.
 */
export const normalizeStarkName = (name: string): string | null => {
  const trimmed = name.trim().toLowerCase();
  return starknetId.isStarkDomain(trimmed) ? trimmed : null;
};

/**
 * Resolves a Starknet name to its account address on the network behind
 * `rpcUrls`. The address is returned only when the naming contract answers a
 * nonzero felt; a well-formed zero answer is `not-found`. A non-felt answer is
 * a malfunctioning endpoint, so it throws and fails over rather than being read
 * as "no such name".
 */
export const resolveStarkName = async ({
  expectedChainId,
  name,
  rpcUrls,
  makeProvider,
}: ResolveStarkNameInput): Promise<StarkNameResolution> => {
  const domain = normalizeStarkName(name);
  if (domain === null) {
    throw new WalletError("Invalid Starknet name");
  }
  const labels = domain.slice(0, -STARK_SUFFIX.length).split(".");
  const calldata = CallData.compile({
    domain: labels.map((label) => starknetId.useEncoded(label).toString(10)),
    hint: [],
  });
  // Set when an endpoint answers for another chain. Such an endpoint is failed
  // over like a fault, but if no endpoint matches, the lookup fails closed as an
  // error rather than reading as an unreachable network.
  let sawOtherChain = false;
  try {
    return await withRpcFallback(
      rpcUrls,
      async (provider): Promise<StarkNameResolution> => {
        const chainId = await provider.getChainId();
        // An endpoint on another chain would resolve the name against that
        // chain's naming contract, so its answer is never read as this
        // network's address. It fails over, and fails closed if none matches.
        if (
          expectedChainId !== undefined &&
          canonicalFelt(chainId) !== canonicalFelt(expectedChainId)
        ) {
          sawOtherChain = true;
          throw new Error("RPC reported another chain for a Starknet name lookup");
        }
        let contractAddress: string;
        try {
          contractAddress = starknetId.getStarknetIdContract(chainId);
        } catch {
          // No Starknet ID deployment on this chain: resolving is unsupported
          // here, not a failed read.
          return { status: "unsupported-network" };
        }
        const answer = await provider.callContract({
          calldata,
          contractAddress,
          entrypoint: "domain_to_address",
        });
        const raw: string | undefined = answer[0];
        const address = raw === undefined ? null : canonicalFelt(raw);
        if (address === null) {
          throw new Error("RPC returned a non-felt Starknet name address");
        }
        return isNonZeroStarkFieldElement(address)
          ? { address, status: "resolved" }
          : { status: "not-found" };
      },
      makeProvider,
    );
  } catch (error) {
    if (sawOtherChain) {
      throw new Error("No RPC endpoint answered on this network's chain");
    }
    if (isTransportRpcError(error)) {
      return { status: "unreachable" };
    }
    if (isContractNotFoundError(error)) {
      return { status: "unsupported-network" };
    }
    throw error;
  }
};
