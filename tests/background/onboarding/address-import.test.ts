/**
 * Import by address (issue 398): an account whose address no derivation
 * reproduces is found by matching its live owner key against the phrase's
 * keys, on every ladder its family walks and within the recovery scan's bound.
 * Every other answer is a distinct refusal, an unreadable chain refuses rather
 * than guesses, and the same proof runs again before a restore or import
 * writes the account — before the guarded write, so a refusal never locks.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import type { AccountOwnerReading } from "@bramble/starknet/rpc";
import { createMemoryStore } from "@bramble/store/kv";
import type { AccountDerivationInput } from "@bramble/vault/accounts";
import type { RecoverVaultAccountsInput } from "@bramble/vault/service";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  BRAAVOS_BASE_CLASS_HASH,
  BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH,
  BRAAVOS_DEPLOYMENT_CLASS_HASH,
} from "@bramble/wallet-model/account-families";
import type { RecoverableAccountRef } from "@bramble/wallet-model/accounts";
import { canonicalFelt, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import {
  ADDRESS_IMPORT_REFUSALS,
  RECOVERY_SCAN_LIMITS,
  type RecoveryAccountSelection,
} from "@bramble/wallet-model/recovery";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { defaultRuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  account,
  createWallet,
  extensionSender as sender,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";

const PHRASE = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const PASTED = "0x7e57ad0e55";

// Deterministic public keys, distinct per ladder: this wallet's own ladder,
// Ready's ETH-seeded one, and Braavos's address axis.
const keyFor = (family: string, derivation: string | undefined, index: number): string =>
  `0x${family === "braavos" ? "3" : derivation === "argentx-bip44" ? "2" : "1"}${index.toString(16)}`;

const previewFor = (input: AccountDerivationInput): RecoverableAccountRef => {
  const index = input.accountIndex ?? 0;
  const publicKeyX = keyFor(input.accountContractType, input.derivation, index);
  const address = canonicalFelt(`0x${publicKeyX.slice(2)}aa`) as string;
  const networkId = input.networkId ?? "SN_MAIN";
  const core = {
    address,
    classHash: canonicalFelt(input.classHash ?? ARGENT_ACCOUNT_CLASS_HASH) as string,
    id: `${networkId}:${address}`,
    networkId,
    publicKeyX,
  } as const;
  if (input.derivation === "argentx-bip44") {
    return {
      ...core,
      accountContractType: "argent",
      deploymentSalt: publicKeyX,
      derivation: { addressIndex: index, kind: "argentx-bip44" },
    };
  }
  return {
    ...core,
    accountContractType: input.accountContractType as "argent" | "braavos",
    deploymentSalt: publicKeyX,
    derivation:
      input.accountContractType === "braavos"
        ? { accountIndex: 0, addressIndex: index, kind: "starknet-bip44" }
        : { accountIndex: index, addressIndex: 0, kind: "starknet-bip44" },
    publicKeyY: "0x5",
  };
};

type Harness = {
  readonly imports: RecoverVaultAccountsInput[];
  readonly ownerReads: { readonly accountAddress: string; readonly rpcUrls: readonly string[] }[];
  readonly previews: AccountDerivationInput[];
  readonly recovers: RecoverVaultAccountsInput[];
};

const harness = (
  owner: AccountOwnerReading | Error | undefined,
  options: {
    readonly mnemonic?: string | null;
    readonly restriction?: string | null;
    readonly session?: ReturnType<typeof createUnlockSession>;
  } = {},
) => {
  const seen: Harness = { imports: [], ownerReads: [], previews: [], recovers: [] };
  const base = createWallet();
  const wallet = {
    ...base,
    async importSeedAccounts(input: RecoverVaultAccountsInput) {
      seen.imports.push(input);
      return [account];
    },
    async previewAccount(input: AccountDerivationInput) {
      seen.previews.push(input);
      return previewFor(input);
    },
    async readVault(passphrase: string) {
      const vault = await base.readVault(passphrase);
      return { ...vault, mnemonic: options.mnemonic === undefined ? PHRASE : options.mnemonic };
    },
    async recoverAccounts(input: RecoverVaultAccountsInput) {
      seen.recovers.push(input);
      return [account];
    },
  };
  const restriction = async () => (options.restriction ?? null) as never;
  // The production wiring has a reader; "no reader at all" drops it.
  const { getAccountOwner: _production, ...withoutReader } = defaultRuntimeRpc;
  const runtimeRpc = {
    ...withoutReader,
    ...(owner === undefined
      ? {}
      : {
          async getAccountOwner(input: {
            readonly accountAddress: string;
            readonly rpcUrls: readonly string[];
          }) {
            seen.ownerReads.push(input);
            if (owner instanceof Error) throw owner;
            return owner;
          },
        }),
    getArgentSigningRestriction: restriction,
    getBraavosSigningRestriction: restriction,
  };
  const session = options.session ?? createUnlockSession();
  if (options.session === undefined) session.unlock(vaultPassphrase);
  const handler = createMessageHandler(wallet, testExtension, {
    preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
    runtimeRpc,
    session,
  });
  return { handler, seen, session };
};

const argentOwner = (ownerPublicKey: string): AccountOwnerReading => ({
  classHash: ARGENT_ACCOUNT_CLASS_HASH,
  family: "argent",
  kind: "owner",
  ownerPublicKey,
});

const findMessage = (networkId = "SN_MAIN", address = PASTED) => ({
  address,
  mnemonic: PHRASE,
  networkId,
  type: "wallet.findRecoveryAccountByAddress",
});

describe("finding an account by its address", () => {
  test("matches an Argent owner on this wallet's own ladder and keeps the pasted address", async () => {
    const { handler } = harness(argentOwner(keyFor("argent", "starknet-bip44", 3)));
    const response = await handler(findMessage(), sender);
    expect(response).toMatchObject({
      candidate: {
        account: {
          accountContractType: "argent",
          address: PASTED,
          classHash: canonicalFelt(ARGENT_ACCOUNT_CLASS_HASH),
          derivation: { accountIndex: 3, kind: "starknet-bip44" },
          id: `SN_MAIN:${PASTED}`,
          publicKeyX: keyFor("argent", "starknet-bip44", 3),
        },
        byAddress: true,
        deployed: true,
        funded: false,
      },
      ok: true,
    });
    expect(JSON.stringify(response)).not.toContain("winner");
  });

  test("matches a Ready owner on Ready's ladder", async () => {
    const { handler } = harness(argentOwner(keyFor("argent", "argentx-bip44", 5)));
    await expect(handler(findMessage(), sender)).resolves.toMatchObject({
      candidate: {
        account: { address: PASTED, derivation: { addressIndex: 5, kind: "argentx-bip44" } },
      },
      ok: true,
    });
  });

  test("matches a Braavos owner, recording the base class for an implementation-class account", async () => {
    const { handler } = harness({
      classHash: BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH,
      family: "braavos",
      kind: "owner",
      ownerPublicKey: keyFor("braavos", undefined, 2),
    });
    const response = await handler(findMessage(), sender);
    expect(response).toMatchObject({
      candidate: {
        account: {
          accountContractType: "braavos",
          address: PASTED,
          derivation: { addressIndex: 2 },
        },
      },
    });
    const recorded = (response as unknown as { candidate: { account: { classHash: string } } })
      .candidate.account.classHash;
    expect(canonicalFelt(recorded)).toBe(canonicalFelt(BRAAVOS_BASE_CLASS_HASH));
  });

  test("a Braavos account running a deployment-role class records that class", async () => {
    const { handler } = harness({
      classHash: BRAAVOS_DEPLOYMENT_CLASS_HASH,
      family: "braavos",
      kind: "owner",
      ownerPublicKey: keyFor("braavos", undefined, 0),
    });
    const response = (await handler(findMessage(), sender)) as unknown as {
      candidate: { account: { classHash: string } };
    };
    expect(canonicalFelt(response.candidate.account.classHash)).toBe(
      canonicalFelt(BRAAVOS_DEPLOYMENT_CLASS_HASH),
    );
  });

  test("labels a guardian or 2FA account view only, as the scan does", async () => {
    const { handler } = harness(argentOwner(keyFor("argent", "argentx-bip44", 0)), {
      restriction: "guardian",
    });
    await expect(handler(findMessage(), sender)).resolves.toMatchObject({
      candidate: { restriction: "guardian" },
    });
  });

  test("searches exactly the recovery scan's bound, on both Argent ladders", async () => {
    const last = RECOVERY_SCAN_LIMITS.maxScannedIndexes - 1;
    const found = harness(argentOwner(keyFor("argent", "argentx-bip44", last)));
    await expect(found.handler(findMessage(), sender)).resolves.toMatchObject({ ok: true });
    const beyond = harness(argentOwner(keyFor("argent", "argentx-bip44", last + 1)));
    await expect(beyond.handler(findMessage(), sender)).resolves.toEqual({
      error: ADDRESS_IMPORT_REFUSALS.noMatch,
    });
    expect(beyond.seen.previews).toHaveLength(2 * RECOVERY_SCAN_LIMITS.maxScannedIndexes);
  });

  test("each reason an address cannot be imported is its own refusal", async () => {
    const cases: readonly (readonly [AccountOwnerReading, string])[] = [
      [{ kind: "not-deployed" }, ADDRESS_IMPORT_REFUSALS.notDeployed],
      [{ kind: "unsupported-class" }, ADDRESS_IMPORT_REFUSALS.unsupportedClass],
      [{ family: "argent", kind: "non-stark-owner" }, ADDRESS_IMPORT_REFUSALS.nonStarkOwner],
      [argentOwner("0xdead"), ADDRESS_IMPORT_REFUSALS.noMatch],
    ];
    for (const [reading, refusal] of cases) {
      const { handler } = harness(reading);
      await expect(handler(findMessage(), sender)).resolves.toEqual({ error: refusal });
    }
  });

  test("an address that is not a felt is refused before the chain is read", async () => {
    const { handler, seen } = harness(argentOwner(keyFor("argent", "starknet-bip44", 0)));
    await expect(handler(findMessage("SN_MAIN", "0xnothex"), sender)).resolves.toEqual({
      error: ADDRESS_IMPORT_REFUSALS.invalid,
    });
    expect(seen.ownerReads).toEqual([]);
  });

  test("an unreadable chain, or no reader at all, refuses without deriving anything", async () => {
    for (const owner of [new Error("socket hang up"), undefined]) {
      const { handler, seen } = harness(owner);
      await expect(handler(findMessage(), sender)).resolves.toEqual({
        error: ADDRESS_IMPORT_REFUSALS.unavailable,
      });
      expect(seen.previews).toEqual([]);
    }
  });

  test("reads the chosen network and derives for it", async () => {
    const { handler, seen } = harness(argentOwner(keyFor("argent", "starknet-bip44", 0)));
    await handler(findMessage("SN_SEPOLIA"), sender);
    expect(seen.ownerReads[0]?.rpcUrls).toEqual(STARKNET_NETWORKS.SN_SEPOLIA.rpcUrls);
    expect(seen.previews.every((input) => input.networkId === "SN_SEPOLIA")).toBe(true);
  });

  test("the own-phrase lookup reads the vault's phrase, never the message's", async () => {
    const { handler, seen } = harness(argentOwner(keyFor("argent", "starknet-bip44", 1)));
    await expect(
      handler(
        { address: PASTED, networkId: "SN_MAIN", type: "wallet.findOwnAccountByAddress" },
        sender,
      ),
    ).resolves.toMatchObject({ candidate: { byAddress: true }, ok: true });
    expect(new Set(seen.previews.map((input) => input.mnemonic))).toEqual(new Set([PHRASE]));
    await expect(
      handler(
        {
          address: PASTED,
          mnemonic: PHRASE,
          networkId: "SN_MAIN",
          type: "wallet.findOwnAccountByAddress",
        },
        sender,
      ),
    ).resolves.toEqual({ error: "invalid account lookup request" });
  });

  test("the own-phrase lookup refuses a phrase-less wallet and a locked one", async () => {
    const phraseless = harness(argentOwner("0x10"), { mnemonic: null });
    const message = {
      address: PASTED,
      networkId: "SN_MAIN",
      type: "wallet.findOwnAccountByAddress",
    };
    await expect(phraseless.handler(message, sender)).resolves.toEqual({
      error: "This wallet has no recovery phrase to scan",
    });
    const locked = harness(argentOwner("0x10"), { session: createUnlockSession() });
    await expect(locked.handler(message, sender)).resolves.toEqual({ error: "wallet locked" });
    expect(locked.seen.ownerReads).toEqual([]);
  });
});

const pick = (index: number): RecoveryAccountSelection => ({
  accountContractType: "argent",
  accountIndex: index,
  address: PASTED,
  classHash: ARGENT_ACCOUNT_CLASS_HASH,
  derivation: "argentx-bip44",
});

describe("writing an account picked by its address", () => {
  test("first-run restore re-proves the owner, then commits with the address", async () => {
    const { handler, seen } = harness(argentOwner(keyFor("argent", "argentx-bip44", 4)), {
      session: createUnlockSession(),
    });
    const message = {
      mnemonic: PHRASE,
      networkId: "SN_MAIN",
      selections: [pick(4)],
      type: "wallet.recoverAccounts",
      vaultPassphrase,
    };
    await expect(handler(message, sender)).resolves.toMatchObject({ ok: true });
    expect(seen.recovers[0]?.selections).toEqual([pick(4)]);
  });

  test("first-run restore refuses when the owner no longer matches, or cannot be read", async () => {
    for (const owner of [argentOwner(keyFor("argent", "argentx-bip44", 9)), new Error("timeout")]) {
      const { handler, seen } = harness(owner, { session: createUnlockSession() });
      const response = await handler(
        {
          mnemonic: PHRASE,
          networkId: "SN_MAIN",
          selections: [pick(4)],
          type: "wallet.recoverAccounts",
          vaultPassphrase,
        },
        sender,
      );
      expect(response).toHaveProperty("error");
      expect(seen.recovers).toEqual([]);
    }
  });

  test("another phrase's import refuses before the guarded write, leaving the session unlocked", async () => {
    const { handler, seen, session } = harness(argentOwner("0xdead"));
    await expect(
      handler(
        {
          mnemonic: PHRASE,
          networkId: "SN_SEPOLIA",
          selections: [pick(4)],
          type: "wallet.importSeedAccounts",
        },
        sender,
      ),
    ).resolves.toEqual({ error: ADDRESS_IMPORT_REFUSALS.noMatch });
    expect(seen.imports).toEqual([]);
    expect(session.isUnlocked()).toBe(true);
  });

  test("the own-phrase import re-proves with the vault's phrase, then writes", async () => {
    const { handler, seen } = harness(argentOwner(keyFor("argent", "argentx-bip44", 4)));
    await expect(
      handler(
        { networkId: "SN_MAIN", selections: [pick(4)], type: "wallet.importOwnAccounts" },
        sender,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(seen.imports[0]?.selections).toEqual([pick(4)]);
  });

  test("the own-phrase import refuses a mismatch without locking", async () => {
    const { handler, seen, session } = harness(argentOwner("0xdead"));
    await expect(
      handler(
        { networkId: "SN_MAIN", selections: [pick(4)], type: "wallet.importOwnAccounts" },
        sender,
      ),
    ).resolves.toEqual({ error: ADDRESS_IMPORT_REFUSALS.noMatch });
    expect(seen.imports).toEqual([]);
    expect(session.isUnlocked()).toBe(true);
  });

  test("a family mismatch between the pick and the chain refuses", async () => {
    const { handler, seen } = harness({
      classHash: BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH,
      family: "braavos",
      kind: "owner",
      ownerPublicKey: keyFor("argent", "argentx-bip44", 4),
    });
    await expect(
      handler(
        { networkId: "SN_MAIN", selections: [pick(4)], type: "wallet.importOwnAccounts" },
        sender,
      ),
    ).resolves.toEqual({ error: ADDRESS_IMPORT_REFUSALS.noMatch });
    expect(seen.imports).toEqual([]);
  });

  test("picks without an address skip the chain entirely", async () => {
    const { handler, seen } = harness(new Error("never read"));
    await expect(
      handler(
        {
          networkId: "SN_MAIN",
          selections: [{ accountContractType: "openzeppelin", accountIndex: 0 }],
          type: "wallet.importOwnAccounts",
        },
        sender,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(seen.ownerReads).toEqual([]);
  });
});
