/**
 * Shared fixtures for the Ready-key suites (issue 776): one distinct address
 * per Argent release, an RPC double that answers deployment and balances from
 * listed evidence, and a wallet that captures what an import would write.
 */
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import type { ImportRawKeyAccountInput, PreviewImportedAccountInput } from "@bramble/vault/service";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  deploymentClasses,
} from "@bramble/wallet-model/account-families";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import { defaultRuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { account, createWallet, vaultPassphrase } from "../../support/background-wallet-stub";

// Clearly-fake test vector; not a real key.
const privateKey = "0xfeedface";

const argentClass = (label: string): string => {
  const entry = deploymentClasses("argent").find((candidate) => candidate.label === label);
  if (!entry) throw new Error(`missing ${label}`);
  return entry.classHash;
};
export const ARGENT_031 = argentClass("argent 0.3.1");
export const ARGENT_030 = argentClass("argent 0.3.0");

// One distinct address per release, as real derivation gives.
export const addressFor = (classHash: string | undefined): string =>
  `0xa${(canonicalFelt(classHash ?? ARGENT_ACCOUNT_CLASS_HASH) ?? "").slice(2, 12)}`;

const previewImportedAccount = async (input: PreviewImportedAccountInput): Promise<AccountRef> => ({
  ...account,
  address: addressFor(input.classHash),
  id: `SN_MAIN:${addressFor(input.classHash)}`,
});

export type Evidence = {
  readonly deployed?: readonly string[];
  readonly funded?: readonly string[];
};

export const rpcWith = (evidence: Evidence, onRead?: () => void) => ({
  ...defaultRuntimeRpc,
  async getDeploymentStatus({ accountAddress }: { readonly accountAddress: string }) {
    onRead?.();
    return (evidence.deployed ?? []).some((classHash) => accountAddress === addressFor(classHash));
  },
  async getTokenBalances({
    accountAddress,
    tokens,
  }: Parameters<typeof defaultRuntimeRpc.getTokenBalances>[0]) {
    const funded = (evidence.funded ?? []).some(
      (classHash) => accountAddress === addressFor(classHash),
    );
    return tokens.map((token, index) => ({
      ...token,
      balance: funded && index === 0 ? "1" : "0",
      formatted: funded && index === 0 ? "0.000000000000000001" : "0",
    }));
  },
});

export const deps = (evidence: Evidence) => ({
  preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
  runtimeRpc: rpcWith(evidence),
  wallet: { previewImportedAccount },
});
export const input = { networkId: "SN_MAIN" as const, privateKey };

export const unlocked = () => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  return session;
};

export const capturingWallet = (
  captured: ImportRawKeyAccountInput[],
  hasVault: boolean | (() => boolean) = true,
) => {
  const wallet = createWallet();
  return {
    ...wallet,
    async importRawKeyAccount(request: ImportRawKeyAccountInput) {
      captured.push(request);
      return account;
    },
    previewImportedAccount,
    async status() {
      return {
        ...(await wallet.status()),
        hasVault: typeof hasVault === "function" ? hasVault() : hasVault,
      };
    },
  };
};

export const discoverMessage = {
  networkId: "SN_MAIN",
  privateKey,
  type: "wallet.discoverReadyKeyAccounts",
};
export const importMessage = (classHashes?: readonly string[]) => ({
  accountContractType: "argent",
  ...(classHashes === undefined ? {} : { classHashes }),
  networkId: "SN_MAIN",
  privateKey,
  type: "wallet.importAccount",
});
