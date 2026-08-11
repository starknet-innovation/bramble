/**
 * Finds the accounts a restored recovery phrase already has on chain.
 *
 * Importing a phrase only rebuilds the account at HD index 0, so a wallet that
 * previously used several accounts came back looking empty. This walks the HD
 * positions, asks an injected probe whether each one exists on chain, and
 * reports the ones worth restoring.
 *
 * Derivation runs through Krusty and yields public metadata only
 * ({@link deriveAccountRef}); no private key is materialized, returned, or
 * logged, and the phrase is read from the already-decrypted vault rather than
 * accepted from a caller. The probe is injected so this module stays free of
 * network and clock access and can be tested against fixed chain answers.
 */

import type { KrustyKms } from "../crypto/krusty";
import { WalletError } from "../shared/errors";
import type { StarknetNetworkId } from "../starknet/networks";
import type { DerivedAccountRef, Vault } from "../storage/vault-schema";
import { deriveAccountRef } from "./accounts";

/**
 * Highest HD account index probed. Bounded so one scan can never turn into an
 * unbounded walk against a node, and so its worst-case cost is predictable.
 */
export const SEED_SCAN_MAX_INDEX = 19;

/**
 * Consecutive positions with nothing on chain that end the walk.
 *
 * A gap limit rather than a hard count: real wallets leave holes (an account
 * created then abandoned), so stopping at the first empty position would miss
 * everything after it, while probing all twenty every time makes the common
 * single-account phrase pay for nineteen positions nobody used.
 */
export const SEED_SCAN_GAP_LIMIT = 5;

/**
 * What the chain says about one candidate address.
 *
 * Two independent reasons to restore an account, either sufficient: it has been
 * deployed, or it holds a balance. `funded` may be left unread when `deployed`
 * is already true — the caller decides, and this module treats a missing answer
 * as "no".
 */
export type SeedScanProbeResult = {
  readonly deployed: boolean;
  readonly funded: boolean;
};

/**
 * One HD position that exists on chain, with the reason it qualified.
 */
export type SeedAccountCandidate = {
  readonly account: DerivedAccountRef;
  readonly accountIndex: number;
  readonly deployed: boolean;
  readonly funded: boolean;
};

/**
 * A scan's inputs: the network to derive and probe on, and the chain lookup.
 */
export type SeedAccountScanInput = {
  readonly networkId: StarknetNetworkId;
  readonly probe: (address: string) => Promise<SeedScanProbeResult>;
};

/**
 * Walks HD positions on one network and returns those that exist on chain.
 *
 * Stops after {@link SEED_SCAN_GAP_LIMIT} consecutive empty positions or at
 * {@link SEED_SCAN_MAX_INDEX}, whichever comes first. Index 0 is always probed
 * and reported when it qualifies, so a caller can tell a restored phrase's first
 * account apart from one that was never used.
 *
 * Throws a {@link WalletError} when the vault holds no recovery phrase — a
 * Ledger-only or raw-key vault has no HD positions to walk. A probe that throws
 * propagates: a scan that silently treats an unreachable node as "no accounts
 * here" would report an empty wallet as the truth.
 */
export const scanSeedAccounts = async (
  kms: KrustyKms,
  vault: Vault,
  input: SeedAccountScanInput,
): Promise<readonly SeedAccountCandidate[]> => {
  if (!vault.mnemonic) {
    throw new WalletError("No recovery phrase stored for this wallet");
  }
  const found: SeedAccountCandidate[] = [];
  let consecutiveEmpty = 0;
  for (let accountIndex = 0; accountIndex <= SEED_SCAN_MAX_INDEX; accountIndex += 1) {
    const account = await deriveAccountRef(kms, {
      accountIndex,
      mnemonic: vault.mnemonic,
      networkId: input.networkId,
    });
    const { deployed, funded } = await input.probe(account.address);
    if (!deployed && !funded) {
      consecutiveEmpty += 1;
      if (consecutiveEmpty >= SEED_SCAN_GAP_LIMIT) {
        return found;
      }
      continue;
    }
    consecutiveEmpty = 0;
    found.push({ account, accountIndex, deployed, funded });
  }
  return found;
};
