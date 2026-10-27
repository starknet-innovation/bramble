/**
 * Reads what a user pastes to find an account by its address (issue 398): a
 * Starknet address, or an explorer link to one. Pure; the background
 * re-validates the address and reads the chain itself.
 */

import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  normalizeFeltInput,
  STARKNET_NETWORKS,
  type StarknetNetworkId,
} from "@bramble/wallet-model/networks";

// The explorers people copy account links from, by host, and the network each
// host serves. A link to any other host is not read.
const EXPLORER_NETWORKS: Readonly<Record<string, StarknetNetworkId>> = {
  "sepolia.starkscan.co": "SN_SEPOLIA",
  "sepolia.voyager.online": "SN_SEPOLIA",
  "starkscan.co": "SN_MAIN",
  "voyager.online": "SN_MAIN",
  "www.starkscan.co": "SN_MAIN",
  "www.voyager.online": "SN_MAIN",
};

// Explorer paths that name an account: `/contract/0x…` on both, `/account/0x…`
// on Starkscan.
const EXPLORER_PATH = /^\/(?:contract|account)\/(0x[0-9a-fA-F]{1,64})\/?$/;

/**
 * A pasted address read as a canonical felt, or why it cannot be: not an
 * address, or an explorer link copied over plain `http://`, which is refused
 * but named, so the reader knows which link to copy instead.
 */
export type PastedAddress =
  | { readonly address: string; readonly network?: StarknetNetworkId }
  | { readonly reason: "insecure-link" | "invalid" };

const asAddress = (value: string): string | null => {
  const felt = normalizeFeltInput(value);
  const canonical = canonicalFelt(felt);
  return canonical !== null && isNonZeroStarkFieldElement(canonical) ? canonical : null;
};

const fromExplorerLink = (text: string): PastedAddress => {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { reason: "invalid" };
  }
  const network = EXPLORER_NETWORKS[url.hostname.toLowerCase()];
  const match = EXPLORER_PATH.exec(url.pathname);
  const address = match?.[1] === undefined ? null : asAddress(match[1]);
  if (network === undefined || address === null) return { reason: "invalid" };
  if (url.protocol === "http:") return { reason: "insecure-link" };
  return url.protocol === "https:" ? { address, network } : { reason: "invalid" };
};

/**
 * Reads a pasted address or Starkscan/Voyager account link. A link also names
 * its network, so the caller can say when it is not the one being searched.
 */
export const readPastedAddress = (input: string): PastedAddress => {
  const text = input.trim();
  if (/^https?:\/\//i.test(text)) return fromExplorerLink(text);
  const address = asAddress(text);
  return address === null ? { reason: "invalid" } : { address };
};

/** The display name of a network id the panel holds, falling back to the id. */
export const networkName = (networkId: string): string =>
  (STARKNET_NETWORKS as Readonly<Record<string, { readonly name: string }>>)[networkId]?.name ??
  networkId;
