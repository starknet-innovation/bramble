/**
 * A site names the network it asks the wallet to add, and the approval card and
 * the stored record show that name (Sherlock 130). The name and id must be
 * printable ASCII and must not copy a built-in network's name, so an
 * attacker's RPC cannot be added as "Starknet Mainnet". The stored-network
 * rule is unchanged, so records saved before this check still load.
 */
import { describe, expect, test } from "bun:test";
import { isPrintableName, isTokenName } from "@bramble/core/json";
import { isCustomNetwork } from "@bramble/wallet-model/custom-network";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { isProviderChain, readProviderChain } from "@bramble/wallet-protocol/add-chain";

const base = { chain_id: "0x534e5f4b4154414e41", chain_name: "Katana", id: "katana" };
const camel = { chainId: base.chain_id, chainName: "Katana", id: "katana" };

describe("site-chosen network names", () => {
  test("refuses every built-in network's name, whatever its case or spacing", () => {
    for (const network of Object.values(STARKNET_NETWORKS)) {
      for (const name of [
        network.name,
        network.name.toUpperCase(),
        `  ${network.name.replace(" ", "   ")} `,
      ]) {
        expect(readProviderChain({ ...base, chain_name: name })).toBeNull();
        expect(readProviderChain({ ...base, id: name })).toBeNull();
        expect(isProviderChain({ ...camel, chainName: name })).toBe(false);
      }
    }
  });

  test("refuses control, bidi-override, homoglyph and markup characters", () => {
    for (const name of [
      `Kat${String.fromCharCode(0)}ana`,
      `Kat${String.fromCharCode(0x202e)}ana`,
      "Starknet Mаinnet",
      "<b>Katana</b>",
    ]) {
      expect(readProviderChain({ ...base, chain_name: name })).toBeNull();
      expect(isProviderChain({ ...camel, chainName: name })).toBe(false);
    }
  });

  test("still accepts an ordinary custom name, and stored records keep loading", () => {
    expect(readProviderChain(base)?.chainName).toBe("Katana");
    expect(readProviderChain({ ...base, chain_name: "Starknet Mainnet Fork" })?.chainName).toBe(
      "Starknet Mainnet Fork",
    );
    expect(isProviderChain(camel)).toBe(true);
    expect(
      isCustomNetwork({
        chainId: base.chain_id,
        id: "Starknet Mainnet",
        name: "Starknet Mainnet",
        rpcUrls: ["https://rpc.katana.example"],
      }),
    ).toBe(true);
  });

  test("the token name rule is the shared character rule plus its length bound", () => {
    expect(isPrintableName("USD Coin")).toBe(true);
    expect(isTokenName("x".repeat(64))).toBe(true);
    expect(isTokenName("x".repeat(65))).toBe(false);
    expect(isPrintableName("x".repeat(65))).toBe(true);
    expect(isPrintableName("")).toBe(false);
  });
});

describe("site-sent chain endpoints", () => {
  // Only the canonical spelling is accepted (`isServiceUrl`), so the redactor
  // removes a stored endpoint whole and the store never refuses a chain the
  // site was told it could add.
  test("refuses an endpoint in any spelling the URL parser would rewrite", () => {
    for (const url of [
      ...[" ", String.fromCharCode(0xa0), String.fromCharCode(0x3000), '"', "<", "`"].map(
        (brk) => `https://rpc.example/key${brk}secret`,
      ),
      "https://rpc.example/key?k=a`b",
      "https:\\\\rpc.example\\key",
      "https:rpc.example/key",
      "https://rpc.example/k\tey",
      "HTTPS://RPC.example/key",
      "https://rpc.example:443/key",
    ]) {
      expect(readProviderChain({ ...base, rpc_urls: [url] })).toBeNull();
      expect(readProviderChain({ ...base, block_explorer_url: [url] })).toBeNull();
    }
    for (const url of ["https://rpc.example/key", "https://rpc.example", "https://rpc.example/"]) {
      expect(readProviderChain({ ...base, rpc_urls: [url] })).not.toBeNull();
    }
  });
});
