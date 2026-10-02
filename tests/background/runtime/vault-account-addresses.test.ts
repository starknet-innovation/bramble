/**
 * The address-poisoning trust set reads the user's own vault accounts inside
 * the runtime-state boundary module (audit #163 review): only public
 * `address`/`networkId` pairs leave it, the passive read never renews the
 * unlock, and a locked wallet or failed decrypt contributes nothing.
 */
import { describe, expect, test } from "bun:test";
import type { Vault } from "@bramble/vault/schema";
import {
  observedVaultAccountAddresses,
  vaultAccountAddresses,
} from "../../../apps/extension/src/background/runtime/runtime-state";

const vault = {
  accounts: [
    {
      address: "0xabc",
      classHash: "0xdef",
      id: "SN_SEPOLIA:0xabc",
      networkId: "SN_SEPOLIA",
      publicKeyX: "0x1",
    },
  ],
} as unknown as Vault;

const reader = (seen: string[]) => ({
  readVault: async (credential: string): Promise<Vault> => {
    seen.push(credential);
    return vault;
  },
});

describe("vault account addresses for the poisoning trust set", () => {
  test("returns only the public address and network of each vault account", async () => {
    const seen: string[] = [];
    expect(await vaultAccountAddresses(reader(seen), "held")).toEqual([
      { address: "0xabc", networkId: "SN_SEPOLIA" },
    ]);
    expect(seen).toEqual(["held"]);
  });

  test("a failed vault read yields no accounts instead of throwing", async () => {
    const failing = { readVault: async (): Promise<Vault> => Promise.reject(new Error("bad")) };
    expect(await vaultAccountAddresses(failing, "held")).toEqual([]);
  });

  test("the observed read peeks the session and stays empty while locked", async () => {
    const seen: string[] = [];
    expect(
      await observedVaultAccountAddresses(reader(seen), { peekPassphrase: () => null }),
    ).toEqual([]);
    expect(seen).toEqual([]);
    expect(
      await observedVaultAccountAddresses(reader(seen), { peekPassphrase: () => "peeked" }),
    ).toEqual([{ address: "0xabc", networkId: "SN_SEPOLIA" }]);
    expect(seen).toEqual(["peeked"]);
  });
});
