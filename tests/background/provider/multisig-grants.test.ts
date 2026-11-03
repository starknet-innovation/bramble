/**
 * A multisig origin grant that loses its unlock during the encrypted write is
 * rolled back, the same window the vault's origin grant closes.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { createEncryptedStore, type EncryptedStore } from "@bramble/vault/encrypted-store";
import { encryptedMultisigGrantStore } from "../../../apps/extension/src/background/provider/multisig-grants";

const credential = "correct horse battery staple";
const origin = "https://example.com";
const multisigId = "SN_MAIN:0x123";

const lapsingAfter = (passing: number) => {
  let checks = 0;
  return () => {
    checks += 1;
    return checks <= passing;
  };
};

const setup = () => {
  const local = createMemoryStore();
  const grants = encryptedMultisigGrantStore(
    createEncryptedStore(local, "bramble:multisig-origin-grants"),
  );
  return { grants };
};

describe("encrypted multisig origin grants", () => {
  test("a lock before the commit stores nothing", async () => {
    const { grants } = setup();
    await expect(
      grants.grant({
        credential,
        isAuthorized: lapsingAfter(2),
        multisigId,
        origin,
      }),
    ).rejects.toThrow("wallet locked");
    expect(await grants.idsFor(origin, credential)).toEqual([]);
  });

  test("a lock during the storage writes is rolled back", async () => {
    const { grants } = setup();
    await expect(
      grants.grant({
        credential,
        isAuthorized: lapsingAfter(3),
        multisigId,
        origin,
      }),
    ).rejects.toThrow("wallet locked");
    expect(await grants.idsFor(origin, credential)).toEqual([]);
  });

  test("an authorization that holds stores the grant", async () => {
    const { grants } = setup();
    await grants.grant({
      credential,
      isAuthorized: () => true,
      multisigId,
      origin,
    });
    expect(await grants.idsFor(origin, credential)).toEqual([multisigId]);
  });

  test("a grant still in flight cannot drop another site's grant", async () => {
    const blobs: unknown[] = [];
    let writes = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = {
      clearKeys() {
        return undefined;
      },
      async exists() {
        return blobs.length > 0;
      },
      async health() {
        return "current" as const;
      },
      async read() {
        return blobs.at(-1);
      },
      async readUnverified() {
        throw new Error("unused");
      },
      async remove() {
        blobs.length = 0;
      },
      async replaceUnverified() {
        throw new Error("unused");
      },
      async upgradeLegacyEnvelope() {
        throw new Error("unused");
      },
      async write(value: unknown, _credential: string, beforeCommit?: () => void) {
        beforeCommit?.();
        writes += 1;
        if (writes === 1) await gate;
        blobs.push(value);
      },
    } as unknown as EncryptedStore;
    const grants = encryptedMultisigGrantStore(store);
    const first = grants.grant({
      credential,
      isAuthorized: () => true,
      multisigId: "SN_MAIN:0x123",
      origin: "https://a.example",
    });
    for (let attempt = 0; writes < 1 && attempt < 20; attempt += 1) {
      await Promise.resolve();
    }
    expect(writes).toBe(1);
    const second = grants.grant({
      credential,
      isAuthorized: () => true,
      multisigId: "SN_MAIN:0x456",
      origin: "https://b.example",
    });
    release();
    await first;
    await second;
    expect(await grants.idsFor("https://a.example", credential)).toEqual(["SN_MAIN:0x123"]);
    expect(await grants.idsFor("https://b.example", credential)).toEqual(["SN_MAIN:0x456"]);
  });
});
