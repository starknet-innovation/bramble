/** Xverse accounts are found on the wallet's own ladder at Xverse's Argent build (issue 734). */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import type { AccountDerivationInput } from "@bramble/vault/accounts";
import { XVERSE_ARGENT_CLASS_HASH } from "@bramble/wallet-model/account-families";
import type { DerivedAccountRef } from "@bramble/wallet-model/accounts";
import { canonicalFelt, sameFelt } from "@bramble/wallet-model/networks";
import { handleOnboardingOps } from "../../../apps/extension/src/background/onboarding/onboarding-ops";
import { createRecoveryDiscoveryCache } from "../../../apps/extension/src/background/onboarding/recovery-cache";
import { defaultRuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createActiveStateCoordinator } from "../../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { walletStub } from "../../support/key-boundary-collaborators";

const XVERSE_ADDRESS = "0x7e5";

// Every preview gets a distinct address; only the Xverse class on the wallet's
// own ladder lands on the one address the fake chain reports as deployed.
const accountFor = (input: AccountDerivationInput, seen: number): DerivedAccountRef => {
  const isXverse =
    input.accountContractType === "argent" &&
    input.derivation === undefined &&
    sameFelt(input.classHash ?? "0x0", XVERSE_ARGENT_CLASS_HASH);
  const address = isXverse ? XVERSE_ADDRESS : `0x${(seen + 1).toString(16)}`;
  const account = {
    address,
    classHash: canonicalFelt(input.classHash ?? "0x1") ?? "",
    derivation: {
      accountIndex: input.accountIndex ?? 0,
      addressIndex: 0,
      kind: "starknet-bip44",
    },
    id: `SN_MAIN:${address}`,
    networkId: "SN_MAIN",
    publicKeyX: `0x${(seen + 100).toString(16)}`,
    publicKeyY: `0x${(seen + 200).toString(16)}`,
  } as const;
  return input.accountContractType === "openzeppelin"
    ? { ...account, accountContractType: "openzeppelin" }
    : {
        ...account,
        accountContractType: input.accountContractType as "argent" | "braavos",
        deploymentSalt: account.publicKeyX,
      };
};

const discover = async () => {
  const previews: AccountDerivationInput[] = [];
  const deps = {
    activeStateCoordinator: createActiveStateCoordinator(),
    preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
    recoveryDiscovery: createRecoveryDiscoveryCache(),
    runtimeRpc: {
      ...defaultRuntimeRpc,
      async getArgentSigningRestriction() {
        return null;
      },
      async getDeploymentStatus({ accountAddress }: { readonly accountAddress: string }) {
        return sameFelt(accountAddress, XVERSE_ADDRESS);
      },
      async getTokenBalances({ tokens }: Parameters<typeof defaultRuntimeRpc.getTokenBalances>[0]) {
        return tokens.map((token) => ({ ...token, balance: "0", formatted: "0" }));
      },
    },
    session: createUnlockSession(),
    wallet: {
      ...walletStub,
      async previewAccount(input: AccountDerivationInput) {
        previews.push(input);
        return accountFor(input, previews.length);
      },
    },
  };
  const response = await handleOnboardingOps(deps, "wallet.discoverRecoveryAccounts", {
    manualIndex: 3,
    mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
    networkId: "SN_MAIN",
    type: "wallet.discoverRecoveryAccounts",
  });
  return { previews, response };
};

describe("Xverse recovery discovery", () => {
  test("previews Xverse's Argent build on the wallet's own ladder only", async () => {
    const { previews } = await discover();
    const xverse = previews.filter(
      (input) =>
        input.accountContractType === "argent" &&
        sameFelt(input.classHash ?? "0x0", XVERSE_ARGENT_CLASS_HASH),
    );
    // Xverse derives on m/44'/9004'/{i}'/0/0, never on Ready's ETH-seeded tree.
    expect(xverse).toHaveLength(1);
    expect(xverse[0]?.derivation).toBeUndefined();
    expect(xverse[0]?.accountIndex).toBe(3);
  });

  test("lists a deployed Xverse account as a restorable candidate", async () => {
    const { response } = await discover();
    const candidates = (response as { candidates?: readonly { account: DerivedAccountRef }[] })
      .candidates;
    const hit = candidates?.find((candidate) =>
      sameFelt(candidate.account.address, XVERSE_ADDRESS),
    );
    expect(hit).toBeDefined();
    expect(hit?.account.accountContractType).toBe("argent");
    expect(sameFelt(hit?.account.classHash ?? "0x0", XVERSE_ARGENT_CLASS_HASH)).toBe(true);
    expect(hit?.account.derivation.kind).toBe("starknet-bip44");
  });
});
