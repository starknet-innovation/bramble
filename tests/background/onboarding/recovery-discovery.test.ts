/** Bounded dual-contract recovery discovery and resumable progress. */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@mc-wallet/settings/preferences";
import { createMemoryStore } from "@mc-wallet/store/kv";
import type { AccountDerivationInput } from "@mc-wallet/vault/accounts";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  type DerivedAccountRef,
  OPENZEPPELIN_ACCOUNT_CLASS_HASH,
} from "@mc-wallet/wallet-model/accounts";
import { canonicalFelt } from "@mc-wallet/wallet-model/networks";
import type { RecoveryAccountCandidate } from "@mc-wallet/wallet-model/recovery";
import { handleOnboardingOps } from "../../../apps/extension/src/background/onboarding/onboarding-ops";
import { createRecoveryDiscoveryCache } from "../../../apps/extension/src/background/onboarding/recovery-cache";
import { defaultRuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createActiveStateCoordinator } from "../../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { walletStub } from "../../support/key-boundary-collaborators";

const accountFor = (input: AccountDerivationInput): DerivedAccountRef => {
  const accountIndex = input.accountIndex ?? 0;
  const ordinal = accountIndex * 2 + (input.accountContractType === "argent" ? 2 : 1);
  const address = `0x${ordinal.toString(16)}`;
  const account = {
    address,
    classHash:
      canonicalFelt(
        input.accountContractType === "argent"
          ? ARGENT_ACCOUNT_CLASS_HASH
          : OPENZEPPELIN_ACCOUNT_CLASS_HASH,
      ) ?? "",
    derivation: { accountIndex, addressIndex: 0, kind: "starknet-bip44" },
    id: `SN_MAIN:${address}`,
    networkId: "SN_MAIN",
    publicKeyX: `0x${(ordinal + 100).toString(16)}`,
    publicKeyY: `0x${(ordinal + 200).toString(16)}`,
  } as const;
  return input.accountContractType === "argent"
    ? { ...account, accountContractType: "argent", deploymentSalt: "0x0" }
    : { ...account, accountContractType: "openzeppelin" };
};

describe("recovery discovery", () => {
  test("checks OZ and Argent in bounded resumable batches", async () => {
    const previewed: Array<readonly [string, number]> = [];
    const requestedTokenSymbols: string[][] = [];
    const wallet = {
      ...walletStub,
      async previewAccount(input: AccountDerivationInput) {
        previewed.push([input.accountContractType, input.accountIndex ?? 0]);
        return accountFor(input);
      },
    };
    const deps = {
      activeStateCoordinator: createActiveStateCoordinator(),
      preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
      recoveryDiscovery: createRecoveryDiscoveryCache(),
      runtimeRpc: {
        ...defaultRuntimeRpc,
        async getDeploymentStatus({ accountAddress }: { readonly accountAddress: string }) {
          return accountAddress === "0x3";
        },
        async getTokenBalances({
          accountAddress,
          tokens,
        }: Parameters<typeof defaultRuntimeRpc.getTokenBalances>[0]) {
          requestedTokenSymbols.push(tokens.map((token) => token.symbol));
          return tokens.map((token) => {
            const balance =
              (accountAddress === "0x4" && token.symbol === "ETH") ||
              (accountAddress === "0x6" && token.symbol === "STRK")
                ? "10"
                : "0";
            return { ...token, balance, formatted: balance };
          });
        },
      },
      session: createUnlockSession(),
      wallet,
    };
    const message = {
      mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
      networkId: "SN_MAIN",
      type: "wallet.discoverRecoveryAccounts",
    };

    const first = await handleOnboardingOps(deps, message.type, message);
    const second = await handleOnboardingOps(deps, message.type, message);
    const manual = await handleOnboardingOps(deps, message.type, {
      ...message,
      manualIndex: 42,
    });

    expect(first).toMatchObject({ complete: false, nextIndex: 4, ok: true });
    expect(second).toMatchObject({ complete: false, nextIndex: 8, ok: true });
    expect(first).toMatchObject({
      candidates: [
        { account: { address: "0x1" }, deployed: false, funded: false },
        { account: { address: "0x2" }, deployed: false, funded: false },
        { account: { address: "0x3" }, deployed: true, funded: false },
        { account: { address: "0x4" }, deployed: false, funded: true },
        { account: { address: "0x6" }, deployed: false, funded: true },
      ],
    });
    expect(manual).toMatchObject({ complete: false, nextIndex: 8, ok: true });
    expect(requestedTokenSymbols.every((symbols) => symbols.join(",") === "ETH,STRK")).toBe(true);
    expect(
      (manual as { readonly candidates: readonly RecoveryAccountCandidate[] }).candidates.map(
        ({ account }) => `${account.accountContractType}:${account.derivation.accountIndex}`,
      ),
    ).toContain("openzeppelin:42");
    expect(
      (manual as { readonly candidates: readonly RecoveryAccountCandidate[] }).candidates.map(
        ({ account }) => `${account.accountContractType}:${account.derivation.accountIndex}`,
      ),
    ).toContain("argent:42");
    expect(
      new Set(
        previewed.filter(([, index]) => index > 0).map(([type, index]) => `${type}:${index}`),
      ),
    ).toEqual(
      new Set(
        Array.from({ length: 7 }, (_, offset) => offset + 1)
          .flatMap((index) => [`openzeppelin:${index}`, `argent:${index}`])
          .concat(["openzeppelin:42", "argent:42"]),
      ),
    );
  });
});
