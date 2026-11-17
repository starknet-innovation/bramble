/** Versioned wallet cards carry only validated public contact material. */
import { describe, expect, test } from "bun:test";
import { parseWalletContactCard, walletContactCard } from "@bramble/wallet-model/preferences";

const CARD = {
  address: "0x123",
  networkId: "SN_MAIN" as const,
  nostrPublicKey: "11".repeat(32),
  publicKeyX: "0x456",
};

describe("wallet contact card", () => {
  test("round-trips canonical public Starknet and Nostr identity", () => {
    const encoded = walletContactCard(CARD);

    expect(encoded).toStartWith("mcw:contact:1:SN_MAIN:");
    expect(parseWalletContactCard(encoded)).toEqual({
      ...CARD,
      address: `0x${"0".repeat(61)}123`,
      publicKeyX: "0x456",
    });
  });

  test("rejects unknown versions and malformed key material", () => {
    expect(
      parseWalletContactCard(walletContactCard(CARD).replace("contact:1", "contact:2")),
    ).toBeNull();
    expect(parseWalletContactCard(`${walletContactCard(CARD)}:extra`)).toBeNull();
    expect(parseWalletContactCard("m".repeat(513))).toBeNull();
    expect(() => walletContactCard({ ...CARD, nostrPublicKey: "0x11" })).toThrow(
      "Invalid wallet contact card",
    );
  });
});
