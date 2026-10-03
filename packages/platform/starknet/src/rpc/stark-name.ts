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
  readonly name: string;
  readonly rpcUrls: readonly string[];
  readonly makeProvider?: ((nodeUrl: string) => RpcProvider) | undefined;
};

/**
 * Normalizes a typed name to the canonical `name.stark` form the naming
 * contract expects (trimmed, lower-cased, suffix added), or `null` when it is
 * not a syntactically valid Starknet name. Labels are 1-48 characters of a-z,
 * 0-9 and '-', exactly as {@link starknetId.isStarkDomain} checks.
 */
export const normalizeStarkName = (name: string): string | null => {
  const trimmed = name.trim().toLowerCase();
  const domain = trimmed.endsWith(STARK_SUFFIX) ? trimmed : `${trimmed}${STARK_SUFFIX}`;
  return starknetId.isStarkDomain(domain) ? domain : null;
};

/**
 * Resolves a Starknet name to its account address on the network behind
 * `rpcUrls`. The address is returned only when the naming contract answers a
 * nonzero felt; a well-formed zero answer is `not-found`. A non-felt answer is
 * a malfunctioning endpoint, so it throws and fails over rather than being read
 * as "no such name".
 */
export const resolveStarkName = async ({
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
  try {
    return await withRpcFallback(
      rpcUrls,
      async (provider): Promise<StarkNameResolution> => {
        const chainId = await provider.getChainId();
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
    if (isTransportRpcError(error)) {
      return { status: "unreachable" };
    }
    if (isContractNotFoundError(error)) {
      return { status: "unsupported-network" };
    }
    throw error;
  }
};
