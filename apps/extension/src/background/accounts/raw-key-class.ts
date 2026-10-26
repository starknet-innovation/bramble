/**
 * Which Argent release a raw-key import restores.
 *
 * One key maps to a different address under every Argent release, because the
 * class hash and the constructor calldata are both part of the address, and an
 * account keeps the address its deploy class fixed whatever it upgrades to.
 * Importing a Ready key at the release this wallet creates gave a user an empty
 * 0.4.0 address while their real account sat at its 0.3.1 address.
 */
import { RefusedBeforeWrite, WalletError } from "@bramble/core/errors";
import { recoveryProbeTokens, type WalletPreferencesStore } from "@bramble/settings/preferences";
import type { PreviewImportedAccountInput } from "@bramble/vault/service";
import { deploymentClasses } from "@bramble/wallet-model/account-families";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls } from "../runtime/runtime-state";
import { readAccountActivity } from "./account-activity";
import type { WalletStatusReader } from "./wallet-reader";

/** Raw diagnostic for a Ready key with no account behind it on this network. */
export const NO_READY_ACCOUNT_FOR_KEY = "No deployed or funded Ready account uses this key";

/**
 * The deploy class of the Argent account this key already controls: the first
 * deployed release in table order, else the first funded one. Undefined for any
 * other family. A Ready key with no on-chain evidence under any release is
 * refused before anything is written: this wallet creates its own accounts
 * from its phrase, so a raw-key "Ready Account" exists only to restore one,
 * and storing an empty address would read as a successful import of the
 * user's account. Derivation goes through the vault's key-free preview; the
 * key never leaves the background. RPC failures propagate, so an unreachable
 * network fails the import too.
 */
export const rawKeyImportClass = async (
  deps: {
    readonly preferencesStore: WalletPreferencesStore;
    readonly runtimeRpc: Pick<RuntimeRpc, "getDeploymentStatus" | "getTokenBalances">;
    readonly wallet: Pick<WalletStatusReader, "previewImportedAccount">;
  },
  input: PreviewImportedAccountInput,
): Promise<string | undefined> => {
  if (input.accountContractType !== "argent") return undefined;
  const preview = deps.wallet.previewImportedAccount;
  if (!preview) throw new WalletError("wallet unavailable");
  const preferences = await deps.preferencesStore.read();
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[input.networkId], preferences);
  const tokens = recoveryProbeTokens().filter((token) => token.networkId === input.networkId);
  const releases = await Promise.all(
    deploymentClasses("argent").map(async (entry) => {
      const account = await preview({ ...input, classHash: entry.classHash });
      const activity = await readAccountActivity(deps.runtimeRpc, {
        accountAddress: account.address,
        rpcUrls,
        tokens,
      });
      return { classHash: entry.classHash, ...activity };
    }),
  );
  const found =
    releases.find((release) => release.deployed) ?? releases.find((release) => release.funded);
  if (!found) throw new RefusedBeforeWrite(NO_READY_ACCOUNT_FOR_KEY);
  return found.classHash;
};
