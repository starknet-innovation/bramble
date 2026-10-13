/**
 * The shadow-account record bound is checked before the user is asked (audit
 * F9). A request the vault would refuse to record — a new scope past
 * MAX_SHADOW_ACCOUNT_SCOPES, or a new nonce past MAX_SHADOW_ACCOUNT_NONCES — is
 * refused before any card is queued, with the same answer the site would get
 * from the record after approval. A request that records nothing (a
 * simulation) or that only merges into an existing scope still reaches the
 * user. The record after approval still re-checks and fails closed.
 */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import {
  canonicalShadowAccountScope,
  MAX_SHADOW_ACCOUNT_NONCES,
  MAX_SHADOW_ACCOUNT_SCOPES,
  type ShadowAccountScopeRef,
} from "@bramble/vault/shadow-account-scopes";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { unavailablePreferencesStore } from "../../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  account,
  createWallet,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";
import { flushHeld, waitForPendingApprovals } from "../../support/held";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";
import {
  STRK20_CONTENT_SENDER as dapp,
  makeStrk20Service,
  STRK20_ORIGIN as ORIGIN,
  STRK20_EXTENSION_SENDER as panel,
  STRK20_RECIPIENT,
  STRK20_TEST_ANONYMIZER,
} from "../../support/strk20-background";

const LIMIT = { error: "shadow account record limit reached" };
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

const scope = (label: string, nonces: readonly string[]): ShadowAccountScopeRef => {
  const canonical = canonicalShadowAccountScope({
    accountId: account.id,
    anonymizer: STRK20_TEST_ANONYMIZER,
    chainId: STARKNET_NETWORKS.SN_SEPOLIA.chainId,
    label,
    nonces,
    origin: ORIGIN,
    poolAddress: mainnet.poolAddress,
  });
  if (!canonical) throw new Error("bad test scope");
  return canonical;
};

// A full table: the bound's worth of scopes, the first one named "Market".
const fullTable = (): readonly ShadowAccountScopeRef[] =>
  Array.from({ length: MAX_SHADOW_ACCOUNT_SCOPES }, (_, index) =>
    scope(index === 0 ? "Market" : `Site ${index}`, ["0x1"]),
  );

const harness = (seed: readonly ShadowAccountScopeRef[]) => {
  const scopes = { value: seed };
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const handler = createMessageHandler(
    {
      ...createWallet({ shadowAccountScopes: scopes }),
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
      runtimeRpc: makeRuntimeRpc({ strk20: makeStrk20Service() }),
      session,
    },
  );
  const pending = async (): Promise<number> => {
    await flushHeld();
    const response = (await handler({ type: "wallet.pendingApprovals" }, panel)) as {
      readonly pending: readonly unknown[];
    };
    return response.pending.length;
  };
  return { handler, pending, scopes };
};

const invoke = (label: string, nonce: string) => ({
  calls: [{ calldata: [], contract_address: STRK20_RECIPIENT, entry_point: "swap" }],
  collect_policy: { type: "all" },
  dapp_name: label,
  nonce,
  type: "shadow_account_invoke",
});

const requests = (label: string, nonce: string) => [
  { dappName: label, nonce, origin: ORIGIN, type: "wallet.strk20ShadowAccountCommitment" },
  {
    actions: [invoke(label, nonce)],
    origin: ORIGIN,
    simulate: false,
    type: "wallet.strk20PrepareInvoke",
  },
  { actions: [invoke(label, nonce)], origin: ORIGIN, type: "wallet.strk20InvokeTransaction" },
];

describe("shadow-account record bound before approval", () => {
  test("a new scope past the bound is refused before any card, never evicting", async () => {
    for (const message of requests("New site", "0x1")) {
      const { handler, pending, scopes } = harness(fullTable());
      const before = scopes.value;
      expect(await handler(message, dapp)).toEqual(LIMIT);
      expect(await pending()).toBe(0);
      expect(scopes.value).toBe(before);
    }
  });

  test("a new nonce past the per-scope bound is refused before any card", async () => {
    const nonces = Array.from(
      { length: MAX_SHADOW_ACCOUNT_NONCES },
      (_, i) => `0x${i.toString(16)}`,
    );
    for (const message of requests("Market", "0x3e8")) {
      const { handler, pending } = harness([scope("Market", nonces)]);
      expect(await handler(message, dapp)).toEqual(LIMIT);
      expect(await pending()).toBe(0);
    }
  });

  test("a request that only merges into a recorded scope still reaches the user", async () => {
    for (const message of requests("Market", "0x2")) {
      const { handler } = harness(fullTable());
      void handler(message, dapp);
      expect(await waitForPendingApprovals(handler, panel)).toHaveLength(1);
    }
  });

  test("a simulation records nothing, so a full table does not refuse it", async () => {
    const { handler } = harness(fullTable());
    void handler(
      {
        actions: [invoke("New site", "0x1")],
        origin: ORIGIN,
        simulate: true,
        type: "wallet.strk20PrepareInvoke",
      },
      dapp,
    );
    expect(await waitForPendingApprovals(handler, panel)).toHaveLength(1);
  });
});
