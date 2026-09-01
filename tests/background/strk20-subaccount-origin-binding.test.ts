/**
 * MCW-V09-118: a STRK20 sub-account is domain-separated by the origin the
 * background verified against the sender, not by the label the calling page
 * picked. Two sites that ask for the same label must never be handed the same
 * commitment — that unlinkability is what the approval card promises the user —
 * while one site keeps a stable identity across sessions and distinct scopes
 * across its own labels.
 *
 * `subaccounts(dappName)` is one identity for both the disclosed commitment and
 * the `subaccount_invoke` that acts through it, so this suite also pins that
 * the action path derives the identical separator. If it did not, a site could
 * be shown a commitment it could never name in an action.
 */
import { describe, expect, test } from "bun:test";
import { type Strk20Service, unavailableStrk20Service } from "@bramble/privacy/service";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { memoryActivityLog } from "@bramble/transactions/activity";
import { memoryAllowanceStore } from "@bramble/transactions/allowance-store";
import { isStrk20DappName, type Strk20Action } from "@bramble/wallet-protocol/strk20";
import {
  executeStrk20DisclosureApproval,
  executeStrk20InvokeApproval,
} from "../../apps/extension/src/background/privacy/strk20-approval-execution";
import { unavailablePreferencesStore } from "../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import { account, createWallet, vaultPassphrase } from "../support/background-wallet-stub";
import { flushHeld, latestApprovalId, waitForPendingApprovals } from "../support/held";
import { makeRuntimeRpc } from "../support/runtime-rpc-stub";
import {
  approveHeldStrk20,
  buildStrk20Handler,
  STRK20_CALL_AND_PROOF,
  STRK20_CONTENT_SENDER,
  STRK20_EXTENSION_SENDER,
  STRK20_ORIGIN,
  STRK20_RECIPIENT,
  STRK20_TOKEN,
} from "../support/strk20-background";

// Pinned separator for (https://example.com, "Example"). The value is a wallet
// identity: silently changing the derivation would strand every sub-account a
// site has already been shown, so it is asserted literally rather than
// recomputed from the implementation. It is 30 hex characters, not a 0x felt,
// because the pinned SDK short-string-encodes every string dapp name and
// starknet.js rejects a short string over 31 bytes — see
// strk20-subaccount-sdk-boundary.test.ts, which drives the real encoder.
const EXAMPLE_COM_SCOPE = "d4b5ddb6229476c950b321c359fdf7";

const preferences = {
  ...defaultWalletPreferences(),
  activeNetworkId: account.networkId,
  strk20Networks: {
    [account.networkId]: {
      discoveryUrl: "https://discovery.example",
      poolAddress: STRK20_TOKEN,
      proverUrl: "https://prover.example",
      subaccountAnonymizerAddress: STRK20_RECIPIENT,
    },
  },
};

// Everything the wallet handed the SDK on the three paths that name a
// sub-account. Recording all three in one place is what makes a disclosure /
// action divergence visible in a single assertion.
type Recorded = {
  readonly commitments: string[];
  readonly prepared: (readonly Strk20Action[])[];
  readonly submitted: (readonly Strk20Action[])[];
};

const recorded = (): Recorded => ({ commitments: [], prepared: [], submitted: [] });

// Fails closed on every SDK operation except the ones under test, and records
// the domain separator the wallet actually handed the SDK.
const recordingService = (seen: Recorded): Strk20Service => ({
  ...unavailableStrk20Service,
  async prepare(input) {
    seen.prepared.push([...input.actions]);
    return STRK20_CALL_AND_PROOF;
  },
  async privateBalances({ tokens }) {
    return tokens.map((token) => ({ balance: "0x64", token }));
  },
  async subaccountCommitment(input) {
    seen.commitments.push(input.dappName);
    return "0x123";
  },
  async submitActions(input) {
    seen.submitted.push([...input.actions]);
    return { transactionHash: "0x123" };
  },
});

// Execute-side dependencies for an already-approved request. The wallet stub
// answers every origin with the same granted account: the guarantee under test
// must hold precisely when two sites are connected to one account.
const executeDeps = (seen: Recorded) => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  return {
    activity: memoryActivityLog(),
    allowanceStore: memoryAllowanceStore(),
    preferencesStore: {
      ...unavailablePreferencesStore,
      async read() {
        return preferences;
      },
    },
    runtimeRpc: makeRuntimeRpc({ strk20: recordingService(seen) }),
    session,
    wallet: {
      ...createWallet(),
      async getGrantedAccounts() {
        return [account];
      },
    },
  };
};

const commitmentFor = async (
  seen: Recorded,
  origin: string,
  dappName: string,
  nonce?: string,
): Promise<unknown> =>
  executeStrk20DisclosureApproval(executeDeps(seen), {
    origin,
    request: { dappName, ...(nonce === undefined ? {} : { nonce }), type: "subaccount" },
  });

type Strk20SubaccountInvoke = Extract<Strk20Action, { readonly type: "subaccount_invoke" }>;

const subaccountAction = (dappName: string): Strk20SubaccountInvoke => ({
  calls: [{ calldata: ["0x1"], contract_address: STRK20_TOKEN, entry_point: "transfer" }],
  collect_policy: { type: "all" },
  dapp_name: dappName,
  nonce: "0x5",
  type: "subaccount_invoke",
});

const deposit: Strk20Action = { amount: "0x2", token: STRK20_TOKEN, type: "deposit" };

