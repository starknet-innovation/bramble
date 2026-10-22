/**
 * Retrying a finished recovery scan reads the chain again (Sherlock 218).
 *
 * Discovery keeps its progress in a session cache. Once a walk reaches its
 * horizon, the next page request must start a fresh walk from index 0, so
 * "Retry account search" finds an account funded after the first scan instead
 * of replaying the stored "Search complete" result.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import type { AccountDerivationInput } from "@bramble/vault/accounts";
import type { RecoveryAccountCandidate } from "@bramble/wallet-model/recovery";
import { handleOnboardingOps } from "../../../apps/extension/src/background/onboarding/onboarding-ops";
import { createRecoveryDiscoveryCache } from "../../../apps/extension/src/background/onboarding/recovery-cache";
import type { defaultRuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createActiveStateCoordinator } from "../../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { walletStub } from "../../support/key-boundary-collaborators";
import { offlineDiscoveryRpc, recoveryAccountFor } from "../../support/recovery-accounts";

type Page = {
  readonly candidates: readonly RecoveryAccountCandidate[];
  readonly complete: boolean;
  readonly nextIndex: number;
};

const message = {
  mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
  networkId: "SN_MAIN",
  type: "wallet.discoverRecoveryAccounts",
} as const;

// The same deterministic derivation the main discovery suite uses: OpenZeppelin
// (and Braavos) at odd ordinals, Argent at even ones.

const install = () => {
  const funded = new Set<string>();
  let balanceReads = 0;
  const deps = {
    activeStateCoordinator: createActiveStateCoordinator(),
    preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
    recoveryDiscovery: createRecoveryDiscoveryCache(),
    runtimeRpc: {
      ...offlineDiscoveryRpc,
      getDeploymentStatus: async () => false,
      async getTokenBalances({
        accountAddress,
        tokens,
      }: Parameters<typeof defaultRuntimeRpc.getTokenBalances>[0]) {
        balanceReads += 1;
        return tokens.map((token) => {
          const balance = funded.has(accountAddress) && token.symbol === "STRK" ? "10" : "0";
          return { ...token, balance, formatted: balance };
        });
      },
    },
    session: createUnlockSession(),
    wallet: {
      ...walletStub,
      previewAccount: async (input: AccountDerivationInput) => recoveryAccountFor(input),
    },
  };
  // Pages until the walk reports complete, as the picker's Retry loop does.
  const scanToEnd = async (): Promise<Page> => {
    for (let page = 0; page < 50; page += 1) {
      const next = (await handleOnboardingOps(deps, message.type, message)) as Page;
      if (next.complete) return next;
    }
    throw new Error("scan never completed");
  };
  return { balanceReads: () => balanceReads, deps, funded, scanToEnd };
};

const openZeppelinAt = (accountIndex: number): string => `0x${(accountIndex * 2 + 1).toString(16)}`;

describe("retrying a finished recovery scan", () => {
  test("reads the chain again and finds an account funded since the first scan", async () => {
    const { balanceReads, deps, funded, scanToEnd } = install();
    const first = await scanToEnd();
    expect(first.candidates.some((candidate) => candidate.funded)).toBe(false);

    funded.add(openZeppelinAt(3));
    const readsBefore = balanceReads();
    const retried = await scanToEnd();

    expect(balanceReads()).toBeGreaterThan(readsBefore);
    expect(
      retried.candidates
        .filter((candidate) => candidate.funded)
        .map(({ account }) => account.address),
    ).toEqual([openZeppelinAt(3)]);
    // The fresh walk is resumable like the first one, from index 0.
    const page = (await handleOnboardingOps(deps, message.type, message)) as Page;
    expect(page.complete).toBe(false);
  });

  test("keeps resuming an unfinished scan from where it stopped", async () => {
    const { deps } = install();
    const first = (await handleOnboardingOps(deps, message.type, message)) as Page;
    const second = (await handleOnboardingOps(deps, message.type, message)) as Page;
    expect(first.complete).toBe(false);
    expect(second.nextIndex).toBeGreaterThan(first.nextIndex);
  });

  test("a manual-index search after a finished scan leaves the walk finished", async () => {
    const { deps, scanToEnd } = install();
    const finished = await scanToEnd();
    const manual = (await handleOnboardingOps(deps, message.type, {
      ...message,
      manualIndex: 42,
    })) as Page;
    expect(manual).toMatchObject({ complete: true, nextIndex: finished.nextIndex });
  });
});
