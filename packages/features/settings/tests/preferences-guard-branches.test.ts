/**
 * Coverage for the preferences store mutator guard branches: each mutator
 * rejects malformed input with a WalletError before it writes, exercising the
 * per-method validation returns.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";

const store = () => createPreferencesStore({ store: createMemoryStore() });

describe("preferences store validation guards", () => {
  test("addNft rejects an NFT on an unknown network", async () => {
    // Numeric contract/tokenId survive id normalization; the unknown network id
    // is what fails the isWatchedNft check.
    await expect(
      store().addNft({ contract: "0x1", networkId: "SN_FAKE" as never, tokenId: "1" }),
    ).rejects.toThrow("Invalid NFT");
  });

  test("removeAddress rejects an empty id", async () => {
    await expect(store().removeAddress("")).rejects.toThrow("Invalid address book entry");
  });

  test("removeNft rejects an empty id", async () => {
    await expect(store().removeNft("")).rejects.toThrow("Invalid NFT");
  });

  test("setNftSpam rejects an empty id", async () => {
    await expect(store().setNftSpam({ id: "", spam: true })).rejects.toThrow("Invalid NFT");
  });

  test("setAccountLabel rejects a malformed account id", async () => {
    await expect(
      store().setAccountLabel({ accountId: "not-an-account", label: "Main" }),
    ).rejects.toThrow("Invalid account id");
  });

  test("setAccountLabel rejects an over-long label for a valid account id", async () => {
    await expect(
      store().setAccountLabel({ accountId: "SN_MAIN:0x1", label: "x".repeat(65) }),
    ).rejects.toThrow("Invalid account label");
  });

  test("saveAddress rejects a malformed address book entry", async () => {
    await expect(
      store().saveAddress({ address: "", label: "Friend", networkId: "SN_MAIN" } as never),
    ).rejects.toThrow("Invalid address book entry");
  });

  test("setRpcOverride rejects an unknown network", async () => {
    await expect(
      store().setRpcOverride({ networkId: "SN_FAKE" as never, rpcUrl: "https://rpc.example" }),
    ).rejects.toThrow("Invalid Starknet network");
  });

  test("setActiveNetwork rejects an unknown network", async () => {
    await expect(store().setActiveNetwork("SN_FAKE" as never)).rejects.toThrow(
      "Invalid Starknet network",
    );
  });

  test("setTokenHidden rejects a malformed token id", async () => {
    await expect(store().setTokenHidden({ hidden: true, tokenId: "" })).rejects.toThrow(
      "Invalid token",
    );
  });

  test("upsertToken rejects a malformed token", async () => {
    await expect(store().upsertToken({} as never)).rejects.toThrow("Invalid token");
  });
});