describe("STRK20 sub-account origin binding", () => {
  test("gives two origins different separators for one requested label", async () => {
    const seen = recorded();

    await expect(commitmentFor(seen, "https://example.com", "Example")).resolves.toEqual({
      commitment: "0x123",
      ok: true,
    });
    await expect(commitmentFor(seen, "https://evil.example", "Example")).resolves.toEqual({
      commitment: "0x123",
      ok: true,
    });

    expect(seen.commitments).toHaveLength(2);
    expect(seen.commitments[0]).not.toBe(seen.commitments[1]);
    expect(seen.commitments).not.toContain("Example");
  });

  test("pins the separator for a known origin and label", async () => {
    const seen = recorded();

    await commitmentFor(seen, "https://example.com", "Example");
    await commitmentFor(seen, "https://example.com", "Example", "0x1");

    // Stable across sessions, and independent of the per-request nonce the SDK
    // applies on top of the scope.
    expect(seen.commitments).toEqual([EXAMPLE_COM_SCOPE, EXAMPLE_COM_SCOPE]);
    // The separator must remain something the SDK can encode as a dapp name:
    // the wallet's own parser is the same 31-byte printable-ASCII rule.
    expect(isStrk20DappName(EXAMPLE_COM_SCOPE)).toBe(true);
    expect(EXAMPLE_COM_SCOPE.length).toBeLessThanOrEqual(31);
  });

  test("keeps one origin's own labels in separate scopes", async () => {
    const seen = recorded();

    await commitmentFor(seen, "https://example.com", "Example");
    await commitmentFor(seen, "https://example.com", "Other");

    expect(seen.commitments[0]).not.toBe(seen.commitments[1]);
  });

  test("binds the separator through the whole approved message path", async () => {
    const seen = recorded();
    const handler = buildStrk20Handler({ strk20: recordingService(seen) });

    const result = await approveHeldStrk20(
      handler,
      { dappName: "Example", origin: STRK20_ORIGIN, type: "wallet.strk20SubaccountCommitment" },
      "strk20-subaccount",
      () => expect(seen.commitments).toEqual([]),
    );

    expect(result).toEqual({ commitment: "0x123", ok: true });
    expect(seen.commitments).toEqual([EXAMPLE_COM_SCOPE]);
  });

  test("reviews the verified origin, not only the site's label", async () => {
    const seen = recorded();
    const handler = buildStrk20Handler({ strk20: recordingService(seen) });
    const held = handler(
      { dappName: "Trust Me", origin: STRK20_ORIGIN, type: "wallet.strk20SubaccountCommitment" },
      STRK20_CONTENT_SENDER,
    );
    await flushHeld();

    const listed = await waitForPendingApprovals<{
      readonly id: string;
      readonly summaries?: readonly string[];
    }>(handler, STRK20_EXTENSION_SENDER);
    expect(listed.at(-1)?.summaries).toEqual([
      `Share a private sub-account commitment for ${STRK20_ORIGIN}`,
      "Site-chosen scope label Trust Me",
    ]);

    const id = await latestApprovalId(handler, STRK20_EXTENSION_SENDER);
    await handler({ id, type: "wallet.denyOrigin" }, STRK20_EXTENSION_SENDER);
    await held;
    expect(seen.commitments).toEqual([]);
  });

  test("proves a subaccount_invoke through the disclosed sub-account, not the raw label", async () => {
    const seen = recorded();

    await expect(
      executeStrk20DisclosureApproval(executeDeps(seen), {
        origin: "https://example.com",
        request: {
          actions: [deposit, subaccountAction("Example")],
          simulate: true,
          type: "prepare",
        },
      }),
    ).resolves.toEqual({ callAndProof: STRK20_CALL_AND_PROOF, ok: true });

    // Order and every non-sub-account action survive untouched; only the
    // sub-account identity is rebound to the verified origin.
    expect(seen.prepared[0]).toEqual([
      deposit,
      { ...subaccountAction("Example"), dapp_name: EXAMPLE_COM_SCOPE },
    ]);
  });

  test("submits a subaccount_invoke through the same identity the commitment disclosed", async () => {
    const seen = recorded();

    await commitmentFor(seen, "https://example.com", "Example");
    await expect(
      executeStrk20InvokeApproval(executeDeps(seen), {
        actions: [subaccountAction("Example")],
        origin: "https://example.com",
        plan: {
          feeAction: {
            amount: "0x1",
            recipient: STRK20_RECIPIENT,
            token: STRK20_TOKEN,
            type: "withdraw",
          },
        },
      }),
    ).resolves.toEqual({ ok: true, transactionHash: "0x123" });

    const submittedName = seen.submitted[0]?.[0];
    expect(submittedName?.type === "subaccount_invoke" && submittedName.dapp_name).toBe(
      EXAMPLE_COM_SCOPE,
    );
    // The disclosure and the action name one sub-account, so value routed to
    // the disclosed commitment stays reachable.
    expect(seen.commitments[0]).toBe(EXAMPLE_COM_SCOPE);
  });

  test("keeps two origins' subaccount_invoke actions on different sub-accounts", async () => {
    const seen = recorded();

    for (const origin of ["https://example.com", "https://evil.example"]) {
      await executeStrk20InvokeApproval(executeDeps(seen), {
        actions: [subaccountAction("Example")],
        origin,
        plan: {
          feeAction: {
            amount: "0x1",
            recipient: STRK20_RECIPIENT,
            token: STRK20_TOKEN,
            type: "withdraw",
          },
        },
      });
    }

    const names = seen.submitted.map((actions) => JSON.stringify(actions[0]));
    expect(names[0]).not.toBe(names[1]);
  });
});
