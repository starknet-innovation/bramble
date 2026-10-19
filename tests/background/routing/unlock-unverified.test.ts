/**
 * `wallet.unlockUnverified`, the recovery screen's "Unlock anyway" (Sherlock
 * #138), through the real vault service and message handler.
 *
 * A vault the store cannot verify reports why in `wallet.status`, a normal
 * unlock still fails on it, and "Unlock anyway" accepts it with the passphrase,
 * drops every site connection, and unlocks. A vault that verifies is refused,
 * so the message cannot skip the freshness check on a healthy wallet.
 */
import { describe, expect, test } from "bun:test";
import type { Json } from "@bramble/core/json";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import { createWalletVaultService } from "@bramble/vault/service";
import { createWalletReader } from "../../../apps/extension/src/background/accounts/wallet-reader";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  extensionSender as sender,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";

const vaultKey = "bramble:vault";
const origin = "https://example.com";

// One install wired like `background/index.ts`; `open` is a browser restart.
const install = async () => {
  const local = createMemoryStore();
  const sync = createMemoryStore();
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  const open = () => {
    const session = createMemoryStore();
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(local, vaultKey, sync, session, true),
      kms: fakeKms(),
      migrationStore: createEncryptedStore(local, "bramble:vault-migration", sync, session),
    });
    return {
      handler: createMessageHandler(createWalletReader(Promise.resolve(service)), testExtension, {
        preferencesStore,
        session: createUnlockSession(),
      }),
      service,
    };
  };
  const { service } = open();
  await service.createLedgerVault({
    accountContractType: "openzeppelin",
    accountIndex: 0,
    networkId: "SN_MAIN",
    publicKeyX: "0xdef123",
    vaultPassphrase,
  });
  await service.grantOrigin({ origin, vaultPassphrase });
  return { local, open, sync };
};

const dropRecords = async (
  local: Awaited<ReturnType<typeof install>>["local"],
  sync: typeof local,
) => {
  const lineage = ((await local.get(vaultKey)) as { readonly lineage: string }).lineage;
  await sync.remove(`${vaultKey}:commit:${lineage}`);
  await local.remove(`${vaultKey}:commit:${lineage}`);
};

describe("wallet.unlockUnverified", () => {
  test("recovers a vault no record vouches for, drops site connections, and unlocks", async () => {
    const { local, open, sync } = await install();
    await dropRecords(local, sync);
    const { handler, service } = open();

    await expect(handler({ type: "wallet.status" }, sender)).resolves.toMatchObject({
      hasVault: true,
      locked: true,
      recovery: "unverified",
    });
    await expect(handler({ type: "wallet.unlock", vaultPassphrase }, sender)).resolves.toEqual({
      error: "Encrypted store commit state missing",
    });

    const unlocked = (await handler(
      { type: "wallet.unlockUnverified", vaultPassphrase },
      sender,
    )) as Record<string, Json>;

    expect(unlocked).toMatchObject({ accountCount: 1, locked: false });
    expect(unlocked["recovery"]).toBeUndefined();
    expect((await service.readVault(vaultPassphrase)).originGrants).toEqual([]);
    await expect(handler({ origin, type: "wallet.getGrantedAccounts" }, sender)).resolves.toEqual({
      accounts: [],
      ok: true,
    });
  });

  test("refuses a wrong passphrase and leaves the vault awaiting recovery", async () => {
    const { local, open, sync } = await install();
    await dropRecords(local, sync);
    const { handler } = open();

    await expect(
      handler(
        { type: "wallet.unlockUnverified", vaultPassphrase: "wrong horse battery staple" },
        sender,
      ),
    ).resolves.toEqual({ error: "Incorrect passphrase" });

    await expect(handler({ type: "wallet.status" }, sender)).resolves.toMatchObject({
      locked: true,
      recovery: "unverified",
    });
  });

  test("refuses a vault that verifies and keeps its site connections", async () => {
    const { open } = await install();
    const { handler, service } = open();

    await expect(
      handler({ type: "wallet.unlockUnverified", vaultPassphrase }, sender),
    ).resolves.toEqual({ error: "Encrypted store is not awaiting recovery" });

    expect((await service.readVault(vaultPassphrase)).originGrants).not.toEqual([]);
  });

  test("rejects a malformed request", async () => {
    const { open } = await install();
    const { handler } = open();
    await expect(
      handler({ type: "wallet.unlockUnverified", vaultPassphrase, extra: true }, sender),
    ).resolves.toEqual({ error: "invalid unlock request" });
  });
});
