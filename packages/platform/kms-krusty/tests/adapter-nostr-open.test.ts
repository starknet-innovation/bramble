/**
 * Krusty 3.x adds replay metadata (`wrapId`, `rumorId`, `createdAt`) to the
 * opened Nostr gift wrap. These checks pin that the adapter accepts exactly
 * that shape, binds `wrapId` to the event it passed in, and fails closed on
 * any malformed or missing field.
 */
import { describe, expect, test } from "bun:test";
import { createKrustyKms } from "@bramble/kms-krusty/adapter";

const MNEMONIC = "habit hope tip crystal because grunt nation idea electric witness alert like";
const GIFT_WRAP_ID = "ab".repeat(32);
const GIFT_WRAP = JSON.stringify({
  content: "ciphertext",
  created_at: 1,
  id: GIFT_WRAP_ID,
  kind: 1_059,
  pubkey: "22".repeat(32),
  sig: "33".repeat(64),
  tags: [["p", "44".repeat(32)]],
});
const OPENED = {
  content: "payload",
  createdAt: "1700000000",
  identifier: "mc-wallet.multisig",
  rumorId: "55".repeat(32),
  senderPublicKey: "22".repeat(32),
  wrapId: GIFT_WRAP_ID,
} as const;

const openWith = (result: unknown): Promise<unknown> => {
  const unused = (): never => {
    throw new Error("not used");
  };
  return createKrustyKms({
    deriveArgentLegacyKeypair: unused,
    deriveNostrPublicKey: unused,
    deriveOzAccountAddress: unused,
    deriveScopedStrk20ViewingKey: unused,
    deriveStarknetKeypair: unused,
    generateMnemonic: unused,
    getAccountClassHashes: unused,
    openNostrApplicationData: () => JSON.stringify(result),
    signStarkHash: unused,
    validateMnemonic: unused,
    wrapNostrApplicationData: unused,
  }).openNostrApplicationData(MNEMONIC, 0, 0, GIFT_WRAP);
};

describe("openNostrApplicationData Krusty 3.x result", () => {
  test("accepts the replay metadata and returns only the application data", async () => {
    await expect(openWith(OPENED)).resolves.toEqual({
      content: "payload",
      identifier: "mc-wallet.multisig",
      senderPublicKey: "22".repeat(32),
    });
    await expect(openWith({ ...OPENED, createdAt: "18446744073709551615" })).resolves.toBeDefined();
    await expect(openWith({ ...OPENED, createdAt: "0" })).resolves.toBeDefined();
  });

  test.each([
    ["a wrap id for a different event", { wrapId: "66".repeat(32) }],
    ["an uppercase wrap id", { wrapId: GIFT_WRAP_ID.toUpperCase() }],
    ["a missing wrap id", { wrapId: undefined }],
    ["a short rumor id", { rumorId: "55".repeat(31) }],
    ["a missing rumor id", { rumorId: undefined }],
    ["a numeric createdAt", { createdAt: 1_700_000_000 }],
    ["a createdAt above u64", { createdAt: "18446744073709551616" }],
    ["a zero-padded createdAt", { createdAt: "01" }],
    ["a negative createdAt", { createdAt: "-1" }],
    ["a missing createdAt", { createdAt: undefined }],
    ["an unknown field", { extra: "x" }],
  ])("rejects %s", async (_label, override) => {
    await expect(openWith({ ...OPENED, ...override })).rejects.toThrow(
      "Krusty KMS returned invalid Nostr application data",
    );
  });
});
