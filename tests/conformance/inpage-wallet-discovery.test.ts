/**
 * Dapp wallet discovery lists `window.starknet_bramble`.
 *
 * starknet-react 5.0.3 (`isWalletObject` in src/connectors/discovery.ts) keeps
 * an injected `starknet*` object only if every key below is `in` it, including
 * `provider`; get-starknet-core 4.0.0 (`isWalletObj`) checks a subset. Bramble
 * once lacked `provider`, so starknet-react listed no Bramble wallet. The key
 * is present but `undefined`: discovery needs only the name, and an object
 * there would be a second request surface beside `request`.
 */
import { describe, expect, test } from "bun:test";

const INPAGE_ENTRY = "src/provider/inpage.ts";

const STARKNET_REACT_5_KEYS = [
  "request",
  "isConnected",
  "provider",
  "enable",
  "isPreauthorized",
  "on",
  "off",
  "version",
  "id",
  "name",
  "icon",
] as const;

const GET_STARKNET_CORE_4_KEYS = ["request", "on", "off", "version", "id", "name", "icon"];

type Wallet = { readonly id?: unknown; readonly provider?: unknown };

const page: { starknet_bramble?: Wallet } & Record<string, unknown> = {
  addEventListener: () => undefined,
  dispatchEvent: () => true,
  location: { origin: "https://dapp.example" },
};

const loadProvider = async (): Promise<Wallet> => {
  const scope = globalThis as { window?: unknown };
  const previous = scope.window;
  scope.window = page;
  try {
    // The query gives this test its own module instance; one cached by
    // another suite would not run again. The computed load is registered in
    // NON_LITERAL_MODULE_LOADS.
    await import(`../../apps/extension/${INPAGE_ENTRY}?discovery`);
  } finally {
    scope.window = previous;
  }
  return page.starknet_bramble as Wallet;
};

/** starknet-react 5.0.3's `scanObjectForWallets`, which also sees non-enumerable keys. */
const scan = (target: Record<string, unknown>, keys: readonly string[]): unknown[] =>
  Object.getOwnPropertyNames(target)
    .filter((name) => name.startsWith("starknet"))
    .map((name) => target[name])
    .filter((wallet) => typeof wallet === "object" && wallet !== null)
    .filter((wallet) => keys.every((key) => key in (wallet as object)));

describe("in-page wallet discovery", () => {
  test("starknet-react 5 and get-starknet-core 4 both list Bramble", async () => {
    const wallet = await loadProvider();
    expect(scan(page, STARKNET_REACT_5_KEYS)).toEqual([wallet]);
    expect(scan(page, GET_STARKNET_CORE_4_KEYS)).toEqual([wallet]);
    expect(wallet.id).toBe("bramble");
  });

  test("provider is a bare key, and the object exposes nothing else new", async () => {
    const wallet = page.starknet_bramble as Wallet;
    expect("provider" in wallet).toBe(true);
    expect(wallet.provider).toBeUndefined();
    expect(Object.isFrozen(wallet)).toBe(true);
    expect(Object.keys(wallet).sort()).toEqual([
      "chainId",
      "enable",
      "icon",
      "id",
      "isConnected",
      "isPreauthorized",
      "name",
      "off",
      "on",
      "provider",
      "request",
      "selectedAddress",
      "version",
    ]);
  });
});
