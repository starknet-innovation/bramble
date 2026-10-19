/**
 * `wallet.discoverOwnAccounts` / `wallet.importOwnAccounts` routing checks: the
 * rescan of the wallet's OWN phrase is extension-page-only, takes the phrase
 * from the vault through the live unlock session (never from the message),
 * fails closed when locked or when the vault holds no phrase, renews the unlock
 * window because it is user-initiated, stops when the session locks mid-scan,
 * and never answers with the phrase or the unlock credential.
 */
import { describe, expect, test } from "bun:test";
import type { AccountDerivationInput } from "@bramble/vault/accounts";
import type { RecoverVaultAccountsInput } from "@bramble/vault/service";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  type DerivedAccountRef,
  OPENZEPPELIN_ACCOUNT_CLASS_HASH,
} from "@bramble/wallet-model/accounts";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import { createRecoveryDiscoveryCache } from "../../../apps/extension/src/background/onboarding/recovery-cache";
import type { RecoveryReadPacer } from "../../../apps/extension/src/background/onboarding/recovery-read-pacer";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { defaultRuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  account,
  contentSender,
  createWallet,
  extensionSender as sender,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";

const ownPhrase = "legal winner thank year wave sausage worth useful legal winner thank yellow";

const discoverMessage = { networkId: "SN_MAIN", type: "wallet.discoverOwnAccounts" } as const;
const importMessage = {
  networkId: "SN_MAIN",
  selections: [
    { accountContractType: "openzeppelin", accountIndex: 1 },
    {
      accountContractType: "argent",
      accountIndex: 0,
      classHash: ARGENT_ACCOUNT_CLASS_HASH,
      derivation: "argentx-bip44",
    },
  ],
  type: "wallet.importOwnAccounts",
} as const;

const accountFor = (input: AccountDerivationInput): DerivedAccountRef => {
  const accountIndex = input.accountIndex ?? 0;
  const ordinal = accountIndex * 2 + (input.accountContractType === "argent" ? 2 : 1);
  const address = `0x${ordinal.toString(16)}`;
  const base = {
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
    ? { ...base, accountContractType: "argent", deploymentSalt: "0x0" }
    : { ...base, accountContractType: "openzeppelin" };
};

const quietRpc = {
  ...defaultRuntimeRpc,
  async getDeploymentStatus() {
    return false;
  },
  async getTokenBalances({ tokens }: Parameters<typeof defaultRuntimeRpc.getTokenBalances>[0]) {
    return tokens.map((token) => ({ ...token, balance: "0", formatted: "0" }));
  },
};

// A wallet whose vault holds `mnemonic` as its founding phrase; previews and
// imports are captured so a test can see exactly which phrase reached them.
const ownPhraseWallet = (
  options: {
    readonly imports?: RecoverVaultAccountsInput[];
    readonly mnemonic?: string | null;
    readonly onPreview?: (input: AccountDerivationInput) => void;
  } = {},
) => {
  const base = createWallet();
  return {
    ...base,
    async importSeedAccounts(input: RecoverVaultAccountsInput) {
      options.imports?.push(input);
      return [account];
    },
    async previewAccount(input: AccountDerivationInput) {
      options.onPreview?.(input);
      return accountFor(input);
    },
    async readVault(passphrase: string) {
      const vault = await base.readVault(passphrase);
      return { ...vault, mnemonic: options.mnemonic === undefined ? ownPhrase : options.mnemonic };
    },
  };
};

const unlocked = (options: { readonly now?: () => number; readonly ttlMs?: number } = {}) => {
  const session = createUnlockSession(options);
  session.unlock(vaultPassphrase);
  return session;
};

const expectNoSecrets = (response: unknown): void => {
  const serialized = JSON.stringify(response);
  expect(serialized).not.toContain("winner");
  expect(serialized).not.toContain(vaultPassphrase);
};

describe("wallet.discoverOwnAccounts routing", () => {
  test("scans the vault's own phrase and answers with public candidates only", async () => {
    const previewed: string[] = [];
    const handler = createMessageHandler(
      ownPhraseWallet({ onPreview: (input) => previewed.push(input.mnemonic) }),
      testExtension,
      { runtimeRpc: quietRpc, session: unlocked() },
    );
    const response = await handler(discoverMessage, sender);
    expect(response).toMatchObject({ ok: true });
    expect(previewed.length).toBeGreaterThan(0);
    expect(new Set(previewed)).toEqual(new Set([ownPhrase]));
    expectNoSecrets(response);
  });

  test("paces the rescan through the worker's shared read budget", async () => {
    // A rescan walks the same ~28 calls per index as first-run recovery, so
    // it trips the gateway's per-address limit just as readily unpaced.
    const booked: number[] = [];
    let probes = 0;
    const recoveryReads: RecoveryReadPacer = {
      read: async (_rpcUrls, calls, run) => {
        booked.push(calls);
        return run();
      },
    };
    const countedRpc = {
      ...quietRpc,
      async getDeploymentStatus() {
        probes += 1;
        return false;
      },
      async getTokenBalances(input: Parameters<typeof defaultRuntimeRpc.getTokenBalances>[0]) {
        probes += 1;
        return quietRpc.getTokenBalances(input);
      },
    };
    const handler = createMessageHandler(ownPhraseWallet(), testExtension, {
      recoveryReads,
      runtimeRpc: countedRpc,
      session: unlocked(),
    });
    expect(await handler(discoverMessage, sender)).toMatchObject({ ok: true });
    expect(probes).toBeGreaterThan(0);
    expect(booked.length).toBe(probes);
  });

  test("fails closed when the wallet is locked", async () => {
    const previewed: string[] = [];
    const handler = createMessageHandler(
      ownPhraseWallet({ onPreview: (input) => previewed.push(input.mnemonic) }),
      testExtension,
      { runtimeRpc: quietRpc, session: createUnlockSession() },
    );
    await expect(handler(discoverMessage, sender)).resolves.toEqual({ error: "wallet locked" });
    expect(previewed).toEqual([]);
  });

  test("refuses a vault that holds no phrase (raw-key and Ledger wallets)", async () => {
    const handler = createMessageHandler(ownPhraseWallet({ mnemonic: null }), testExtension, {
      runtimeRpc: quietRpc,
      session: unlocked(),
    });
    await expect(handler(discoverMessage, sender)).resolves.toEqual({
      error: "This wallet has no recovery phrase to scan",
    });
  });

  test("rejects a message that tries to carry a phrase or credential", async () => {
    const handler = createMessageHandler(ownPhraseWallet(), testExtension, {
      runtimeRpc: quietRpc,
      session: unlocked(),
    });
    for (const message of [
      { ...discoverMessage, mnemonic: ownPhrase },
      { ...discoverMessage, vaultPassphrase },
      { ...discoverMessage, networkId: "NOPE" },
    ]) {
      const response = await handler(message, sender);
      expect(response).toEqual({ error: "invalid account discovery request" });
      expectNoSecrets(response);
    }
  });

  test("is privileged: content scripts cannot reach it", async () => {
    const handler = createMessageHandler(ownPhraseWallet(), testExtension, {
      runtimeRpc: quietRpc,
      session: unlocked(),
    });
    await expect(handler(discoverMessage, contentSender)).resolves.toEqual({
      error: "privileged sender required",
    });
  });

  test("renews the unlock window: the scan is user-initiated", async () => {
    let now = 1_000;
    const ttlMs = 60_000;
    const session = unlocked({ now: () => now, ttlMs });
    const handler = createMessageHandler(ownPhraseWallet(), testExtension, {
      runtimeRpc: quietRpc,
      session,
    });
    now += ttlMs - 1;
    await expect(handler(discoverMessage, sender)).resolves.toMatchObject({ ok: true });
    now += ttlMs - 1;
    // Past the original deadline, alive only because the scan renewed it.
    expect(session.isUnlocked()).toBe(true);
  });

  test("a lock mid-scan stops the walk and caches nothing", async () => {
    const session = unlocked();
    const recoveryDiscovery = createRecoveryDiscoveryCache();
    const indices = new Set<number>();
    const handler = createMessageHandler(
      ownPhraseWallet({
        onPreview: (input) => {
          indices.add(input.accountIndex ?? 0);
          // The fingerprint preview is index 0; lock as the walk begins.
          if (indices.size === 1) session.lock();
        },
      }),
      testExtension,
      { recoveryDiscovery, runtimeRpc: quietRpc, session },
    );
    await expect(handler(discoverMessage, sender)).resolves.toEqual({ error: "wallet locked" });
    // Without the abort the walk would go on to derive indices 1..3 from the phrase.
    expect([...indices]).toEqual([0]);
    await expect(recoveryDiscovery.read()).resolves.toBeNull();
  });
});

describe("wallet.importOwnAccounts routing", () => {
  test("commits through the founding-phrase path with the vault phrase and session passphrase", async () => {
    const imports: RecoverVaultAccountsInput[] = [];
    const handler = createMessageHandler(ownPhraseWallet({ imports }), testExtension, {
      runtimeRpc: quietRpc,
      session: unlocked(),
    });
    const response = await handler(importMessage, sender);
    expect(response).toEqual({ accounts: [account], ok: true });
    expect(imports).toEqual([
      {
        mnemonic: ownPhrase,
        networkId: "SN_MAIN",
        selections: importMessage.selections,
        vaultPassphrase,
      },
    ]);
    expectNoSecrets(response);
  });

  test("fails closed when the wallet is locked", async () => {
    const imports: RecoverVaultAccountsInput[] = [];
    const handler = createMessageHandler(ownPhraseWallet({ imports }), testExtension, {
      runtimeRpc: quietRpc,
      session: createUnlockSession(),
    });
    await expect(handler(importMessage, sender)).resolves.toEqual({ error: "wallet locked" });
    expect(imports).toEqual([]);
  });

  test("refuses a vault that holds no phrase with the same reviewed error", async () => {
    const imports: RecoverVaultAccountsInput[] = [];
    const handler = createMessageHandler(
      ownPhraseWallet({ imports, mnemonic: null }),
      testExtension,
      { runtimeRpc: quietRpc, session: unlocked() },
    );
    await expect(handler(importMessage, sender)).resolves.toEqual({
      error: "This wallet has no recovery phrase to scan",
    });
    expect(imports).toEqual([]);
  });

  test("rejects a message that tries to carry a phrase or credential", async () => {
    const imports: RecoverVaultAccountsInput[] = [];
    const handler = createMessageHandler(ownPhraseWallet({ imports }), testExtension, {
      runtimeRpc: quietRpc,
      session: unlocked(),
    });
    for (const message of [
      { ...importMessage, mnemonic: ownPhrase },
      { ...importMessage, vaultPassphrase },
      { ...importMessage, selections: [] },
    ]) {
      const response = await handler(message, sender);
      expect(response).toEqual({ error: "invalid import own accounts request" });
      expectNoSecrets(response);
    }
    expect(imports).toEqual([]);
  });

  test("is privileged: content scripts cannot reach it", async () => {
    const handler = createMessageHandler(ownPhraseWallet(), testExtension, {
      runtimeRpc: quietRpc,
      session: unlocked(),
    });
    await expect(handler(importMessage, contentSender)).resolves.toEqual({
      error: "privileged sender required",
    });
  });
});
