/**
 * Whether an account was registered with the privacy pool by another wallet.
 *
 * Import never reads the pool. This runs at the point of use, before any
 * proof, signature, or fee. A non-zero pool key is write-once, so it may be
 * remembered; a zero key is not, because the address can still be registered.
 * A failed read or derivation is not a foreign registration: the caller retries
 * the private action and leaves public actions alone.
 *
 * Trust boundary: the pool answer is untrusted chain state and is compared
 * only as a field element. The vault returns the public x-coordinate this
 * wallet would register; the viewing key itself never leaves the vault.
 */

import type { WalletPreferences } from "@bramble/settings/preferences";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { canonicalFelt, STARKNET_NETWORKS, sameFelt } from "@bramble/wallet-model/networks";
import {
  PRIVACY_OTHER_WALLET_ACTION,
  PRIVACY_REGISTRATION_UNCHECKED,
} from "@bramble/wallet-protocol/privacy-blocker";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import type { RuntimeRpc } from "../runtime/runtime-rpc";

const poolKeyCache = new Map<string, string>();

const cacheId = (chainId: string, poolAddress: string, address: string): string =>
  `${chainId}:${poolAddress}:${address}`;

/** Drops remembered pool keys. Tests use this so one file cannot leak into the next. */
export const clearStrk20PoolKeyCache = (): void => {
  poolKeyCache.clear();
};

/**
 * Whether `registered` is a viewing public key this wallet would not register.
 * Zero (never registered) and a matching key are not. Both arguments are field
 * elements; equality is numeric, so padding cannot hide a match.
 */
export const isForeignStrk20Registration = (registered: string, ownPublicKey: string): boolean =>
  BigInt(registered) !== 0n && !sameFelt(registered, ownPublicKey);

/** A private-action refusal. `service` retries; `other-wallet` is permanent. */
export type Strk20RegistrationBlock = {
  readonly error: string;
  readonly privacyBlocker: "other-wallet" | "service";
};

const unchecked = (): Strk20RegistrationBlock => ({
  error: PRIVACY_REGISTRATION_UNCHECKED,
  privacyBlocker: "service",
});

const foreign = (): Strk20RegistrationBlock => ({
  error: PRIVACY_OTHER_WALLET_ACTION,
  privacyBlocker: "other-wallet",
});

// A remembered non-zero key, a zero key (not remembered), or a read that failed.
const readPoolKey = async (
  read: RuntimeRpc["getStrk20PublicKey"],
  id: string,
  address: string,
  poolAddress: string,
  rpcUrls: readonly string[],
): Promise<"clear" | "retry" | string> => {
  const cached = poolKeyCache.get(id);
  if (cached !== undefined) return cached;
  if (!read) return "retry";
  let raw: string;
  try {
    raw = await read({ address, poolAddress, rpcUrls });
  } catch {
    return "retry";
  }
  let value: bigint;
  try {
    value = BigInt(raw);
  } catch {
    return "retry";
  }
  if (value === 0n) return "clear";
  const canonical = canonicalFelt(raw);
  if (!canonical) return "retry";
  poolKeyCache.set(id, canonical);
  return canonical;
};

const ownPublicKey = async (
  wallet: WalletStatusReader,
  accountId: string,
  chainId: string,
  poolAddress: string,
  passphrase: string,
): Promise<string | null> => {
  const preview = wallet.previewStoredStrk20ViewingPublicKey;
  if (!preview) return null;
  try {
    return await preview({ accountId, chainId, poolAddress, vaultPassphrase: passphrase });
  } catch {
    return null;
  }
};

/**
 * The private-action block for `account`, or null when privacy may proceed.
 *
 * Ledger accounts return null without a pool read: the ledger blocker is
 * applied by the caller first. TODO: once Ledger provisioning ships, compare
 * the pool key with the public key of the retained viewing key
 * (`ledger-strk20-typed-data-v1` in account-secrets) instead of skipping, so a
 * Bramble-registered Ledger account is not treated as another wallet's.
 * A missing reader, an unreadable pool, or a failed derivation answers
 * `service` with the retry line. A zero key is not remembered.
 */
export const strk20RegistrationBlock = async (input: {
  readonly account: AccountRef;
  readonly passphrase: string;
  readonly preferences: Pick<WalletPreferences, "strk20Networks">;
  readonly readRegistered: RuntimeRpc["getStrk20PublicKey"];
  readonly rpcUrls: readonly string[];
  readonly wallet: WalletStatusReader;
}): Promise<Strk20RegistrationBlock | null> => {
  if (input.account.derivation.kind === "ledger") return null;
  const configured = input.preferences.strk20Networks?.[input.account.networkId]?.poolAddress;
  const poolAddress = configured === undefined ? null : canonicalFelt(configured);
  if (!poolAddress) return null;
  const address = canonicalFelt(input.account.address);
  if (!address) return unchecked();
  const chainId = STARKNET_NETWORKS[input.account.networkId].chainId;
  const registered = await readPoolKey(
    input.readRegistered,
    cacheId(chainId, poolAddress, address),
    address,
    poolAddress,
    input.rpcUrls,
  );
  if (registered === "clear") return null;
  if (registered === "retry") return unchecked();
  const own = await ownPublicKey(
    input.wallet,
    input.account.id,
    chainId,
    poolAddress,
    input.passphrase,
  );
  if (own === null) return unchecked();
  return isForeignStrk20Registration(registered, own) ? foreign() : null;
};
