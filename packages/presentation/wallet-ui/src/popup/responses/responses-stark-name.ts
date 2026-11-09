/**
 * The background's answer to a typed Starknet name. Only a `resolved` outcome
 * carries an address, and it must be a nonzero felt, so a malformed envelope
 * can never be read as a recipient.
 */
import { hasOnlyKnownKeys, isJson, isRecord } from "@bramble/core/json";
import type { StarkNameResolution } from "@bramble/starknet/stark-name";
import {
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "@bramble/wallet-model/networks";

/**
 * A typed Starknet name resolved by the background. `networkId` names the
 * network the read was made on. `resolution` is a discriminated outcome: only
 * `resolved` carries an address, and that address must be a nonzero felt, so a
 * malformed envelope can never be read as a recipient.
 */
export type StarkNameResolutionResponse = {
  readonly networkId: StarknetNetworkId;
  readonly ok: true;
  readonly resolution: StarkNameResolution;
};

const isStarkNameResolution = (value: unknown): value is StarkNameResolution => {
  if (!isRecord(value)) {
    return false;
  }
  switch (value["status"]) {
    case "resolved":
      return (
        hasOnlyKnownKeys(value, ["address", "status"]) &&
        typeof value["address"] === "string" &&
        isNonZeroStarkFieldElement(value["address"])
      );
    case "not-found":
    case "unreachable":
    case "unsupported-network":
      return hasOnlyKnownKeys(value, ["status"]);
    default:
      return false;
  }
};

/**
 * Checks a name-resolution response before the recipient step trusts it. The
 * network is required: a reply that does not name the network it was read on
 * cannot be bound to the network the panel is showing, so it fails closed.
 */
export const isStarkNameResolutionResponse = (
  value: unknown,
): value is StarkNameResolutionResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["networkId", "ok", "resolution"]) &&
  value["ok"] === true &&
  isStarknetNetworkId(value["networkId"]) &&
  isStarkNameResolution(value["resolution"]);
