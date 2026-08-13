/**
 * Pure presentation and offline-review helpers for public Multisig state.
 * Packages contain only values already stored as public on-chain metadata;
 * parsing treats pasted JSON as untrusted and fails closed.
 */

import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import { multisigCallMatchesId } from "@mc-wallet/multisig/chain";
import {
  isMultisigProposalRecord,
  isMultisigRecord,
  type MultisigProposalCall,
  type MultisigProposalRecord,
  type MultisigRecord,
  multisigAddressBookEntry,
} from "@mc-wallet/multisig/repository";
import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import { verifyCalls } from "@mc-wallet/transactions/verify";
import { verificationContext } from "@mc-wallet/transactions/verify-decode";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { sameFelt } from "@mc-wallet/wallet-model/networks";
import type { Call } from "starknet";
import { accountLabel } from "../../shared/parts";

/**
 * Stable, secret-free package users can copy into an independent decoder.
 */
export type MultisigReviewPackage = {
  readonly kind: "mc-wallet-multisig-proposal";
  readonly multisig: MultisigRecord;
  readonly proposal: MultisigProposalRecord;
  readonly version: 1;
};

/**
 * Human-readable proposal effect plus target identity derived from exact call
 * data. Unknown calls remain explicitly unknown and retain their raw details.
 */
export type MultisigProposalEffect = {
  readonly flags: readonly string[];
  readonly summary: string;
  readonly targetKind: string;
  readonly targetLabel: string;
};

/**
 * Resolves the user-facing name shared by Multisig surfaces.
 */
export const multisigDisplayName = (record: MultisigRecord): string =>
  record.name ?? accountLabel(record.address);

const asCall = (call: MultisigProposalCall): Call => ({
  calldata: [...call.calldata],
  contractAddress: call.contractAddress,
  entrypoint: call.entrypoint,
});

/**
 * Decodes one proposal against the wallet's tracked-token and trusted-recipient
 * context without network access. Cached labels never alter the exact call.
 */
export const multisigProposalEffect = (
  call: MultisigProposalCall,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
  multisig: MultisigRecord | null = null,
): MultisigProposalEffect => {
  const token = preferences?.tokens.find((stored) =>
    sameFelt(stored.address, call.contractAddress),
  );
  const targetLabel = token?.symbol ?? accountLabel(call.contractAddress);
  const targetKind = token ? "Tracked ERC-20" : "Unknown contract";
  if (!account) {
    return {
      flags: token ? [] : ["Verify this contract address independently."],
      summary: `Call ${call.entrypoint} on ${targetLabel}`,
      targetKind,
      targetLabel,
    };
  }
  // Built through the shared trusted-set builder rather than a local literal,
  // so this review scopes contacts, tokens, and watched collections to the
  // account's network exactly as every background review path does.
  const report = verifyCalls(
    [asCall(call)],
    verificationContext(account, {
      addressBook: [
        ...(preferences?.addressBook ?? []),
        ...(multisig ? [multisigAddressBookEntry(multisig)] : []),
      ],
      nfts: preferences?.nfts ?? [],
      tokens: preferences?.tokens ?? [],
    }),
  );
  return {
    flags: report.flags.map((flag) => flag.message),
    summary: report.calls[0]?.summary ?? `Call ${call.entrypoint} on ${targetLabel}`,
    targetKind,
    targetLabel,
  };
};

/**
 * Serializes a deterministic public review package. Property order is fixed so
 * copies of the same stored snapshot are byte-for-byte identical.
 */
export const serializeMultisigReviewPackage = (
  multisig: MultisigRecord,
  proposal: MultisigProposalRecord,
): string =>
  JSON.stringify({
    kind: "mc-wallet-multisig-proposal",
    multisig,
    proposal,
    version: 1,
  } satisfies MultisigReviewPackage);

/**
 * Parses an untrusted review package and verifies both stored schemas plus the
 * proposal-to-Multisig relationship. Invalid input returns null.
 */
export const parseMultisigReviewPackage = (raw: string): MultisigReviewPackage | null => {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      !hasOnlyKnownKeys(value, ["kind", "multisig", "proposal", "version"]) ||
      value["kind"] !== "mc-wallet-multisig-proposal" ||
      value["version"] !== 1 ||
      !isMultisigRecord(value["multisig"]) ||
      !isMultisigProposalRecord(value["proposal"]) ||
      value["proposal"].multisigId !== value["multisig"].id ||
      (value["proposal"].call !== null &&
        !multisigCallMatchesId(
          value["proposal"].call,
          value["proposal"].call.salt,
          value["proposal"].txId,
        ))
    ) {
      return null;
    }
    return value as MultisigReviewPackage;
  } catch {
    return null;
  }
};

/**
 * Compact QR payload for a proposal identifier. The full exact package remains
 * available beside it for offline copy/paste review.
 */
export const multisigProposalQrPayload = (proposal: MultisigProposalRecord): string =>
  `mcwallet:multisig-proposal:v1:${proposal.txId}`;
