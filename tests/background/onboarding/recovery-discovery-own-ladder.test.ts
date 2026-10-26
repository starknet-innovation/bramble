/**
 * Argent 0.3.x accounts whose keys sit on this wallet's own ladder.
 *
 * Reported on Mainnet: a Ready account deployed at Argent 0.3.1, since upgraded
 * to 0.4.0 and given a guardian, whose owner key is the phrase's plain BIP-44
 * key rather than the Ready extension's ETH-seeded one. The scan derived the
 * right key but tried only Argent 0.4.0 on that ladder, so it offered a fresh
 * 0.4.0 address that belongs to nobody, and the user imported that instead.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import type { AccountDerivationInput } from "@bramble/vault/accounts";
import { deploymentClasses } from "@bramble/wallet-model/account-families";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  type RecoverableAccountRef,
} from "@bramble/wallet-model/accounts";
import { canonicalFelt, sameFelt } from "@bramble/wallet-model/networks";
import type { RecoveryAccountCandidate } from "@bramble/wallet-model/recovery";
import { handleOnboardingOps } from "../../../apps/extension/src/background/onboarding/onboarding-ops";
import { createRecoveryDiscoveryCache } from "../../../apps/extension/src/background/onboarding/recovery-cache";
import { defaultRuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createActiveStateCoordinator } from "../../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { walletStub } from "../../support/key-boundary-collaborators";

const ARGENT_031 = deploymentClasses("argent").find((entry) => entry.label === "argent 0.3.1");

// One distinct address per (family, ladder, class, index), as real derivation gives.
const accountFor = (input: AccountDerivationInput): RecoverableAccountRef => {
  const accountIndex = input.accountIndex ?? 0;
  const classHash =
    canonicalFelt(input.classHash ?? ARGENT_ACCOUNT_CLASS_HASH) ?? ARGENT_ACCOUNT_CLASS_HASH;
  const ready = input.derivation === "argentx-bip44";
  const address =
    input.accountContractType === "openzeppelin"
      ? `0xc${accountIndex.toString(16)}`
      : `0x${ready ? "e" : "f"}${classHash.slice(2, 10)}${accountIndex.toString(16)}`;
  const core = {
    address,
    classHash,
    id: `SN_MAIN:${address}`,
    networkId: "SN_MAIN" as const,
    publicKeyX: "0x123",
  };
  // The Ready scheme is x-only, so its refs carry no `publicKeyY`.
  if (ready) {
    return {
      ...core,
      accountContractType: "argent",
      deploymentSalt: "0x123",
      derivation: { addressIndex: accountIndex, kind: "argentx-bip44" },
    };
  }
  const own = {
    ...core,
    derivation: { accountIndex, addressIndex: 0, kind: "starknet-bip44" as const },
    publicKeyY: "0x456",
  };
  return input.accountContractType === "openzeppelin"
    ? { ...own, accountContractType: "openzeppelin" }
    : { ...own, accountContractType: input.accountContractType, deploymentSalt: "0x123" };
};

describe("recovery discovery on the wallet's own ladder", () => {
  test("finds an Argent 0.3.1 account whose key is the phrase's plain BIP-44 key", async () => {
    expect(ARGENT_031).toBeDefined();
    const deployed = accountFor({
      accountContractType: "argent",
      accountIndex: 0,
      classHash: ARGENT_031?.classHash ?? "",
      mnemonic: "",
    });
    const deps = {
      activeStateCoordinator: createActiveStateCoordinator(),
      preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
      recoveryDiscovery: createRecoveryDiscoveryCache(),
      runtimeRpc: {
        ...defaultRuntimeRpc,
        async getDeploymentStatus({ accountAddress }: { readonly accountAddress: string }) {
          return accountAddress === deployed.address;
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
          return accountFor(input);
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
    const hit = listed.find(({ account }) => account.address === deployed.address);
    expect(hit?.deployed).toBe(true);
    expect(hit?.account.derivation.kind).toBe("starknet-bip44");
    expect(sameFelt(hit?.account.classHash ?? "", ARGENT_031?.classHash ?? "")).toBe(true);
    // The 0.3.x shapes on this ladder are found, never offered: the undeployed
    // Argent 0.3.0 address at the same key is not listed.
    expect(
      listed.filter(
        ({ account }) =>
          account.accountContractType === "argent" &&
          !sameFelt(account.classHash, ARGENT_ACCOUNT_CLASS_HASH) &&
          account.address !== deployed.address,
      ),
    ).toEqual([]);
  });
});
