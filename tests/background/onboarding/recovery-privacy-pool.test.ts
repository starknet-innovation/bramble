/** Discovery blocks accounts another wallet registered with the privacy pool. */
import { describe, expect, test } from "bun:test";
import { STRK20_MAINNET_POOL } from "@bramble/privacy/config";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import type { AccountDerivationInput } from "@bramble/vault/accounts";
import { canonicalFelt, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { RecoveryAccountCandidate } from "@bramble/wallet-model/recovery";
import { handleOnboardingOps } from "../../../apps/extension/src/background/onboarding/onboarding-ops";
import { createRecoveryDiscoveryCache } from "../../../apps/extension/src/background/onboarding/recovery-cache";
import { defaultRuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createActiveStateCoordinator } from "../../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { walletStub } from "../../support/key-boundary-collaborators";
import { recoveryAccountFor } from "../../support/recovery-accounts";

const OWN_VIEWING_PUBLIC_KEY = "0xa11ce";

// Index 0 yields 0x1 (OpenZeppelin) and 0x2 (Argent at the pinned release);
// the other Argent and Braavos shapes reuse those addresses in this stub, so
// the pool answer is keyed by address alone.
const discover = async (
  deployed: boolean,
  registered: (address: string) => Promise<string>,
  own: () => Promise<string> = async () => OWN_VIEWING_PUBLIC_KEY,
): Promise<{
  readonly candidates: readonly RecoveryAccountCandidate[];
  readonly previews: readonly (AccountDerivationInput & { readonly poolAddress?: string })[];
}> => {
  const previews: (AccountDerivationInput & { readonly poolAddress?: string })[] = [];
  const deps = {
    activeStateCoordinator: createActiveStateCoordinator(),
    preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
    recoveryDiscovery: createRecoveryDiscoveryCache(),
    runtimeRpc: {
      ...defaultRuntimeRpc,
      async getArgentSigningRestriction() {
        return null;
      },
      async getBraavosSigningRestriction() {
        return null;
      },
      async getDeploymentStatus() {
        return deployed;
      },
      async getStrk20PublicKey({ address }: { readonly address: string }) {
        return registered(address);
      },
      async getTokenBalances({ tokens }: Parameters<typeof defaultRuntimeRpc.getTokenBalances>[0]) {
        return tokens.map((token) => ({ ...token, balance: "1", formatted: "1" }));
      },
    },
    session: createUnlockSession(),
    wallet: {
      ...walletStub,
      async previewAccount(input: AccountDerivationInput) {
        return recoveryAccountFor(input);
      },
      async previewStrk20ViewingPublicKey(
        input: AccountDerivationInput & { readonly chainId: string; readonly poolAddress: string },
      ) {
        previews.push(input);
        return own();
      },
    },
  };
  const response = (await handleOnboardingOps(deps, "wallet.discoverRecoveryAccounts", {
    manualIndex: 0,
    mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
    networkId: "SN_MAIN",
    type: "wallet.discoverRecoveryAccounts",
  })) as { readonly candidates: readonly RecoveryAccountCandidate[] };
  return { candidates: response.candidates, previews };
};

const blocksAt = (
  candidates: readonly RecoveryAccountCandidate[],
  address: string,
): readonly (string | undefined)[] =>
  candidates
    .filter((candidate) => candidate.account.address === address)
    .map((candidate) => candidate.privacyPool);

describe("recovery discovery privacy-pool check", () => {
  test("blocks a registered key this wallet does not derive, and only that", async () => {
    const { candidates, previews } = await discover(true, async (address) =>
      address === "0x2" ? "0xbeef" : address === "0x1" ? "0x0A11CE" : "0x0",
    );
    expect(blocksAt(candidates, "0x2").length).toBeGreaterThan(0);
    expect(blocksAt(candidates, "0x2").every((block) => block === "registered-elsewhere")).toBe(
      true,
    );
    // Registered with the key this wallet derives: importable.
    expect(blocksAt(candidates, "0x1").every((block) => block === undefined)).toBe(true);
    // The comparison derives against the configured pool on the right chain.
    expect(previews.length).toBeGreaterThan(0);
    for (const preview of previews) {
      expect(preview).toMatchObject({
        chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
        poolAddress: canonicalFelt(STRK20_MAINNET_POOL),
      });
    }
  });

  test("an unregistered account derives no viewing key at all", async () => {
    const { candidates, previews } = await discover(true, async () => "0x0");
    expect(candidates.every((candidate) => candidate.privacyPool === undefined)).toBe(true);
    expect(previews).toEqual([]);
  });

  test("a pool that does not answer blocks every deployed account", async () => {
    const { candidates } = await discover(true, async () => {
      throw new Error("node unreachable");
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((candidate) => candidate.privacyPool === "unchecked")).toBe(true);
  });

  test("a registered account this wallet cannot derive for stays unchecked", async () => {
    // The own-key derivation failing is not proof of a match.
    const { candidates } = await discover(
      true,
      async () => "0xbeef",
      async () => {
        throw new Error("kms unavailable");
      },
    );
    expect(candidates.every((candidate) => candidate.privacyPool === "unchecked")).toBe(true);
  });

  test("an undeployed account is never read from the pool", async () => {
    const read: string[] = [];
    const { candidates } = await discover(false, async (address) => {
      read.push(address);
      return "0xbeef";
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(read).toEqual([]);
    expect(candidates.every((candidate) => candidate.privacyPool === undefined)).toBe(true);
  });
});
