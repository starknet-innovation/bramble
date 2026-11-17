/**
 * Discovery notes, never refuses, a deployed account another wallet registered
 * with the privacy pool. The note is advisory: a matching key, a zero key, an
 * unreadable pool, or a failed derivation all list the row unlabelled, and the
 * private-action path re-checks. Undeployed candidates are never read.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import type { AccountDerivationInput } from "@bramble/vault/accounts";
import type { RecoveryAccountCandidate } from "@bramble/wallet-model/recovery";
import { handleOnboardingOps } from "../../../apps/extension/src/background/onboarding/onboarding-ops";
import { createRecoveryDiscoveryCache } from "../../../apps/extension/src/background/onboarding/recovery-cache";
import { clearStrk20PoolKeyCache } from "../../../apps/extension/src/background/privacy/strk20-registration-owner";
import { createActiveStateCoordinator } from "../../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { walletStub } from "../../support/key-boundary-collaborators";
import { offlineDiscoveryRpc, recoveryAccountFor } from "../../support/recovery-accounts";

const OWN_KEY = "0x1";
const DEPLOYED = "0x3";

const message = {
  manualIndex: 1,
  mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
  networkId: "SN_MAIN",
  type: "wallet.discoverRecoveryAccounts",
} as const;

const discover = async (options: {
  readonly poolKey: string | Error;
  readonly derive?: () => Promise<string>;
}) => {
  const poolReads: string[] = [];
  const deps = {
    activeStateCoordinator: createActiveStateCoordinator(),
    preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
    recoveryDiscovery: createRecoveryDiscoveryCache(),
    runtimeRpc: {
      ...offlineDiscoveryRpc,
      getDeploymentStatus: async ({ accountAddress }: { readonly accountAddress: string }) =>
        accountAddress === DEPLOYED,
      async getStrk20PublicKey({ address }: { readonly address: string }) {
        poolReads.push(address);
        if (options.poolKey instanceof Error) throw options.poolKey;
        return options.poolKey;
      },
    },
    session: createUnlockSession(),
    wallet: {
      ...walletStub,
      previewAccount: async (input: AccountDerivationInput) => recoveryAccountFor(input),
      previewStrk20ViewingPublicKey: options.derive ?? (async () => OWN_KEY),
    },
  };
  const response = (await handleOnboardingOps(deps, message.type, message)) as {
    readonly candidates: readonly RecoveryAccountCandidate[];
  };
  const deployed = response.candidates.find((candidate) => candidate.account.address === DEPLOYED);
  if (!deployed) throw new Error("missing deployed candidate");
  return { deployed, poolReads };
};

describe("recovery discovery privacy-pool note", () => {
  beforeEach(clearStrk20PoolKeyCache);

  test("notes a deployed account registered under another wallet's key", async () => {
    const { deployed, poolReads } = await discover({ poolKey: "0x99" });
    expect(deployed.privacyPool).toBe("other-wallet");
    // Only deployed candidates are read: an undeployed one cannot register.
    // (The stub gives several families one address, so the row is read per family.)
    expect(poolReads.length).toBeGreaterThan(0);
    expect(poolReads.every((address) => address === DEPLOYED)).toBe(true);
  });

  test("lists an account registered under this wallet's own key unlabelled", async () => {
    const { deployed } = await discover({ poolKey: OWN_KEY });
    expect(deployed.privacyPool).toBeUndefined();
    expect(deployed.deployed).toBe(true);
  });

  test("an unregistered, unreadable, or underivable account is listed unlabelled", async () => {
    expect((await discover({ poolKey: "0x0" })).deployed.privacyPool).toBeUndefined();
    expect(
      (await discover({ poolKey: new Error("node down") })).deployed.privacyPool,
    ).toBeUndefined();
    expect(
      (
        await discover({
          derive: () => Promise.reject(new Error("kms down")),
          poolKey: "0x99",
        })
      ).deployed.privacyPool,
    ).toBeUndefined();
  });
});
