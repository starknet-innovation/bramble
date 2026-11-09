/**
 * Shadow-account scopes are recorded in the encrypted vault before an approved
 * request acts through them (#443, PR 5): when a commitment is shared (a site
 * can fund the precomputed address before deployment), and when a proof or an
 * invoke acts through the shadow account, with the exact nonces. A request
 * whose record cannot be written does not run, because an unrecorded shadow
 * account is one the wallet cannot find again to sweep.
 */
import { describe, expect, test } from "bun:test";
import { type Strk20Service, unavailableStrk20Service } from "@bramble/privacy/service";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { memoryActivityLog } from "@bramble/transactions/activity";
import { memoryAllowanceStore } from "@bramble/transactions/allowance-store";
import type { ShadowAccountScopeRef } from "@bramble/vault/shadow-account-scopes";
import { canonicalFelt, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import {
  executeStrk20DisclosureApproval,
  executeStrk20InvokeApproval,
} from "../../../apps/extension/src/background/privacy/strk20-approval-execution";
import { unavailablePreferencesStore } from "../../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { account, createWallet, vaultPassphrase } from "../../support/background-wallet-stub";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";
import {
  STRK20_CALL_AND_PROOF,
  STRK20_RECIPIENT,
  STRK20_TOKEN,
} from "../../support/strk20-background";

const ANONYMIZER = STRK20_RECIPIENT;
const ORIGIN = "https://example.com";
const preferences = {
  ...defaultWalletPreferences(),
  activeNetworkId: account.networkId,
  strk20Networks: {
    [account.networkId]: {
      discoveryUrl: "https://discovery.example",
      poolAddress: STRK20_TOKEN,
      proverUrl: "https://prover.example",
      shadowAccountAnonymizerAddress: ANONYMIZER,
    },
  },
};

const invoke = (label: string, nonce: string): Strk20Action => ({
  calls: [{ calldata: ["0x1"], contract_address: STRK20_TOKEN, entry_point: "transfer" }],
  collect_policy: { type: "all" },
  dapp_name: label,
  nonce,
  type: "shadow_account_invoke",
});

const plan = {
  feeAction: {
    amount: "0x1",
    recipient: STRK20_RECIPIENT,
    token: STRK20_TOKEN,
    type: "withdraw" as const,
  },
};

type Seen = { prepared: number; submitted: number; commitments: number };

const harness = (options: { readonly recordFails?: boolean } = {}) => {
  const seen: Seen = { commitments: 0, prepared: 0, submitted: 0 };
  // Each SDK step snapshots the records so far: recording must come first.
  const recordsAtStep: (readonly ShadowAccountScopeRef[])[] = [];
  const scopes: { value: readonly ShadowAccountScopeRef[] } = { value: [] };
  const service: Strk20Service = {
    ...unavailableStrk20Service,
    async prepare() {
      seen.prepared += 1;
      recordsAtStep.push(scopes.value);
      return STRK20_CALL_AND_PROOF;
    },
    async privateBalances({ tokens }) {
      return tokens.map((token) => ({ balance: "0x64", token }));
    },
    async shadowAccountCommitment() {
      seen.commitments += 1;
      recordsAtStep.push(scopes.value);
      return "0x123";
    },
    async submitActions() {
      seen.submitted += 1;
      recordsAtStep.push(scopes.value);
      return { transactionHash: "0x123" };
    },
  };
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const wallet = createWallet({ shadowAccountScopes: scopes });
  const deps = {
    activity: memoryActivityLog(),
    allowanceStore: memoryAllowanceStore(),
    preferencesStore: {
      ...unavailablePreferencesStore,
      async read() {
        return preferences;
      },
    },
    runtimeRpc: makeRuntimeRpc({ strk20: service }),
    session,
    wallet: {
      ...wallet,
      async getGrantedAccounts() {
        return [account];
      },
      ...(options.recordFails
        ? {
            async recordShadowAccountScope() {
              throw new Error("vault write failed");
            },
          }
        : {}),
    },
  };
  return { deps, recordsAtStep, scopes, seen };
};

const record = (label: string, nonces: readonly string[]): ShadowAccountScopeRef => ({
  accountId: account.id,
  // Stored canonical: no leading zeros.
  anonymizer: canonicalFelt(ANONYMIZER) ?? "",
  chainId: STARKNET_NETWORKS[account.networkId].chainId,
  label,
  nonces,
  origin: ORIGIN,
  poolAddress: canonicalFelt(STRK20_TOKEN) ?? "",
});

describe("shadow account scope recording", () => {
  test("records the scope when a commitment is shared, before deriving it", async () => {
    const { deps, recordsAtStep, scopes } = harness();
    await executeStrk20DisclosureApproval(deps, {
      origin: ORIGIN,
      request: { anonymizer: ANONYMIZER, dappName: "Market", type: "shadowAccount" },
    });
    await executeStrk20DisclosureApproval(deps, {
      origin: ORIGIN,
      request: { anonymizer: ANONYMIZER, dappName: "Market", nonce: "0x3", type: "shadowAccount" },
    });
    expect(scopes.value).toEqual([record("Market", ["0x3"])]);
    expect(recordsAtStep[0]).toEqual([record("Market", [])]);
  });

  test("records exact nonces per label before an invoke is submitted", async () => {
    const { deps, recordsAtStep, scopes } = harness();
    await expect(
      executeStrk20InvokeApproval(deps, {
        actions: [invoke("Market", "0x7")],
        origin: ORIGIN,
        plan,
        shadowAccountAnonymizer: ANONYMIZER,
      }),
    ).resolves.toEqual({ ok: true, transactionHash: "0x123" });
    await executeStrk20InvokeApproval(deps, {
      actions: [invoke("Market", "0x2")],
      origin: ORIGIN,
      plan,
      shadowAccountAnonymizer: ANONYMIZER,
    });
    expect(recordsAtStep[0]).toEqual([record("Market", ["0x7"])]);
    expect(scopes.value).toEqual([record("Market", ["0x2", "0x7"])]);
  });

  test("records a submittable proof's scope, but not a simulation's", async () => {
    const { deps, scopes, seen } = harness();
    for (const simulate of [true, false]) {
      await executeStrk20DisclosureApproval(deps, {
        origin: ORIGIN,
        request: {
          actions: [invoke("Proof", simulate ? "0x1" : "0x2")],
          anonymizer: ANONYMIZER,
          simulate,
          type: "prepare",
        },
      });
    }
    expect(seen.prepared).toBe(2);
    expect(scopes.value).toEqual([record("Proof", ["0x2"])]);
  });

  test("a request whose record cannot be written does not run", async () => {
    const { deps, seen } = harness({ recordFails: true });
    const invoked = await executeStrk20InvokeApproval(deps, {
      actions: [invoke("Market", "0x7")],
      origin: ORIGIN,
      plan,
      shadowAccountAnonymizer: ANONYMIZER,
    });
    const shared = await executeStrk20DisclosureApproval(deps, {
      origin: ORIGIN,
      request: { anonymizer: ANONYMIZER, dappName: "Market", type: "shadowAccount" },
    });
    expect(invoked).toHaveProperty("error");
    expect(shared).toHaveProperty("error");
    expect(seen).toEqual({ commitments: 0, prepared: 0, submitted: 0 });
  });

  test("a wallet that cannot record at all refuses rather than running unrecorded", async () => {
    const { deps, seen } = harness();
    const { recordShadowAccountScope: _absent, ...withoutRecords } = deps.wallet;
    await expect(
      executeStrk20InvokeApproval(
        { ...deps, wallet: withoutRecords },
        {
          actions: [invoke("M", "0x1")],
          origin: ORIGIN,
          plan,
          shadowAccountAnonymizer: ANONYMIZER,
        },
      ),
    ).resolves.toEqual({ error: "shadow account records unavailable" });
    expect(seen.submitted).toBe(0);
  });

  test("a batch without a shadow invoke records nothing", async () => {
    const { deps, scopes } = harness();
    await executeStrk20InvokeApproval(deps, {
      actions: [
        { amount: "0x1", recipient: STRK20_RECIPIENT, token: STRK20_TOKEN, type: "withdraw" },
      ],
      origin: ORIGIN,
      plan,
    });
    expect(scopes.value).toEqual([]);
  });
});
