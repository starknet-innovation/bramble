/**
 * Import by address (issue 398), the trust half: no single endpoint decides
 * ownership (two chain-checked SNF-operated sources must agree), a lock ends
 * an own-phrase search, an own-phrase proof is bound to the phrase and unlock
 * that write it, and only extension pages reach the lookups.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import type { AccountOwnerReading } from "@bramble/starknet/rpc";
import { createMemoryStore } from "@bramble/store/kv";
import { BRAAVOS_DEPLOYMENT_CLASS_HASH } from "@bramble/wallet-model/account-families";
import { canonicalFelt, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { ADDRESS_IMPORT_REFUSALS } from "@bramble/wallet-model/recovery";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  argentOwner,
  findMessage,
  harness,
  keyFor,
  type OwnerRead,
  PASTED,
  PHRASE,
  pick,
} from "../../support/address-import-harness";
import {
  contentSender,
  extensionSender as sender,
  vaultPassphrase,
} from "../../support/background-wallet-stub";

const [MAIN_GATEWAY, MAIN_FOUNDATION] = STARKNET_NETWORKS.SN_MAIN.rpcUrls;
const OWNER_KEY = keyFor("argent", "starknet-bip44", 2);
const truth = argentOwner(OWNER_KEY);
// One source tells `lie`; the bundled Foundation-direct node tells the truth.
const primaryLies =
  (lie: AccountOwnerReading) =>
  (input: OwnerRead): AccountOwnerReading =>
    input.rpcUrls.includes(MAIN_FOUNDATION as string) ? truth : lie;

describe("ownership must be confirmed by two SNF-operated sources", () => {
  test("both sources agreeing finds the account", async () => {
    const { handler } = harness(primaryLies(truth));
    await expect(handler(findMessage(), sender)).resolves.toMatchObject({ ok: true });
  });

  test("one source lying about the owner, the class, or deployment is refused", async () => {
    const lies: readonly AccountOwnerReading[] = [
      argentOwner(keyFor("argent", "starknet-bip44", 7)),
      { ...truth, classHash: BRAAVOS_DEPLOYMENT_CLASS_HASH },
      { kind: "not-deployed" },
      { family: "argent", kind: "non-stark-owner", ownerType: "0x2" },
    ];
    for (const lie of lies) {
      const { handler } = harness(primaryLies(lie));
      await expect(handler(findMessage(), sender)).resolves.toEqual({
        error: ADDRESS_IMPORT_REFUSALS.unconfirmed,
      });
    }
  });

  test("a custom endpoint is checked against the bundled Foundation node, and refused when they differ", async () => {
    const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
    const custom = "https://rpc.custom.example/v0_10";
    await preferencesStore.setRpcOverride({ networkId: "SN_MAIN", rpcUrl: custom });
    const lying = harness(
      (input) =>
        input.rpcUrls[0] === custom ? argentOwner(keyFor("argent", "argentx-bip44", 0)) : truth,
      { preferencesStore },
    );
    await expect(lying.handler(findMessage(), sender)).resolves.toEqual({
      error: ADDRESS_IMPORT_REFUSALS.unconfirmed,
    });
    expect(lying.seen.ownerReads.map(({ rpcUrls }) => rpcUrls)).toEqual([
      [custom, MAIN_GATEWAY],
      [MAIN_FOUNDATION],
    ]);
  });

  test("an unreachable or wrong-chain second source fails closed", async () => {
    const { handler, seen } = harness((input) =>
      input.rpcUrls.includes(MAIN_FOUNDATION as string)
        ? new Error("RPC endpoint returned the wrong Starknet chain")
        : truth,
    );
    await expect(handler(findMessage(), sender)).resolves.toEqual({
      error: ADDRESS_IMPORT_REFUSALS.unavailable,
    });
    expect(seen.previews).toEqual([]);
  });

  test("a network with no bundled Foundation node has no second source", async () => {
    const { handler, seen } = harness(truth);
    await expect(handler(findMessage("SN_DEVNET"), sender)).resolves.toEqual({
      error: ADDRESS_IMPORT_REFUSALS.unavailable,
    });
    expect(seen.ownerReads).toEqual([]);
  });

  test("the pre-write re-proof is corroborated too", async () => {
    const { handler, seen } = harness(
      primaryLies(argentOwner(keyFor("argent", "argentx-bip44", 4))),
    );
    await expect(
      handler(
        {
          mnemonic: PHRASE,
          networkId: "SN_MAIN",
          selections: [pick(4)],
          type: "wallet.importSeedAccounts",
        },
        sender,
      ),
    ).resolves.toEqual({ error: ADDRESS_IMPORT_REFUSALS.unconfirmed });
    expect(seen.imports).toEqual([]);
  });
});

describe("a lock during an own-phrase lookup ends it", () => {
  const ownLookup = {
    address: PASTED,
    networkId: "SN_MAIN",
    type: "wallet.findOwnAccountByAddress",
  };

  test("a lock while a key is derived stops before the next ladder", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const { handler, seen } = harness(argentOwner("0xdead"), {
      onPreview: () => session.lock(),
      session,
    });
    await expect(handler(ownLookup, sender)).resolves.toEqual({ error: "wallet locked" });
    expect(seen.previews).toHaveLength(1);
  });

  test("a lock during the advisory read returns no candidate", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const { handler } = harness(truth, { onRestriction: () => session.lock(), session });
    await expect(handler(ownLookup, sender)).resolves.toEqual({ error: "wallet locked" });
  });
});

describe("an own-phrase proof is bound to the phrase and unlock that write it", () => {
  const ownImport = {
    networkId: "SN_MAIN",
    selections: [pick(4)],
    type: "wallet.importOwnAccounts",
  };
  const readyOwner = argentOwner(keyFor("argent", "argentx-bip44", 4));

  test("a vault whose phrase changed after the proof is refused without writing or locking", async () => {
    const other =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    const { handler, seen, session } = harness(readyOwner, { mnemonics: [PHRASE, other] });
    await expect(handler(ownImport, sender)).resolves.toEqual({
      error: ADDRESS_IMPORT_REFUSALS.stale,
    });
    expect(seen.imports).toEqual([]);
    expect(session.isUnlocked()).toBe(true);
  });

  test("an unlock replaced while the proof ran is refused without writing", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    let relocked = false;
    const { handler, seen } = harness(readyOwner, {
      onOwnerRead: () => {
        if (relocked) return;
        relocked = true;
        session.lock();
        session.unlock(vaultPassphrase);
      },
      session,
    });
    await expect(handler(ownImport, sender)).resolves.toEqual({
      error: ADDRESS_IMPORT_REFUSALS.stale,
    });
    expect(seen.imports).toEqual([]);
  });
});

describe("what two sources must agree on", () => {
  const nonStark = (ownerType: string): AccountOwnerReading => ({
    family: "argent",
    kind: "non-stark-owner",
    ownerType,
  });

  test("two sources naming different non-Stark owner types are unconfirmed", async () => {
    const differ = harness((input) =>
      nonStark(input.rpcUrls.includes(MAIN_FOUNDATION as string) ? "0x2" : "0x1"),
    );
    await expect(differ.handler(findMessage(), sender)).resolves.toEqual({
      error: ADDRESS_IMPORT_REFUSALS.unconfirmed,
    });
    const agree = harness(nonStark("0x2"));
    await expect(agree.handler(findMessage(), sender)).resolves.toEqual({
      error: ADDRESS_IMPORT_REFUSALS.nonStarkOwner,
    });
  });

  test("the recorded class is always the canonical spelling", async () => {
    const padded = `0x${BRAAVOS_DEPLOYMENT_CLASS_HASH.slice(2).padStart(64, "0").toUpperCase()}`;
    const { handler, seen } = harness({
      classHash: padded,
      family: "braavos",
      kind: "owner",
      ownerPublicKey: keyFor("braavos", undefined, 0),
    });
    const response = (await handler(findMessage(), sender)) as unknown as {
      candidate: { account: { classHash: string } };
    };
    const canonical = canonicalFelt(BRAAVOS_DEPLOYMENT_CLASS_HASH) as string;
    expect(response.candidate.account.classHash).toBe(canonical);
    expect(seen.previews.map(({ classHash }) => classHash)).toEqual([canonical]);
  });

  test("a class hash that is not a felt is never recorded", async () => {
    const { handler, seen } = harness({ ...truth, classHash: "not-a-felt" });
    await expect(handler(findMessage(), sender)).resolves.toEqual({
      error: ADDRESS_IMPORT_REFUSALS.unconfirmed,
    });
    expect(seen.previews).toEqual([]);
  });
});

describe("the lookups' boundaries", () => {
  test("content scripts cannot reach either lookup", async () => {
    const { handler, seen } = harness(truth);
    for (const message of [
      findMessage(),
      { address: PASTED, networkId: "SN_MAIN", type: "wallet.findOwnAccountByAddress" },
    ]) {
      await expect(handler(message, contentSender)).resolves.toEqual({
        error: "privileged sender required",
      });
    }
    expect(seen.ownerReads).toEqual([]);
  });

  test("every spelling of one address is one account", async () => {
    const ids = new Set<string>();
    for (const spelling of [PASTED, "0x0007e57ad0e55", "0x7E57AD0E55"]) {
      const { handler } = harness(truth);
      const response = (await handler(findMessage("SN_MAIN", spelling), sender)) as unknown as {
        candidate: { account: { address: string; id: string } };
      };
      expect(response.candidate.account.address).toBe(PASTED);
      ids.add(response.candidate.account.id);
    }
    expect([...ids]).toEqual([`SN_MAIN:${PASTED}`]);
  });
});
