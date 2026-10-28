/**
 * Which recovery candidates the phrase scan lists without on-chain evidence:
 * index zero at each family's current class (Bramble, Ready and Braavos, view
 * only where Bramble can't create the account); older releases and classes only
 * once they exist on chain. Split from recovery-discovery.test.ts for size.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import type { AccountDerivationInput } from "@bramble/vault/accounts";
import {
  BRAAVOS_BASE_CLASS_HASH,
  BRAAVOS_DEPLOYMENT_CLASS_HASH,
} from "@bramble/wallet-model/account-families";
import {
  type AccountContractType,
  ARGENT_ACCOUNT_CLASS_HASH,
  type DerivedAccountRef,
  OPENZEPPELIN_ACCOUNT_CLASS_HASH,
} from "@bramble/wallet-model/accounts";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import type { RecoveryAccountCandidate } from "@bramble/wallet-model/recovery";
import { handleOnboardingOps } from "../../../apps/extension/src/background/onboarding/onboarding-ops";
import { createRecoveryDiscoveryCache } from "../../../apps/extension/src/background/onboarding/recovery-cache";
import { defaultRuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createActiveStateCoordinator } from "../../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { walletStub } from "../../support/key-boundary-collaborators";

describe("recovery discovery listing", () => {
  test("lists an older release or class only once it exists on chain", async () => {
    // Index zero shows at each family's current class; older ones only once used.
    const familyAccount = (input: AccountDerivationInput): DerivedAccountRef => {
      const accountIndex = input.accountIndex ?? 0;
      const family = input.accountContractType;
      const classHash =
        canonicalFelt(
          input.classHash ??
            (family === "argent" ? ARGENT_ACCOUNT_CLASS_HASH : OPENZEPPELIN_ACCOUNT_CLASS_HASH),
        ) ?? "";
      const code = { argent: "a", braavos: "b", openzeppelin: "c" }[family];
      const address = `0x${code}${classHash.slice(2, 10)}${accountIndex.toString(16)}`;
      const core = {
        address,
        classHash,
        derivation: { accountIndex, addressIndex: 0, kind: "starknet-bip44" as const },
        id: `SN_MAIN:${address}`,
        networkId: "SN_MAIN" as const,
        publicKeyX: "0x123",
        publicKeyY: "0x456",
      };
      return family === "openzeppelin"
        ? { ...core, accountContractType: family }
        : { ...core, accountContractType: family, deploymentSalt: "0x123" };
    };
    const braavosBase = familyAccount({
      accountContractType: "braavos",
      accountIndex: 0,
      classHash: BRAAVOS_BASE_CLASS_HASH,
      mnemonic: "",
    });
    const deps = {
      activeStateCoordinator: createActiveStateCoordinator(),
      preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
      recoveryDiscovery: createRecoveryDiscoveryCache(),
      runtimeRpc: {
        ...defaultRuntimeRpc,
        async getDeploymentStatus({ accountAddress }: { readonly accountAddress: string }) {
          return accountAddress === braavosBase.address;
        },
        async getTokenBalances({
          tokens,
        }: Parameters<typeof defaultRuntimeRpc.getTokenBalances>[0]) {
          return tokens.map((token) => ({ ...token, balance: "0", formatted: "0" }));
        },
      },
      session: createUnlockSession(),
      wallet: {
        ...walletStub,
        async previewAccount(input: AccountDerivationInput) {
          return familyAccount(input);
        },
      },
    };

    const result = await handleOnboardingOps(deps, "wallet.discoverRecoveryAccounts", {
      manualIndex: 0,
      mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
      networkId: "SN_MAIN",
      type: "wallet.discoverRecoveryAccounts",
    });

    const listed = (result as { readonly candidates: readonly RecoveryAccountCandidate[] })
      .candidates;
    const today = (accountContractType: AccountContractType, classHash: string): string =>
      familyAccount({ accountContractType, accountIndex: 0, classHash, mnemonic: "" }).address;
    expect(listed.map(({ account }) => account.address).sort()).toEqual(
      [
        today("openzeppelin", OPENZEPPELIN_ACCOUNT_CLASS_HASH),
        today("argent", ARGENT_ACCOUNT_CLASS_HASH),
        today("braavos", BRAAVOS_DEPLOYMENT_CLASS_HASH),
        braavosBase.address,
      ].sort(),
    );
    expect(listed.find(({ account }) => account.address === braavosBase.address)?.deployed).toBe(
      true,
    );
  });
});
