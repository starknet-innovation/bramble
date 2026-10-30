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
import type { defaultRuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createActiveStateCoordinator } from "../../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { walletStub } from "../../support/key-boundary-collaborators";
import { offlineDiscoveryRpc } from "../../support/recovery-accounts";

// One fake Xverse address per index, so a test can say which indices are
// deployed or funded on the fake chain. Every other preview is distinct.
const xverseAddress = (accountIndex: number): string => `0x7e5${accountIndex.toString(16)}`;

const isXverseOwnLadder = (input: AccountDerivationInput): boolean =>
  input.accountContractType === "argent" &&
  input.derivation === undefined &&
  sameFelt(input.classHash ?? "0x0", XVERSE_ARGENT_CLASS_HASH);

const accountFor = (input: AccountDerivationInput, seen: number): DerivedAccountRef => {
  const accountIndex = input.accountIndex ?? 0;
  const address = isXverseOwnLadder(input)
    ? xverseAddress(accountIndex)
    : `0x${(seen + 1).toString(16)}`;
  const account = {
    address,
    classHash: canonicalFelt(input.classHash ?? "0x1") ?? "",
    derivation: { accountIndex, addressIndex: 0, kind: "starknet-bip44" },
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

type Chain = { readonly deployed?: readonly string[]; readonly funded?: readonly string[] };
type Candidate = { readonly account: DerivedAccountRef; deployed: boolean; funded: boolean };

const discover = async (chain: Chain, manualIndex?: number) => {
  const previews: AccountDerivationInput[] = [];
  const has = (list: readonly string[] | undefined, address: string) =>
    (list ?? []).some((entry) => sameFelt(entry, address));
  const deps = {
    activeStateCoordinator: createActiveStateCoordinator(),
    preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
    recoveryDiscovery: createRecoveryDiscoveryCache(),
    runtimeRpc: {
      ...offlineDiscoveryRpc,
      async getArgentSigningRestriction() {
        return null;
      },
      async getDeploymentStatus({ accountAddress }: { readonly accountAddress: string }) {
        return has(chain.deployed, accountAddress);
      },
      async getTokenBalances({
        accountAddress,
        tokens,
      }: Parameters<typeof defaultRuntimeRpc.getTokenBalances>[0]) {
        const funded = has(chain.funded, accountAddress);
        return tokens.map((token) => {
          const balance = funded && token.symbol === "STRK" ? "5" : "0";
          return { ...token, balance, formatted: balance };
        });
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
  const response = (await handleOnboardingOps(deps, "wallet.discoverRecoveryAccounts", {
    ...(manualIndex === undefined ? {} : { manualIndex }),
    mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
    networkId: "SN_MAIN",
    type: "wallet.discoverRecoveryAccounts",
  })) as { readonly candidates?: readonly Candidate[] };
  return { candidates: response.candidates ?? [], previews };
};

const xverseCandidate = (candidates: readonly Candidate[], accountIndex: number) =>
  candidates.find((candidate) => sameFelt(candidate.account.address, xverseAddress(accountIndex)));

describe("Xverse recovery discovery", () => {
  test("scans Xverse's Argent build once per index on the own ladder, never on Ready's", async () => {
    const { previews } = await discover({});
    const indices = [...new Set(previews.map((input) => input.accountIndex ?? 0))];
    expect(indices.length).toBeGreaterThan(1);
    for (const accountIndex of indices) {
      const xverse = previews.filter(
        (input) =>
          (input.accountIndex ?? 0) === accountIndex &&
          input.accountContractType === "argent" &&
          sameFelt(input.classHash ?? "0x0", XVERSE_ARGENT_CLASS_HASH),
      );
      // Xverse derives on m/44'/9004'/{i}'/0/0, never on Ready's ETH-seeded tree.
      expect(xverse.filter((input) => input.derivation === undefined)).toHaveLength(1);
      expect(xverse.filter((input) => input.derivation === "argentx-bip44")).toHaveLength(0);
      expect(xverse).toHaveLength(1);
    }
  });

  test("lists a deployed Xverse account as a restorable candidate", async () => {
    const { candidates } = await discover({ deployed: [xverseAddress(3)] }, 3);
    const hit = xverseCandidate(candidates, 3);
    expect(hit).toMatchObject({ deployed: true });
    expect(hit?.account.accountContractType).toBe("argent");
    expect(sameFelt(hit?.account.classHash ?? "0x0", XVERSE_ARGENT_CLASS_HASH)).toBe(true);
    expect(hit?.account.derivation.kind).toBe("starknet-bip44");
  });

  test("lists a funded, undeployed Xverse account and drops an unfunded one", async () => {
    // Xverse deploys lazily on the first send, so funded-but-undeployed is the
    // common real case. It is found (the picker then says Bramble cannot deploy
    // this release); an unused one belongs to nobody and is never offered.
    const { candidates } = await discover({ funded: [xverseAddress(1)] });
    expect(xverseCandidate(candidates, 1)).toMatchObject({ deployed: false, funded: true });
    expect(xverseCandidate(candidates, 0)).toBeUndefined();
    expect(xverseCandidate(candidates, 2)).toBeUndefined();
  });
});
