/**
 * Live-state rules for whether this wallet may sign for a deployed Braavos
 * account, shared by the authoritative fail-closed gates and the advisory
 * recovery-scan probe so the two cannot drift apart.
 *
 * Mirrors the account contract (braavos-account-cairo): a two-felt `(r, s)`
 * is verified against the FIRST registered stark signer only, and any active
 * strong signer (secp256r1 or webauthn — Braavos 2FA/3FA) makes the account
 * demand a device approval this wallet cannot produce, until a deferred
 * removal request has expired by the block's own timestamp.
 */
import { WalletError } from "@bramble/core/errors";
import { BRAAVOS_SIGNING_CLASS_HASHES } from "@bramble/wallet-model/account-families";
import { sameFelt } from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";

/** The account fields the Braavos signer rules read. */
export type BraavosSignerSubject = {
  readonly address: string;
  readonly publicKeyX: string;
};

/**
 * The signer state's verdict: null when the wallet key can sign alone,
 * `owner-changed` when the wallet key is not the account's first stark signer,
 * `strong-signer` when an unexpired 2FA/3FA signer is active.
 */
export type BraavosSignerVerdict = "owner-changed" | "strong-signer" | null;

// get_signers serializes three felt arrays: [stark_len, ...stark,
// secp256r1_len, ...secp256r1, webauthn_len, ...webauthn].
type BraavosSigners = {
  readonly stark: readonly string[];
  readonly strongCount: number;
};

const parseBraavosSigners = (result: readonly string[]): BraavosSigners => {
  const take = (offset: number): { readonly next: number; readonly values: readonly string[] } => {
    const length = Number(BigInt(result[offset] ?? "0x0"));
    if (!Number.isSafeInteger(length) || length < 0 || offset + 1 + length > result.length) {
      throw new WalletError("Braavos account returned a malformed signer list");
    }
    return { next: offset + 1 + length, values: result.slice(offset + 1, offset + 1 + length) };
  };
  const stark = take(0);
  const secp256r1 = take(stark.next);
  const webauthn = take(secp256r1.next);
  return {
    stark: stark.values,
    strongCount: secp256r1.values.length + webauthn.values.length,
  };
};

/**
 * Whether a live class is a Braavos implementation release this wallet signs
 * for. Base/deployment classes are not: a deployed account never legitimately
 * runs one, so their authorization rules are not assumed.
 */
export const isBraavosSigningClass = (classHash: string): boolean =>
  BRAAVOS_SIGNING_CLASS_HASHES.some((known) => sameFelt(known, classHash));

/**
 * Refuses a live class that is not a Braavos implementation release this
 * wallet signs for. Worded apart from the signer refusals because "unknown
 * release" and "extra signer" lead a user elsewhere.
 */
export const requireBraavosSigningClass = (classHash: string): void => {
  if (!isBraavosSigningClass(classHash)) {
    throw new WalletError("Deployed Braavos account class is not a release this wallet recognizes");
  }
};

/**
 * Reads the account's signers (and, only when a strong signer exists, its
 * deferred-removal request and the block timestamp) at `blockIdentifier` and
 * classifies them. A removal request counts as expired only once the block's
 * timestamp is strictly after `expire_at`. Throws on a malformed signer list
 * or an RPC failure; callers decide whether that is fail-closed or "no verdict".
 */
export const braavosSignerVerdict = async (
  provider: RpcProvider,
  account: BraavosSignerSubject,
  blockIdentifier: string,
): Promise<BraavosSignerVerdict> => {
  const read = (entrypoint: string) =>
    provider.callContract(
      { calldata: [], contractAddress: account.address, entrypoint },
      blockIdentifier,
    );
  const { stark, strongCount } = parseBraavosSigners(await read("get_signers"));
  const [firstStark] = stark;
  if (firstStark === undefined || !sameFelt(firstStark, account.publicKeyX)) {
    return "owner-changed";
  }
  if (strongCount === 0) {
    return null;
  }
  const [expireAtFelt] = await read("get_deferred_remove_signers");
  const expireAt = expireAtFelt === undefined ? 0n : BigInt(expireAtFelt);
  if (expireAt === 0n) {
    return "strong-signer";
  }
  const block = await provider.getBlock(blockIdentifier);
  return BigInt(block.timestamp) > expireAt ? null : "strong-signer";
};

/**
 * Refuses a deployed Braavos account this wallet cannot sign for at the pinned
 * block: the wallet key must be the first stark signer, and no strong signer
 * may be active unless its deferred removal has expired. Fail-closed:
 * malformed reads refuse rather than sign a transaction the account rejects.
 */
export const requireCompatibleBraavosSigner = async (
  provider: RpcProvider,
  account: BraavosSignerSubject,
  blockIdentifier: string,
): Promise<void> => {
  const verdict = await braavosSignerVerdict(provider, account, blockIdentifier);
  if (verdict === "owner-changed") {
    throw new WalletError("Deployed Braavos account owner does not match the wallet signer");
  }
  if (verdict === "strong-signer") {
    throw new WalletError("Deployed Braavos account has an active 2FA signer");
  }
};
