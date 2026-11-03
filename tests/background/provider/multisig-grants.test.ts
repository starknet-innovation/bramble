/**
 * A multisig origin grant that loses its unlock during the encrypted write is
 * rolled back, the same window the vault's origin grant closes.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
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
});
