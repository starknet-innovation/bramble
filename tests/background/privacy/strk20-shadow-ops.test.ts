/**
 * Shadow accounts view messages (#443, PR 5): strict inputs, a scope recorded
 * under another anonymizer listed but not reachable, and nonces the
 * anonymizer's u64 view cannot address reported rather than dropped.
 */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import type { ShadowAccountScopeRef } from "@bramble/vault/shadow-account-scopes";
import { canonicalFelt, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { unavailablePreferencesStore } from "../../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  account,
  createWallet,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";
import {
  makeStrk20Service,
  STRK20_EXTENSION_SENDER as panel,
  STRK20_TEST_ANONYMIZER,
} from "../../support/strk20-background";

const defaults = defaultWalletPreferences();
const mainnet = defaults.strk20Networks?.SN_MAIN;
if (!mainnet) throw new Error("missing bundled Mainnet STRK20 config");
const preferences = {
  ...defaults,
  activeNetworkId: "SN_SEPOLIA" as const,
  strk20Networks: {
    ...defaults.strk20Networks,
    SN_SEPOLIA: { ...mainnet, shadowAccountAnonymizerAddress: STRK20_TEST_ANONYMIZER },
  },
};

const scope = (overrides: Partial<ShadowAccountScopeRef>): ShadowAccountScopeRef => ({
  accountId: account.id,
  anonymizer: canonicalFelt(STRK20_TEST_ANONYMIZER) ?? "",
  chainId: STARKNET_NETWORKS.SN_SEPOLIA.chainId,
  label: "Market",
  nonces: ["0x1"],
  origin: "https://example.com",
  poolAddress: canonicalFelt(mainnet.poolAddress) ?? "",
  ...overrides,
});

const handlerWith = (
  scopes: readonly ShadowAccountScopeRef[],
  store: { value: readonly ShadowAccountScopeRef[] } = { value: scopes },
) => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  return createMessageHandler(
    {
      ...createWallet({ shadowAccountScopes: store }),
      async deriveStrk20ViewingKey() {
        return "0x55";
      },
    },
    testExtension,
    {
      preferencesStore: {
        ...unavailablePreferencesStore,
        async read() {
          return preferences;
        },
      },
      runtimeRpc: makeRuntimeRpc({
        async getTokenBalances({ tokens }) {
          return tokens.map((token) => ({ ...token, balance: "5", formatted: "" }));
        },
        strk20: makeStrk20Service(),
      }),
      session,
    },
  );
};

describe("shadow accounts view messages", () => {
  test("a scope under another anonymizer is listed but not reachable", async () => {
    const handler = handlerWith([scope({ anonymizer: "0x99" })]);
    expect(await handler({ type: "wallet.strk20ShadowAccounts" }, panel)).toMatchObject({
      strk20ShadowAccounts: { scopes: [{ anonymizer: "0x99", current: false }] },
    });
    for (const message of [
      {
        label: "Market",
        origin: "https://example.com",
        type: "wallet.strk20ShadowAccountBalances",
      },
      {
        label: "Market",
        nonce: "0x1",
        origin: "https://example.com",
        type: "wallet.strk20PrepareShadowSweep",
      },
    ]) {
      expect(await handler(message, panel)).toEqual({ error: "shadow account anonymizer changed" });
    }
  });

  test("a recorded nonce outside the view's range is reported as unlisted", async () => {
    const huge = `0x1${"0".repeat(16)}`;
    const handler = handlerWith([scope({ nonces: ["0x1", huge] })]);
    const response = (await handler(
      {
        label: "Market",
        origin: "https://example.com",
        type: "wallet.strk20ShadowAccountBalances",
      },
      panel,
    )) as {
      strk20ShadowAccountBalances: {
        accounts: readonly { nonce: string }[];
        unlisted: readonly string[];
      };
    };
    expect(response.strk20ShadowAccountBalances.unlisted).toEqual([huge]);
    expect(response.strk20ShadowAccountBalances.accounts.map((entry) => entry.nonce)).not.toContain(
      huge,
    );
  });

  test("malformed requests are refused before any read", async () => {
    const handler = handlerWith([scope({})]);
    for (const message of [
      { type: "wallet.strk20ShadowAccounts", extra: 1 },
      { label: "Market", origin: "http://example.com", type: "wallet.strk20ShadowAccountBalances" },
      { label: "", origin: "https://example.com", type: "wallet.strk20ShadowAccountBalances" },
      {
        label: "Market",
        nonce: "1",
        origin: "https://example.com",
        type: "wallet.strk20PrepareShadowSweep",
      },
      { label: "Market", origin: "https://example.com", type: "wallet.strk20PrepareShadowSweep" },
    ]) {
      expect(await handler(message, panel)).toEqual({
        error: expect.stringMatching(/^Invalid shadow account/),
      });
    }
  });

  test("a locked wallet lists nothing", async () => {
    const handler = handlerWith([scope({})]);
    await handler({ type: "wallet.lock" }, panel);
    expect(await handler({ type: "wallet.strk20ShadowAccounts" }, panel)).toHaveProperty("error");
  });

  test("a sweep of a scan-window nonce records that nonce before the review returns", async () => {
    const store = { value: [scope({ nonces: ["0x1"] })] as readonly ShadowAccountScopeRef[] };
    const handler = handlerWith(store.value, store);
    const prepared = await handler(
      {
        label: "Market",
        nonce: "0x2",
        origin: "https://example.com",
        type: "wallet.strk20PrepareShadowSweep",
      },
      panel,
    );
    expect(prepared).toMatchObject({ ok: true, strk20Preparation: { kind: "shadow-sweep" } });
    expect(store.value[0]?.nonces).toEqual(["0x1", "0x2"]);
  });
});
