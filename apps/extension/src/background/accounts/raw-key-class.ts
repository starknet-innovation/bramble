/**
 * Which Argent release a raw-key import restores.
 *
 * One key maps to a different address under every Argent release, because the
 * class hash and the constructor calldata are both part of the address, and an
 * account keeps the address its deploy class fixed whatever it upgrades to.
 * Importing a Ready key at the release this wallet creates gave a user an empty
 * 0.4.0 address while their real account sat at its 0.3.1 address.
 */
import { recoveryProbeTokens, type WalletPreferencesStore } from "@bramble/settings/preferences";
import type { PreviewImportedAccountInput } from "@bramble/vault/service";
import { deploymentClasses } from "@bramble/wallet-model/account-families";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls } from "../runtime/runtime-state";
import { readAccountActivity } from "./account-activity";
import type { WalletStatusReader } from "./wallet-reader";

/**
 * The deploy class of the Argent account this key already controls: the first
 * deployed release in table order, else the first funded one. Undefined for any
 * other family, or when no release shows on-chain evidence, which keeps the
 * family default (a fresh account this wallet can deploy). Derivation goes
 * through the vault's key-free preview; the key never leaves the background.
 * RPC failures propagate, so an unreachable network fails the import rather
 * than silently storing an address nobody uses.
 */
export const rawKeyImportClass = async (
  deps: {
    readonly preferencesStore: WalletPreferencesStore;
    readonly runtimeRpc: Pick<RuntimeRpc, "getDeploymentStatus" | "getTokenBalances">;
    readonly wallet: Pick<WalletStatusReader, "previewImportedAccount">;
  },
  input: PreviewImportedAccountInput,
): Promise<string | undefined> => {
  const preview = deps.wallet.previewImportedAccount;
  if (input.accountContractType !== "argent" || !preview) return undefined;
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
  return (
    releases.find((release) => release.deployed) ?? releases.find((release) => release.funded)
  )?.classHash;
};
