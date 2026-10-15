/**
 * Shadow accounts view messages (#443, PR 5): strict inputs, a scope recorded
 * under another anonymizer listed but not reachable, and nonces the
 * anonymizer's u64 view cannot address reported rather than dropped, and a
 * sweep that refuses at execution when the anonymizer moved after review.
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
  awaitStrk20Job,
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
  strk20 = makeStrk20Service(),
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
        strk20,
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

  // Audit F3: after the anonymizer changes, one site and label can have a
  // record under the old anonymizer (A) and one under the configured one (B).
  // Record order must not decide which one is read, swept, or recorded into.
  test("a record under the old anonymizer does not hide the configured one", async () => {
    const old = scope({ anonymizer: "0x99", nonces: ["0x1"] });
    const current = scope({ nonces: ["0x1"] });
    for (const order of [
      [old, current],
      [current, old],
    ]) {
      const store = { value: order as readonly ShadowAccountScopeRef[] };
      const handler = handlerWith(store.value, store);
      const balances = await handler(
        {
          label: "Market",
          origin: "https://example.com",
          type: "wallet.strk20ShadowAccountBalances",
        },
        panel,
      );
      expect(balances).toMatchObject({ ok: true });
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
      // The scan-window nonce is recorded into B's record, never A's.
      const byAnonymizer = (anonymizer: string) =>
        store.value.find((record) => record.anonymizer === anonymizer)?.nonces;
      expect(byAnonymizer("0x99")).toEqual(["0x1"]);
      expect(byAnonymizer(current.anonymizer)).toEqual(["0x1", "0x2"]);
      expect(store.value).toHaveLength(2);
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

  // Audit F4: a site can record nonce 2^64 − 1 through its commitment request.
  // No view window can include it (end_nonce would be 2^64), so it is reported
  // as unlisted and the scope's other nonces still list.
  test("nonce 2^64 − 1 is unlisted and does not block the scope's other nonces", async () => {
    const max = `0x${"f".repeat(16)}`;
    const asked: bigint[][] = [];
    const store = { value: [scope({ nonces: ["0x1", max] })] as readonly ShadowAccountScopeRef[] };
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const base = makeStrk20Service();
    const handler = createMessageHandler(
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
          strk20: {
            ...base,
            async shadowAccounts(input) {
              asked.push([...input.nonces]);
              if (input.nonces.some((nonce) => nonce >= (1n << 64n) - 1n)) {
                throw new Error("could not list shadow accounts (u64 overflow)");
              }
              return base.shadowAccounts?.(input) ?? [];
            },
          },
        }),
        session,
      },
    );
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
    expect(response.strk20ShadowAccountBalances.unlisted).toEqual([max]);
    expect(response.strk20ShadowAccountBalances.accounts.map((entry) => entry.nonce)).toContain(
      "0x1",
    );
    expect(asked.flat()).not.toContain((1n << 64n) - 1n);
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

  // Audit F10: the sweep is reviewed against one anonymizer. If the network's
  // anonymizer changes between review and Confirm, execution refuses before
  // anything is relayed; the reviewed batch would otherwise run through an
  // anonymizer the review never named.
  test("a sweep refuses at execution if the anonymizer changed after review", async () => {
    const store = { value: [scope({ nonces: ["0x1"] })] as readonly ShadowAccountScopeRef[] };
    let current = preferences;
    const submitted: unknown[] = [];
    const base = makeStrk20Service();
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(
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
            return current;
          },
        },
        runtimeRpc: makeRuntimeRpc({
          async getTokenBalances({ tokens }) {
            return tokens.map((token) => ({ ...token, balance: "5", formatted: "" }));
          },
          strk20: {
            ...base,
            async submitActions(input) {
              submitted.push(input.actions);
              return base.submitActions(input);
            },
          },
        }),
        session,
      },
    );
    const prepared = (await handler(
      {
        label: "Market",
        nonce: "0x1",
        origin: "https://example.com",
        type: "wallet.strk20PrepareShadowSweep",
      },
      panel,
    )) as { strk20Preparation: { id: string } };
    expect(prepared.strk20Preparation.id).toBeString();
    current = {
      ...preferences,
      strk20Networks: {
        ...preferences.strk20Networks,
        SN_SEPOLIA: { ...mainnet, shadowAccountAnonymizerAddress: "0x99" },
      },
    };
    const executed = await awaitStrk20Job(
      handler,
      await handler(
        { preparationId: prepared.strk20Preparation.id, type: "wallet.strk20Execute" },
        panel,
      ),
      panel,
    );
    expect(executed).toEqual({ error: "Privacy preparation changed" });
    expect(submitted).toEqual([]);
  });

  // Audit F11: the relay fee comes from the private balance in the fee token.
  // Without enough of it the Sweep tap is refused with the existing
  // "insufficient private balance" code (panel copy "Insufficient private
  // balance"), before any review or Confirm exists.
  test("a sweep without the private fee balance is refused before any review", async () => {
    const store = { value: [scope({ nonces: ["0x1"] })] as readonly ShadowAccountScopeRef[] };
    const handler = handlerWith(store.value, store, makeStrk20Service({ balance: "0x0" }));
    expect(
      await handler(
        {
          label: "Market",
          nonce: "0x1",
          origin: "https://example.com",
          type: "wallet.strk20PrepareShadowSweep",
        },
        panel,
      ),
    ).toEqual({ error: "insufficient private balance" });
  });
});
