import { describe, expect, test, vi } from "vitest";
import { resolveAccount } from "./wallet-connection";
import type { StarknetWindowObject } from "./starknet-window";

const makeInjected = (
  overrides: Partial<StarknetWindowObject> = {},
): StarknetWindowObject => ({
  id: "bramble",
  off: vi.fn(),
  on: vi.fn(),
  request: vi.fn(async ({ type }: { readonly type: string }) => {
    if (type === "wallet_requestAccounts") {
      return ["0x1234"];
    }
    return null;
  }),
  ...overrides,
});

describe("resolveAccount", () => {
  test("returns an already-attached account without opening WalletAccountV6", async () => {
    const account = { execute: vi.fn() };
    const wallet = makeInjected({ account });
    await expect(resolveAccount(wallet, "SN_MAIN")).resolves.toBe(account);
    expect(wallet.request).not.toHaveBeenCalled();
  });

  test("connects through WalletAccountV6 when the injected wallet has no account", async () => {
    const wallet = makeInjected();
    const account = await resolveAccount(wallet, "SN_MAIN");
    expect(account).not.toBeNull();
    expect(account?.address).toBe("0x1234");
    expect(wallet.request).toHaveBeenCalledWith({ type: "wallet_requestAccounts" });
  });

  test("returns null when the injected wallet cannot speak the request API", async () => {
    const wallet = makeInjected({ request: undefined });
    await expect(resolveAccount(wallet, "SN_MAIN")).resolves.toBeNull();
  });
});
