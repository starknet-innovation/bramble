/**
 * Renders `mobile/core/generated/multisig.json`: the multisig and Nostr coordination constants the
 * mobile Rust core embeds at compile time. Every value is read from the extension module that owns
 * it, so the core never restates a limit, a relay, a lookback window, or the pinned class by hand.
 */
import { MULTISIG_LIMITS } from "@bramble/multisig/chain";
import {
  MAX_CHECKPOINTS,
  MAX_SEEN_EVENT_IDS,
  MAX_SYNC_SECONDS,
} from "@bramble/multisig/coordination";
import { MAX_MULTISIGS } from "@bramble/multisig/repository";
import { ARGENT_MULTISIG_CONTRACT } from "@bramble/starknet/account-contracts";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import {
  MAX_NOSTR_APPLICATION_DATA_BYTES,
  MAX_NOSTR_BATCH_ITEMS,
  MAX_NOSTR_EVENT_JSON_BYTES,
} from "@bramble/wallet-model/nostr";
import {
  MULTISIG_NOSTR_IDENTIFIER,
  NOSTR_INCREMENTAL_LOOKBACK_SECONDS,
  NOSTR_SYNC_LOOKBACK_SECONDS,
} from "../../apps/extension/src/background/multisig/multisig-coordination-ops";
import { MULTISIG_NOSTR_RELAYS } from "../../apps/extension/src/background/multisig/nostr-relay";
import {
  MAX_RELAY_FRAME_BYTES,
  RELAY_TIMEOUT_MS,
} from "../../apps/extension/src/background/multisig/nostr-relay-socket";
import { HEADER } from "./shared";

/** Repository-relative path of the multisig constants the Rust core embeds. */
export const MULTISIG_JSON_PATH = "mobile/core/generated/multisig.json";

// Biome keeps short arrays of strings or numbers on one line; the committed file must match it.
const collapseShortArrays = (json: string): string =>
  json.replace(
    /\[\n\s+((?:"[^"\n]*"|-?\d+)(?:,\n\s+(?:"[^"\n]*"|-?\d+))*)\n\s*\]/g,
    (_, items: string) => `[${items.split(/,\n\s+/).join(", ")}]`,
  );

/** The constants file, deterministic for a given extension source tree. */
export const renderMultisigConstants = (): string =>
  `${collapseShortArrays(
    JSON.stringify(
      {
        argentMultisig: {
          classHash: ARGENT_MULTISIG_CONTRACT.classHash,
        },
        // Every network a wallet card may name, so mobile tells "another network" from "unknown".
        cardNetworkIds: Object.keys(STARKNET_NETWORKS),
        coordination: {
          identifier: MULTISIG_NOSTR_IDENTIFIER,
          incrementalLookbackSeconds: NOSTR_INCREMENTAL_LOOKBACK_SECONDS,
          maxCheckpoints: MAX_CHECKPOINTS,
          maxSeenEventIds: MAX_SEEN_EVENT_IDS,
          maxSyncSeconds: MAX_SYNC_SECONDS,
          syncLookbackSeconds: NOSTR_SYNC_LOOKBACK_SECONDS,
        },
        generatedBy: HEADER,
        limits: {
          multisigs: MAX_MULTISIGS,
          nameLength: MULTISIG_LIMITS.nameLength,
          signers: MULTISIG_LIMITS.signers,
          summaryLength: MULTISIG_LIMITS.summaryLength,
        },
        nostr: {
          maxApplicationDataBytes: MAX_NOSTR_APPLICATION_DATA_BYTES,
          maxBatchItems: MAX_NOSTR_BATCH_ITEMS,
          maxEventJsonBytes: MAX_NOSTR_EVENT_JSON_BYTES,
        },
        relays: {
          defaults: MULTISIG_NOSTR_RELAYS,
          maxFrameBytes: MAX_RELAY_FRAME_BYTES,
          timeoutMs: RELAY_TIMEOUT_MS,
        },
      },
      null,
      2,
    ),
  )}\n`;
