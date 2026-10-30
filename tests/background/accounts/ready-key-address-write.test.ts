/**
 * Import by address for private-key wallets (issue 779), the write half: an
 * address pick is re-proved just before both the in-wallet import and the
 * first-run vault write, bound to the class the lookup recorded, and refused
 * before anything is written (no account, no network move, no lock) when the
 * owner, the class, the session, or the vault changed meanwhile. A pick names
 * one address or a release list, never both.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { ARGENT_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/account-families";
import { canonicalFelt, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import {
  ADDRESS_IMPORT_REFUSALS,
  KEY_ADDRESS_IMPORT_REFUSALS,
} from "@bramble/wallet-model/recovery";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { account, extensionSender as sender } from "../../support/background-wallet-stub";
import {
  argentOwner,
  createByAddress,
  importByAddress,
  KEY,
  keyHarness,
  lookupMessage,
  owned,
  PASTED,
} from "../../support/key-address-harness";
import { ARGENT_031 } from "./ready-key-fixtures";

const ADDRESS = canonicalFelt(PASTED) as string;
const [, MAIN_FOUNDATION] = STARKNET_NETWORKS.SN_MAIN.rpcUrls;
const ARGENT = canonicalFelt(ARGENT_ACCOUNT_CLASS_HASH) as string;

// A preference the import would move: the message names SN_MAIN.
const sepolia = async () => {
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  await preferencesStore.setActiveNetwork("SN_SEPOLIA");
  return preferencesStore;
};

// The chain answers `before` until the first owner read is done, then `after`.
const changesAfterFirstRead = (before: typeof owned, after: typeof owned) => {
  let reads = 0;
  return () => {
    reads += 1;
    return reads <= 2 ? before : after;
  };
};

describe("an in-wallet import of an account found by its address", () => {
  test("re-proves the owner, then writes the account at the pasted address", async () => {
    const { handler, seen } = keyHarness(owned);
    await expect(handler(importByAddress(), sender)).resolves.toEqual({ account, ok: true });
    expect(seen.ownerReads).toHaveLength(2);
    expect(seen.imports).toHaveLength(1);
    const [written] = seen.imports;
    expect(written?.address).toBe(ADDRESS);
    expect(written?.classHash).toBe(ARGENT);
    expect(written?.classHashes).toBeUndefined();
    expect(written?.accountContractType).toBe("argent");
  });

  test("a lookup then an import of the same account succeed end to end", async () => {
    const { handler, seen } = keyHarness(owned);
    const found = (await handler(lookupMessage(), sender)) as {
      readonly candidate: { readonly address: string; readonly classHash: string };
    };
    await expect(
      handler(
        importByAddress({ address: found.candidate.address, classHash: found.candidate.classHash }),
        sender,
      ),
    ).resolves.toEqual({ account, ok: true });
    expect(seen.imports[0]?.address).toBe(ADDRESS);
  });

  test("an owner rotated since the lookup refuses: nothing written, network kept, unlocked", async () => {
    const preferencesStore = await sepolia();
    const { handler, seen, session } = keyHarness(argentOwner("0x0bad"), { preferencesStore });
    await expect(handler(importByAddress(), sender)).resolves.toEqual({
      error: KEY_ADDRESS_IMPORT_REFUSALS.noMatch,
    });
    expect(seen.imports).toEqual([]);
    expect((await preferencesStore.read()).activeNetworkId).toBe("SN_SEPOLIA");
    expect(session.getPassphrase()).not.toBeNull();
  });

  test("a pick naming another class than the account's live one refuses as stale", async () => {
    const { handler, seen, session } = keyHarness(owned);
    await expect(handler(importByAddress({ classHash: ARGENT_031 }), sender)).resolves.toEqual({
      error: ADDRESS_IMPORT_REFUSALS.stale,
    });
    expect(seen.imports).toEqual([]);
    expect(session.getPassphrase()).not.toBeNull();
  });

  test("the re-proof is corroborated: one lying source refuses", async () => {
    const { handler, seen } = keyHarness((input) =>
      input.rpcUrls.includes(MAIN_FOUNDATION as string) ? owned : argentOwner("0x0bad"),
    );
    const response = await handler(importByAddress(), sender);
    expect(response).toEqual({ error: ADDRESS_IMPORT_REFUSALS.unconfirmed });
    expect(seen.imports).toEqual([]);
  });

  test("a lock during the re-proof refuses without writing or moving the network", async () => {
    const preferencesStore = await sepolia();
    const session = createUnlockSession();
    session.unlock("correct horse battery staple");
    const { handler, seen } = keyHarness(owned, {
      onOwnerRead: () => session.lock(),
      preferencesStore,
      session,
    });
    await expect(handler(importByAddress(), sender)).resolves.toEqual({ error: "wallet locked" });
    expect(seen.imports).toEqual([]);
    expect((await preferencesStore.read()).activeNetworkId).toBe("SN_SEPOLIA");
  });

  test("an address pick and a release list together, or half a pick, are refused unread", async () => {
    const malformed = [
      importByAddress({ classHashes: [ARGENT_ACCOUNT_CLASS_HASH] }),
      importByAddress({ classHash: undefined }),
      importByAddress({ address: undefined }),
      importByAddress({ address: `0x${"1".repeat(65)}` }),
      importByAddress({ accountContractType: "openzeppelin" }),
      importByAddress({ accountContractType: "braavos" }),
    ];
    for (const message of malformed) {
      const { handler, seen } = keyHarness(owned);
      await expect(handler(message, sender)).resolves.toEqual({
        error: "invalid import account request",
      });
      expect(seen.ownerReads).toEqual([]);
      expect(seen.imports).toEqual([]);
    }
  });
});

describe("a first-run vault from an account found by its address", () => {
  test("re-proves the owner, then creates the vault at the pasted address", async () => {
    const { handler, seen, session } = keyHarness(owned, {
      hasVault: () => false,
      session: createUnlockSession(),
    });
    await expect(handler(createByAddress(), sender)).resolves.toEqual({ account, ok: true });
    expect(seen.creates).toHaveLength(1);
    expect(seen.creates[0]?.address).toBe(ADDRESS);
    expect(seen.creates[0]?.classHash).toBe(ARGENT);
    expect(session.getPassphrase()).not.toBeNull();
  });

  test("an owner that no longer matches refuses before the vault is created", async () => {
    const { handler, seen, session } = keyHarness(argentOwner("0x0bad"), {
      hasVault: () => false,
      session: createUnlockSession(),
    });
    await expect(handler(createByAddress(), sender)).resolves.toEqual({
      error: KEY_ADDRESS_IMPORT_REFUSALS.noMatch,
    });
    expect(seen.creates).toEqual([]);
    expect(session.getPassphrase()).toBeNull();
  });

  test("a vault created while the proof read the chain is never written into", async () => {
    let vault = false;
    const { handler, seen } = keyHarness(owned, {
      hasVault: () => vault,
      onOwnerRead: () => {
        vault = true;
      },
      session: createUnlockSession(),
    });
    await expect(handler(createByAddress(), sender)).resolves.toEqual({
      error: "Wallet already exists",
    });
    expect(seen.creates).toEqual([]);
  });
});

describe("first-run creation races", () => {
  test("of two proved creations, the one queued second refuses, keeping the winner's network", async () => {
    let vault = false;
    const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
    const { handler, seen, session } = keyHarness(owned, {
      hasVault: () => vault,
      onCreate: () => {
        vault = true;
      },
      preferencesStore,
      session: createUnlockSession(),
    });
    const [first, second] = await Promise.all([
      handler(createByAddress(), sender),
      handler(createByAddress({ networkId: "SN_SEPOLIA" }), sender),
    ]);
    expect(first).toEqual({ account, ok: true });
    expect(second).toEqual({ error: "Wallet already exists" });
    expect(seen.creates).toHaveLength(1);
    expect((await preferencesStore.read()).activeNetworkId).toBe("SN_MAIN");
    expect(session.getPassphrase()).not.toBeNull();
  });
});

describe("lookup races", () => {
  test("a lock during an in-wallet lookup returns nothing", async () => {
    const session = createUnlockSession();
    session.unlock("correct horse battery staple");
    const { handler } = keyHarness(owned, { onOwnerRead: () => session.lock(), session });
    await expect(handler(lookupMessage(), sender)).resolves.toEqual({ error: "wallet locked" });
  });

  test("a lock during the advisory read returns nothing", async () => {
    const session = createUnlockSession();
    session.unlock("correct horse battery staple");
    const { handler } = keyHarness(owned, { onRestriction: () => session.lock(), session });
    await expect(handler(lookupMessage(), sender)).resolves.toEqual({ error: "wallet locked" });
  });

  test("a first-run lookup that ends after a vault appeared returns nothing", async () => {
    let vault = false;
    const { handler } = keyHarness(owned, {
      hasVault: () => vault,
      onOwnerRead: () => {
        vault = true;
      },
      session: createUnlockSession(),
    });
    await expect(handler(lookupMessage(), sender)).resolves.toEqual({
      error: "Wallet already exists",
    });
  });

  test("a first-run lookup needs no session", async () => {
    const { handler } = keyHarness(owned, {
      hasVault: () => false,
      session: createUnlockSession(),
    });
    await expect(handler(lookupMessage(), sender)).resolves.toMatchObject({ ok: true });
  });

  test("an owner rotated between lookup and write is caught by the write", async () => {
    const { handler, seen } = keyHarness(changesAfterFirstRead(owned, argentOwner("0x0bad")));
    await expect(handler(lookupMessage(), sender)).resolves.toMatchObject({ ok: true });
    await expect(handler(importByAddress(), sender)).resolves.toEqual({
      error: KEY_ADDRESS_IMPORT_REFUSALS.noMatch,
    });
    expect(seen.imports).toEqual([]);
    expect(JSON.stringify(seen.ownerReads)).not.toContain(KEY.slice(2));
  });
});
