/**
 * Disconnecting one account from a connected site: the handler narrows the
 * revoke to that id in both the vault grant and the multisig grant ledger,
 * drops the site once nothing remains, leaves every other grant alone, and
 * refuses an id that is not canonical. A full revoke still clears both stores.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import type { KmsPort } from "@bramble/vault/kms-port";
import { createWalletVaultService } from "@bramble/vault/service";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import {
  encryptedMultisigGrantStore,
  type MultisigOriginGrantStore,
} from "../../../apps/extension/src/background/provider/multisig-grants";
import { readRevokeOriginInput } from "../../../apps/extension/src/background/routing/message-inputs";
import { walletEventBroadcasts } from "../../../apps/extension/src/background/runtime/events";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  handleOriginOps,
  type OriginOpsDeps,
} from "../../../apps/extension/src/background/settings/origins-ops";

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
const vaultPassphrase = "correct horse battery staple";
const ALPHA = "https://alpha.example";
const BETA = "https://beta.example";
const MULTISIG_ONE = "SN_MAIN:0x123";
const MULTISIG_TWO = "SN_MAIN:0x456";

const indexedKms = (): KmsPort => ({
  ...fakeKms(),
  async deriveStarknetKeypair(_mnemonic, _addressIndex, accountIndex) {
    return {
      privateKey: `0x1234${accountIndex + 1}`,
      publicKeyX: `0xabc${accountIndex}`,
      publicKeyY: "0xdef",
    };
  },
});

let deps: OriginOpsDeps;
let grants: MultisigOriginGrantStore;
let first: AccountRef;
let second: AccountRef;

const revoke = (message: Record<string, unknown>) =>
  handleOriginOps(deps, "wallet.revokeOrigin", { ...message, type: "wallet.revokeOrigin" });
const listed = () =>
  handleOriginOps(deps, "wallet.connectedSites", { type: "wallet.connectedSites" });

beforeEach(async () => {
  const service = createWalletVaultService({
    encryptedStore: createEncryptedStore(createMemoryStore(), "bramble:vault"),
    kms: indexedKms(),
    migrationStore: createEncryptedStore(createMemoryStore(), "bramble:vault-migration"),
  });
  first = await service.createAccount({
    accountContractType: "openzeppelin",
    mnemonic,
    vaultPassphrase,
  });
  second = await service.addDerivedAccount({
    accountContractType: "openzeppelin",
    networkId: "SN_MAIN",
    vaultPassphrase,
  });
  for (const accountId of [first.id, second.id]) {
    await service.grantOrigin({ accountId, origin: ALPHA, vaultPassphrase });
  }
  await service.grantOrigin({ accountId: first.id, origin: BETA, vaultPassphrase });
  grants = encryptedMultisigGrantStore(
    createEncryptedStore(createMemoryStore(), "bramble:multisig-origin-grants"),
  );
  const grant = (origin: string, multisigId: string) =>
    grants.grant({ credential: vaultPassphrase, isAuthorized: () => true, multisigId, origin });
  await grant(ALPHA, MULTISIG_ONE);
  await grant(ALPHA, MULTISIG_TWO);
  await grant(BETA, MULTISIG_ONE);
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  deps = {
    multisigGrants: grants,
    session,
    wallet: {
      readVault: service.readVault,
      revokeOrigin: service.revokeOrigin,
    } as unknown as OriginOpsDeps["wallet"],
  };
});

describe("revoking one account from a connected site", () => {
  test("lists every vault and multisig id a site was given", async () => {
    await expect(listed()).resolves.toEqual({
      ok: true,
      sites: [
        {
          accountCount: 4,
          accountIds: [first.id, second.id],
          multisigIds: [MULTISIG_ONE, MULTISIG_TWO],
          origin: ALPHA,
        },
        { accountCount: 2, accountIds: [first.id], multisigIds: [MULTISIG_ONE], origin: BETA },
      ],
    });
  });

  test("removes only that vault account from only that site", async () => {
    await expect(revoke({ accountId: first.id, origin: ALPHA })).resolves.toEqual({
      ok: true,
      sites: [
        {
          accountCount: 3,
          accountIds: [second.id],
          multisigIds: [MULTISIG_ONE, MULTISIG_TWO],
          origin: ALPHA,
        },
        { accountCount: 2, accountIds: [first.id], multisigIds: [MULTISIG_ONE], origin: BETA },
      ],
    });
  });

  test("removes only that multisig from only that site", async () => {
    await revoke({ accountId: MULTISIG_ONE, origin: ALPHA });
    expect(await grants.idsFor(ALPHA, vaultPassphrase)).toEqual([MULTISIG_TWO]);
    expect(await grants.idsFor(BETA, vaultPassphrase)).toEqual([MULTISIG_ONE]);
  });

  test("drops the site once its last account goes", async () => {
    await revoke({ accountId: first.id, origin: BETA });
    await expect(revoke({ accountId: MULTISIG_ONE, origin: BETA })).resolves.toMatchObject({
      ok: true,
      sites: [{ origin: ALPHA }],
    });
  });

  test("changes nothing for an id the site was not given", async () => {
    const before = await listed();
    await revoke({ accountId: second.id, origin: BETA });
    await revoke({ accountId: MULTISIG_TWO, origin: BETA });
    await revoke({ accountId: "SN_MAIN:0x789", origin: ALPHA });
    await expect(listed()).resolves.toEqual(before);
  });

  test("refuses an id that is not a canonical account id", async () => {
    const before = await listed();
    for (const accountId of ["SN_MAIN:0x0123", "0x123", "", 7, null, ["SN_MAIN:0x123"]]) {
      await expect(revoke({ accountId, origin: ALPHA })).resolves.toEqual({
        error: "invalid revoke origin request",
      });
    }
    await expect(listed()).resolves.toEqual(before);
  });

  test("without an id still revokes the whole site from both stores", async () => {
    await expect(revoke({ origin: ALPHA })).resolves.toEqual({
      ok: true,
      sites: [
        { accountCount: 2, accountIds: [first.id], multisigIds: [MULTISIG_ONE], origin: BETA },
      ],
    });
    expect(await grants.idsFor(ALPHA, vaultPassphrase)).toEqual([]);
  });

  test("broadcasts accountsChanged so the site re-reads what it can see", () => {
    const message = { accountId: first.id, origin: ALPHA, type: "wallet.revokeOrigin" };
    expect(walletEventBroadcasts(message, { ok: true, sites: [] })).toEqual([
      { event: "accountsChanged", type: "wallet.event" },
    ]);
    expect(walletEventBroadcasts(message, { error: "wallet locked" })).toEqual([]);
  });
});

describe("revoke-origin message parser", () => {
  test("accepts a canonical account id beside the normalized origin", () => {
    expect(
      readRevokeOriginInput({
        accountId: MULTISIG_ONE,
        origin: "https://example.com/path",
        type: "wallet.revokeOrigin",
      }),
    ).toEqual({ accountId: MULTISIG_ONE, origin: "https://example.com" });
  });

  test("rejects any account id that is not canonical", () => {
    for (const bad of ["SN_MAIN:0x0123", "SN_MAIN:0x0", "SN_NOPE:0x123", "0x123", "", 1, null]) {
      expect(
        readRevokeOriginInput({
          accountId: bad,
          origin: "https://example.com",
          type: "wallet.revokeOrigin",
        }),
      ).toBeNull();
    }
  });
});
