/**
 * The shadow-account record bound is checked before the user is asked (audit
 * F9). A request the vault would refuse to record — a new scope past
 * MAX_SHADOW_ACCOUNT_SCOPES, or a new nonce past MAX_SHADOW_ACCOUNT_NONCES —
 * never reaches a card. It is held on the close-only notice instead, so the
 * site learns nothing until the user sees it: Close gives the same answer the
 * record would after approval, and expiry gives 113 like any approval. A request that records nothing (a
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
import {
  APPROVAL_TTL_MS,
  createApprovalQueue,
} from "../../../apps/extension/src/background/approvals/approvals";
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
  const clock = { now: 1_700_000_000_000 };
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
      approvals: createApprovalQueue({ now: () => clock.now }),
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
  return { clock, handler, pending, scopes };
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
  // Owner rule: a site never learns the user's shadow-account setup without
  // the user seeing something. A full record table is held on the close-only
  // notice like a missing anonymizer: the site gets the refusal on Close, and
  // on expiry the same 113 any expired approval gives.
  const heldOnNotice = async (h: ReturnType<typeof harness>, message: object) => {
    let settled: unknown = "unsettled";
    const held = h.handler(message, dapp).then((result) => {
      settled = result;
      return result;
    });
    const [notice] = await waitForPendingApprovals<{
      readonly id: string;
      readonly kind: string;
      readonly notice?: string;
      readonly summaries?: readonly string[];
    }>(h.handler, panel);
    expect(notice).toMatchObject({ kind: "strk20-unavailable", notice: "record-limit" });
    expect(notice?.summaries).toBeUndefined();
    await flushHeld();
    expect(settled).toBe("unsettled");
    return { held, id: notice?.id ?? "" };
  };

  test("a new scope past the bound is held until Close, never evicting", async () => {
    for (const message of requests("New site", "0x1")) {
      const h = harness(fullTable());
      const before = h.scopes.value;
      const { held, id } = await heldOnNotice(h, message);
      await h.handler({ id, type: "wallet.denyOrigin" }, panel);
      expect(await held).toEqual(LIMIT);
      expect(await h.pending()).toBe(0);
      expect(h.scopes.value).toBe(before);
    }
  });

  test("a new nonce past the per-scope bound is held, and expires as 113", async () => {
    const nonces = Array.from(
      { length: MAX_SHADOW_ACCOUNT_NONCES },
      (_, i) => `0x${i.toString(16)}`,
    );
    for (const message of requests("Market", "0x3e8")) {
      const h = harness([scope("Market", nonces)]);
      const { held } = await heldOnNotice(h, message);
      h.clock.now += APPROVAL_TTL_MS + 1;
      expect(await h.pending()).toBe(0);
      expect(await held).toEqual({ error: "request rejected" });
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
