/**
 * The ownership proof behind every import by address: issue 398 (a recovery
 * phrase's key) and issue 779 (one raw private key). Both flows read the
 * account through this module, so there is one proof, not two that drift.
 *
 * Nothing is trusted from one endpoint: the owner is read from two sources
 * (the configured endpoints and the network's bundled Foundation-direct node,
 * each proving it serves the expected chain), which must agree on whether the
 * account exists, its class, and its owner key. An unreadable or disputed
 * answer refuses rather than guesses.
 *
 * Trust assumption (owner decision, 2026-10-26): both sources are operated by
 * the Starknet Foundation unless the user configured a custom endpoint. Their
 * agreement stops a malicious custom or third-party RPC from choosing the
 * account; it does not defend against a compromise of SNF's own nodes, which
 * is the same trust the wallet places in those nodes everywhere else.
 */

import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import type { AccountOwnerReading } from "@bramble/starknet/rpc";
import { rpcEndpointClass } from "@bramble/starknet/rpc-diagnostics";
import { accountClassEntry, BRAAVOS_BASE_CLASS_HASH } from "@bramble/wallet-model/account-families";
import type { RecoverableAccountRef } from "@bramble/wallet-model/accounts";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  STARKNET_NETWORKS,
  type StarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";
import {
  ADDRESS_IMPORT_REFUSALS,
  type RecoveryAccountCandidate,
} from "@bramble/wallet-model/recovery";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls } from "../runtime/runtime-state";

/** What the proof reads through: the endpoint preferences and the chain. */
export type OwnerProofDeps = {
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
};

/** A refusal, as the lookup and the re-proof answer it. */
export type Refusal = { readonly error: string };

/** The account both sources agreed on: its family, live class and owner key. */
export type OwnerFound = {
  readonly classHash: string;
  readonly family: "argent" | "braavos";
  readonly ownerPublicKey: string;
};

/**
 * The class an account record keeps for `found`. It is the one its address
 * was deployed with, which the chain does not say. Every Argent release in the
 * table is a deployment class, so the live one stands in; a Braavos account
 * runs an implementation class it was never deployed at, so its record keeps
 * the base class Braavos deploys from. The account is already deployed, so the
 * record's class and salt are never used to deploy it, and deployment refuses
 * any record whose fields do not reproduce its address.
 */
export const recordClassHash = (found: OwnerFound): string => {
  const entry = accountClassEntry(found.classHash);
  // `found.classHash` is canonical already (see verdictOf).
  return entry?.roles.includes("deployment") && entry.family === found.family
    ? found.classHash
    : BRAAVOS_BASE_CLASS_HASH;
};

// The two sources an ownership claim must agree across. The witness is always
// the network's bundled Foundation-direct node, even under a custom endpoint,
// so a lying configured node cannot answer for both. The primary is the
// configured list without it (a custom endpoint, then the wallet gateway).
// Both are SNF-operated unless the user set a custom endpoint: accepted by the
// owner (2026-10-26) as the wallet's existing trust in SNF nodes, so this guards
// against a malicious custom or third-party RPC, not a compromise of SNF's own.
// No third-party source is added. A network with no distinct Foundation-direct
// node has no second source.
const ownerSources = async (
  deps: OwnerProofDeps,
  networkId: StarknetNetworkId,
): Promise<{ readonly primary: readonly string[]; readonly witness: string } | null> => {
  const network = STARKNET_NETWORKS[networkId];
  const witness = network.rpcUrls.find((url) => rpcEndpointClass(url) === "foundation");
  if (witness === undefined) return null;
  const configured = networkRpcUrls(network, await deps.preferencesStore.read());
  const primary = configured.filter((url) => url !== witness);
  return primary.length === 0 ? null : { primary, witness };
};

