/**
 * The vault service's shadow-account scope records (#443, PR 5): recorded
 * inside the encrypted vault only, merged by exact nonce, bounded by refusal
 * rather than eviction, and listed per account, chain, and pool.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import { createWalletVaultService } from "@bramble/vault/service";
import {
  canonicalShadowAccountScope,
  MAX_SHADOW_ACCOUNT_NONCES,
  MAX_SHADOW_ACCOUNT_SCOPES,
} from "@bramble/vault/shadow-account-scopes";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
const vaultPassphrase = "correct horse battery staple";
const POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const ANONYMIZER = "0x04f33230dc57855c6e7eabe66dfa0fde82c5458fd0e54827cdb7cb4c474888a7";
const ORIGIN = "https://app.example";

const setup = async () => {
  const store = createMemoryStore();
  const vaultStore = createEncryptedStore(store, "bramble:vault");
  const service = createWalletVaultService({
    encryptedStore: vaultStore,
    kms: fakeKms(),
    migrationStore: createEncryptedStore(store, "bramble:vault-migration"),
  });
  const account = await service.createAccount({
    accountContractType: "openzeppelin",
    mnemonic,
    vaultPassphrase,
  });
  const chainId = STARKNET_NETWORKS[account.networkId].chainId;
  const scope = {
    accountId: account.id,
    anonymizer: ANONYMIZER,
    chainId,
    label: "Market",
    origin: ORIGIN,
    poolAddress: POOL,
    vaultPassphrase,
  };
  const list = () =>
    service.listShadowAccountScopes({
      accountId: account.id,
      chainId,
      poolAddress: POOL,
      vaultPassphrase,
    });
  return { account, chainId, list, scope, service, store, vaultStore };
};

describe("shadow account scope records", () => {
  test("records a scope canonically and merges exact nonces", async () => {
    const { list, scope, service } = await setup();
    await service.recordShadowAccountScope({ ...scope, nonces: [] });
    await service.recordShadowAccountScope({ ...scope, nonces: ["0x0a", "0x2"] });
    await service.recordShadowAccountScope({ ...scope, nonces: ["0x2", "0x0"] });
    expect(await list()).toEqual([
      {
        accountId: scope.accountId,
        anonymizer: "0x4f33230dc57855c6e7eabe66dfa0fde82c5458fd0e54827cdb7cb4c474888a7",
        chainId: scope.chainId,
        label: "Market",
        nonces: ["0x0", "0x2", "0xa"],
        origin: ORIGIN,
        poolAddress: "0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
      },
    ]);
  });

  test("keeps distinct origins, labels, and anonymizers as distinct scopes", async () => {
    const { list, scope, service } = await setup();
    await service.recordShadowAccountScope({ ...scope, nonces: ["0x1"] });
    await service.recordShadowAccountScope({ ...scope, label: "Other", nonces: ["0x1"] });
    await service.recordShadowAccountScope({
      ...scope,
      nonces: ["0x1"],
      origin: "https://b.example",
    });
    await service.recordShadowAccountScope({ ...scope, anonymizer: "0x99", nonces: ["0x1"] });
    expect(await list()).toHaveLength(4);
  });

  test("lists only the requested pool", async () => {
    const { account, chainId, scope, service } = await setup();
    await service.recordShadowAccountScope({ ...scope, nonces: ["0x1"] });
    expect(
      await service.listShadowAccountScopes({
        accountId: account.id,
        chainId,
        poolAddress: "0x77",
        vaultPassphrase,
      }),
    ).toEqual([]);
  });

  test("stores the record only encrypted", async () => {
    const { scope, service, store } = await setup();
    await service.recordShadowAccountScope({ ...scope, nonces: ["0x1"] });
    const raw = JSON.stringify(await store.get("bramble:vault"));
    expect(raw).not.toContain("app.example");
    expect(raw).not.toContain("Market");
  });

  test("refuses past the nonce bound rather than dropping a record", async () => {
    const { list, scope, service } = await setup();
    const nonces = Array.from(
      { length: MAX_SHADOW_ACCOUNT_NONCES },
      (_, i) => `0x${i.toString(16)}`,
    );
    await service.recordShadowAccountScope({ ...scope, nonces });
    await expect(
      service.recordShadowAccountScope({ ...scope, nonces: [`0x${(1000).toString(16)}`] }),
    ).rejects.toThrow("shadow account record limit reached");
    expect((await list())[0]?.nonces).toHaveLength(MAX_SHADOW_ACCOUNT_NONCES);
  });

  // Audit F9: the scope bound refuses a new scope; it never evicts the oldest
  // to make room, since a dropped record is a shadow account the wallet can no
  // longer find. An existing scope still merges new nonces at the bound.
  test("refuses past the scope bound rather than evicting a record", async () => {
    const { list, scope, service, vaultStore } = await setup();
    // Seeded in one write: recording 128 scopes one by one is 128 vault writes.
    const { vaultPassphrase: _passphrase, ...ref } = scope;
    const seeded = Array.from({ length: MAX_SHADOW_ACCOUNT_SCOPES }, (_, index) =>
      canonicalShadowAccountScope({ ...ref, label: `Site ${index}`, nonces: [] }),
    );
    const vault = (await vaultStore.read(vaultPassphrase)) as Record<string, unknown>;
    await vaultStore.write({ ...vault, shadowAccountScopes: seeded } as never, vaultPassphrase);
    const full = await list();
    expect(full).toHaveLength(MAX_SHADOW_ACCOUNT_SCOPES);
    const next = { ...scope, label: "One more", nonces: ["0x1"] };
    expect(await service.canRecordShadowAccountScope(next)).toBe(false);
    await expect(service.recordShadowAccountScope(next)).rejects.toThrow(
      "shadow account record limit reached",
    );
    expect(await list()).toEqual(full);
    expect(full[0]?.label).toBe("Site 0");
    // A scope already recorded can still gain a nonce.
    const existing = { ...scope, label: "Site 0", nonces: ["0x5"] };
    expect(await service.canRecordShadowAccountScope(existing)).toBe(true);
    await service.recordShadowAccountScope(existing);
    expect((await list())[0]?.nonces).toEqual(["0x5"]);
  });

  test("the pre-check answers like the record without writing", async () => {
    const { list, scope, service, store } = await setup();
    const before = JSON.stringify(await store.get("bramble:vault"));
    expect(await service.canRecordShadowAccountScope({ ...scope, nonces: ["0x1"] })).toBe(true);
    expect(JSON.stringify(await store.get("bramble:vault"))).toBe(before);
    expect(await list()).toEqual([]);
    const nonces = Array.from(
      { length: MAX_SHADOW_ACCOUNT_NONCES },
      (_, i) => `0x${i.toString(16)}`,
    );
    await service.recordShadowAccountScope({ ...scope, nonces });
    expect(await service.canRecordShadowAccountScope({ ...scope, nonces: ["0x3e8"] })).toBe(false);
    await expect(
      service.canRecordShadowAccountScope({ ...scope, nonces: [], origin: "http://x.example" }),
    ).rejects.toThrow("invalid shadow account record");
  });

  test("refuses a malformed scope, an unknown account, and a wrong passphrase", async () => {
    const { scope, service } = await setup();
    await expect(
      service.recordShadowAccountScope({ ...scope, nonces: [], origin: "http://x.example" }),
    ).rejects.toThrow("invalid shadow account record");
    await expect(
      service.recordShadowAccountScope({
        ...scope,
        chainId: STARKNET_NETWORKS.SN_SEPOLIA.chainId,
        nonces: [],
      }),
    ).rejects.toThrow("invalid shadow account record");
    await expect(
      service.recordShadowAccountScope({ ...scope, accountId: "SN_MAIN:0x999", nonces: [] }),
    ).rejects.toThrow();
    await expect(
      service.recordShadowAccountScope({
        ...scope,
        nonces: [],
        vaultPassphrase: "wrong passphrase!!",
      }),
    ).rejects.toThrow();
  });
});
