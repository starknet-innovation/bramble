import type { RpcProvider } from "starknet";
import { describe, expect, it, vi } from "vitest";
import { VESU_CURATED_VAULTS } from "../constants";
import {
  curatedVesuVault,
  VESU_VAULT_CLASS_CHANGED,
  VESU_VAULT_NOT_CURATED,
  VESU_VAULT_UNVERIFIED,
  verifyCuratedVesuVault,
} from "./vesu-vaults";

const VAULT_CLASS = "0x225ca31b59b9f0e72dbbe72696aae6cf3431c68a2b993e9ecc10a62dd91ea04";
const UNLISTED = "0x0716cf8be5e3d6b28c76e8afbe60b7d5824a913967444fe1d4962615e585a155";

const reader = (getClassHashAt: (address: string) => Promise<unknown>) => {
  const provider = { getClassHashAt: vi.fn(getClassHashAt) };
  const readWith = <T,>(run: (p: RpcProvider) => Promise<T>): Promise<T> =>
    run(provider as unknown as RpcProvider);
  return { provider, readWith };
};

describe("curated Vesu vault allowlist (#270)", () => {
  it("pins exactly the two verified Noon vaults, their class and asset", () => {
    expect(VESU_CURATED_VAULTS.map(({ address, assetAddress, classHash, symbol }) => [symbol, address, assetAddress, BigInt(classHash)])).toEqual([
      [
        "nWBTC",
        "0x023ccbaf0f70e8dcb29520ab4ea12e2e916fb71204677321e91e525062279e35",
        "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac",
        BigInt(VAULT_CLASS),
      ],
      [
        "ntBTC",
        "0x04424dec8280f518b35be33139f44ef9fa0855b117f16cda2a30f1b64c27864a",
        "0x04daa17763b286d1e59b97c283c0b8c949994c361e426a28f743c67bdfe9a32f",
        BigInt(VAULT_CLASS),
      ],
    ]);
  });

  it("refuses an address outside the allowlist", () => {
    expect(() => curatedVesuVault(UNLISTED)).toThrow(VESU_VAULT_NOT_CURATED);
  });

  it.each(VESU_CURATED_VAULTS)("passes $symbol when it runs its pinned class", async (vault) => {
    const { provider, readWith } = reader(async () => VAULT_CLASS);
    await expect(verifyCuratedVesuVault(vault.address, readWith)).resolves.toBeUndefined();
    expect(provider.getClassHashAt).toHaveBeenCalledWith(vault.address);
  });

  it("refuses a curated vault running a different class", async () => {
    const { readWith } = reader(async () => "0x1234");
    await expect(verifyCuratedVesuVault(VESU_CURATED_VAULTS[0]?.address ?? "", readWith)).rejects.toThrow(
      VESU_VAULT_CLASS_CHANGED,
    );
  });

  it.each([
    ["a failed read", () => Promise.reject(new Error("rpc down"))],
    ["a malformed answer", async () => "not-a-felt"],
    ["no answer", async () => undefined],
  ])("fails closed on %s", async (_name, read) => {
    const { readWith } = reader(read);
    await expect(verifyCuratedVesuVault(VESU_CURATED_VAULTS[1]?.address ?? "", readWith)).rejects.toThrow(
      VESU_VAULT_UNVERIFIED,
    );
  });

  it("refuses an unlisted vault before any read", async () => {
    const { provider, readWith } = reader(async () => VAULT_CLASS);
    await expect(verifyCuratedVesuVault(UNLISTED, readWith)).rejects.toThrow(VESU_VAULT_NOT_CURATED);
    expect(provider.getClassHashAt).not.toHaveBeenCalled();
  });
});