// Whether two sources describe the same account: both absent, both refusing the
// same way, or the same family, class, and owner key. Their blocks may differ.
const sameReading = (left: AccountOwnerReading, right: AccountOwnerReading): boolean => {
  if (left.kind === "owner" && right.kind === "owner") {
    return (
      left.family === right.family &&
      sameFelt(left.classHash, right.classHash) &&
      sameFelt(left.ownerPublicKey, right.ownerPublicKey)
    );
  }
  if (left.kind === "non-stark-owner" && right.kind === "non-stark-owner") {
    return left.family === right.family && left.ownerType === right.ownerType;
  }
  return left.kind === right.kind;
};

const verdictOf = (reading: AccountOwnerReading): OwnerFound | Refusal => {
  if (reading.kind === "not-deployed") return { error: ADDRESS_IMPORT_REFUSALS.notDeployed };
  if (reading.kind === "bramble-account") return { error: ADDRESS_IMPORT_REFUSALS.brambleAccount };
  if (reading.kind === "unsupported-class") {
    return { error: ADDRESS_IMPORT_REFUSALS.unsupportedClass };
  }
  if (reading.kind === "non-stark-owner") return { error: ADDRESS_IMPORT_REFUSALS.nonStarkOwner };
  // Kept only in canonical form. `sameReading` has already parsed it, so this
  // cannot refuse today; it keeps a raw spelling out of the record if that
  // order ever changes.
  const classHash = canonicalFelt(reading.classHash);
  if (classHash === null) return { error: ADDRESS_IMPORT_REFUSALS.unavailable };
  return { classHash, family: reading.family, ownerPublicKey: reading.ownerPublicKey };
};

/**
 * Reads the owner of `address` from both sources and accepts only an answer
 * they agree on. An unreachable or wrong-chain source, a missing reader, or no
 * second source is unavailable; a disagreement is its own refusal. Never
 * answers on one source.
 */
export const readOwner = async (
  deps: OwnerProofDeps,
  address: string,
  networkId: StarknetNetworkId,
): Promise<OwnerFound | Refusal> => {
  const read = deps.runtimeRpc.getAccountOwner;
  const sources = await ownerSources(deps, networkId);
  if (!read || !sources) return { error: ADDRESS_IMPORT_REFUSALS.unavailable };
  const { chainId } = STARKNET_NETWORKS[networkId];
  let readings: readonly [AccountOwnerReading, AccountOwnerReading];
  try {
    readings = await Promise.all([
      read({ accountAddress: address, chainId, rpcUrls: sources.primary }),
      read({ accountAddress: address, chainId, rpcUrls: [sources.witness] }),
    ]);
  } catch {
    return { error: ADDRESS_IMPORT_REFUSALS.unavailable };
  }
  const [primary, witness] = readings;
  return sameReading(primary, witness)
    ? verdictOf(primary)
    : { error: ADDRESS_IMPORT_REFUSALS.unconfirmed };
};

/** A pasted address in canonical form, or null when it is not a Starknet address. */
export const canonicalAddress = (value: string): string | null => {
  const address = canonicalFelt(value);
  return address !== null && isNonZeroStarkFieldElement(address) ? address : null;
};

/**
 * The scan's advisory signability verdict for an account found by address
 * (a guardian, a rotated owner, …), or null when the probe has none or does
 * not answer. Advisory, as in the recovery scan: no verdict lists the row
 * unlabelled, and every transaction path re-checks the live signer before
 * signing.
 */
export const advisoryRestriction = async (
  deps: OwnerProofDeps,
  account: Pick<RecoverableAccountRef, "accountContractType" | "address" | "publicKeyX">,
  networkId: StarknetNetworkId,
): Promise<RecoveryAccountCandidate["restriction"] | null> => {
  const probe =
    account.accountContractType === "argent"
      ? deps.runtimeRpc.getArgentSigningRestriction
      : deps.runtimeRpc.getBraavosSigningRestriction;
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[networkId], await deps.preferencesStore.read());
  return (
    (await probe?.({
      accountAddress: account.address,
      publicKeyX: account.publicKeyX,
      rpcUrls,
    }).catch(() => null)) ?? null
  );
};
