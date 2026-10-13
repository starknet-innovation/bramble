/**
 * End-to-end dapp flow for shadow accounts (#443, PRs 2, 4, 5) through the real
 * background router and the pinned rc.8 privacy SDK bundle:
 * commitment → approval → invoke → scope recorded → Shadow accounts view →
 * balances on request → sweep built and relayed.
 *
 * What is real: the router, approval queue, origin binding, scope recording,
 * the vault's record merge, the wallet's shadow-account listing adapter, and
 * the SDK bundle's identity math (`partialCommitment`, `commitment`,
 * `shadowAccountAddress`) and builder. What is doubled: the network. The RPC
 * double answers `get_shadow_accounts` exactly as the Cairo view does, from the
 * SDK's own address derivation, and the relay accepts a batch once the real SDK
 * builder has assembled it. Proving and settlement need a prover and mainnet,
 * which this suite cannot reach.
 */
import { describe, expect, test } from "bun:test";
import { strk20BuilderFor } from "@bramble/privacy/official-sdk-builder";
import {
  createOfficialStrk20Service,
  type PrivacySdkRuntime,
} from "@bramble/privacy/official-sdk-service";
import { transfersFor } from "@bramble/privacy/official-sdk-transfers";
import { SHADOW_INVOKE_CONTROL, SHADOW_INVOKE_SETTLES } from "@bramble/privacy/shadow-account-copy";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { activityToCsv, memoryActivityLog } from "@bramble/transactions/activity";
import type { ShadowAccountScopeRef } from "@bramble/vault/shadow-account-scopes";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import type { RpcProvider } from "starknet";
import { num, shortString } from "starknet";
import { strk20ShadowAccountScope } from "../../../apps/extension/src/background/privacy/strk20-shadow-account";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { unavailablePreferencesStore } from "../../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  account,
  createWallet,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";
import { flushHeld, latestApprovalId, waitForPendingApprovals } from "../../support/held";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";
import {
  awaitStrk20Job,
  STRK20_CONTENT_SENDER as dapp,
  makeStrk20Service,
  STRK20_ORIGIN as ORIGIN,
  STRK20_EXTENSION_SENDER as panel,
} from "../../support/strk20-background";

type SdkBundle = PrivacySdkRuntime & {
  readonly shadowAccountAddress: (commitment: bigint, anonymizer: bigint) => string;
  readonly shadowAccountCommitment: (partial: bigint, nonce: bigint) => bigint;
  readonly shadowAccountPartialCommitment: (
    user: bigint,
    viewingKey: bigint,
    anonymizer: bigint,
    dappName: bigint,
  ) => bigint;
};

// The pinned rc.8 browser bundle the extension ships (built by vendor:privacy).
const sdk = (await import(
  "../../../vendor/starknet-privacy/sdk/dist/browser/starknet-sdk.min.js"
)) as unknown as SdkBundle;

const VIEWING_KEY = "0x55";
const ANONYMIZER = "0x4f33230dc57855c6e7eabe66dfa0fde82c5458fd0e54827cdb7cb4c474888a7";
const LABEL = "Market";
const defaults = defaultWalletPreferences();
const mainnet = defaults.strk20Networks?.SN_MAIN;
if (!mainnet) throw new Error("missing bundled Mainnet STRK20 config");
const preferences = {
  ...defaults,
  activeNetworkId: "SN_SEPOLIA" as const,
  strk20Networks: {
    ...defaults.strk20Networks,
    SN_SEPOLIA: { ...mainnet, shadowAccountAnonymizerAddress: ANONYMIZER },
  },
};
const strk = preferences.tokens.find(
  (token) =>
    token.networkId === "SN_SEPOLIA" && BigInt(token.address) === BigInt(STRK_TOKEN_ADDRESS),
);
if (!strk) throw new Error("missing tracked Sepolia STRK");

// The identity the wallet must derive, computed independently from the SDK's
// standalone exports over the origin-bound separator.
const scopeFelt = async (): Promise<bigint> =>
  BigInt(shortString.encodeShortString(await strk20ShadowAccountScope(ORIGIN, LABEL)));
const partial = async (): Promise<bigint> =>
  sdk.shadowAccountPartialCommitment(
    BigInt(account.address),
    BigInt(VIEWING_KEY),
    BigInt(ANONYMIZER),
    await scopeFelt(),
  );
const addressAt = async (nonce: bigint): Promise<string> =>
  sdk.shadowAccountAddress(sdk.shadowAccountCommitment(await partial(), nonce), BigInt(ANONYMIZER));

const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("the official adapter lost its shadow-account read");
  return value;
};

const harness = () => {
  const scopes: { value: readonly ShadowAccountScopeRef[] } = { value: [] };
  const submitted: (readonly Strk20Action[])[] = [];
  const heldAt = new Map<string, bigint>();
  // The Cairo view's answer, from the SDK's own address derivation.
  const providerFor = (): RpcProvider =>
    ({
      callContract: async (call: { calldata: readonly string[]; entrypoint: string }) => {
        if (call.entrypoint !== "get_shadow_accounts") throw new Error("unexpected call");
        const [partialHex, start, end] = call.calldata.map((value) => BigInt(value));
        const entries: string[] = [];
        for (let nonce = start ?? 0n; nonce < (end ?? 0n); nonce += 1n) {
          const address = sdk.shadowAccountAddress(
            sdk.shadowAccountCommitment(partialHex ?? 0n, nonce),
            BigInt(ANONYMIZER),
          );
          entries.push(num.toHex(nonce), address, "0x0");
        }
        return [num.toHex(entries.length / 3), ...entries];
      },
    }) as unknown as RpcProvider;
  const official = createOfficialStrk20Service({
    pauseForServiceRetry: async () => undefined,
    providerFor,
    sdk,
  });
  const strk20 = {
    ...makeStrk20Service(),
    // The SDK's own commitment, without the discovery round-trip the
    // production adapter adds for its registration check.
    async shadowAccountCommitment(input: Parameters<typeof official.shadowAccountCommitment>[0]) {
      const shadow = transfersFor(sdk, input).build().shadowAccounts(input.dappName);
      return num.toHex(
        input.nonce === undefined
          ? await shadow.partialCommitment()
          : await shadow.commitment(input.nonce),
      );
    },
    shadowAccounts: required(official.shadowAccounts),
    // The relay accepts the batch once the real SDK builder has assembled it.
    async submitActions(input: Parameters<typeof official.submitActions>[0]) {
      strk20BuilderFor(sdk, transfersFor(sdk, input), input.actions, input.account.address);
      submitted.push(input.actions);
      return { transactionHash: "0x5ee" };
    },
  };
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const wallet = {
    ...createWallet({ shadowAccountScopes: scopes }),
    async deriveStrk20ViewingKey() {
      return VIEWING_KEY;
    },
  };
  const activity = memoryActivityLog();
  const handler = createMessageHandler(wallet, testExtension, {
    activity,
    preferencesStore: {
      ...unavailablePreferencesStore,
      async read() {
        return preferences;
      },
    },
    runtimeRpc: makeRuntimeRpc({
      async getTokenBalances({ accountAddress, tokens }) {
        const held = heldAt.get(num.toHex(accountAddress)) ?? 0n;
        return tokens.map((token) => ({
          ...token,
          balance: BigInt(token.address) === BigInt(STRK_TOKEN_ADDRESS) ? held.toString() : "0",
          formatted: "",
        }));
      },
      strk20,
    }),
    session,
  });
  return { activity, handler, heldAt, scopes, submitted };
};

const approveLatest = async (handler: ReturnType<typeof harness>["handler"]) => {
  await flushHeld();
  const id = await latestApprovalId(handler, panel);
  await handler({ id, type: "wallet.approveOrigin" }, panel);
};

const call = { calldata: ["0x1"], contract_address: STRK_TOKEN_ADDRESS, entry_point: "transfer" };

describe("shadow account lifecycle against the rc.8 SDK", () => {
  test("commitment, invoke, record, view, balances, and sweep", async () => {
    const { activity, handler, heldAt, scopes, submitted } = harness();

    // 1. The site asks for nonce 0's commitment; the user approves.
    const commitment = handler(
      {
        dappName: LABEL,
        nonce: "0x0",
        origin: ORIGIN,
        type: "wallet.strk20ShadowAccountCommitment",
      },
      dapp,
    );
    await approveLatest(handler);
    expect(await commitment).toEqual({
      commitment: num.toHex(sdk.shadowAccountCommitment(await partial(), 0n)),
      ok: true,
    });

    // 2. The site settles a swap through nonce 1; the card says what it does.
    const invoke = handler(
      {
        actions: [
          {
            amount: "OPEN",
            recipient: account.address,
            token: STRK_TOKEN_ADDRESS,
            type: "transfer",
          },
          {
            calls: [call],
            collect_policy: { type: "diff" },
            dapp_name: LABEL,
            nonce: "0x1",
            type: "shadow_account_invoke",
          },
        ],
        origin: ORIGIN,
        type: "wallet.strk20InvokeTransaction",
      },
      dapp,
    );
    const [card] = await waitForPendingApprovals<{
      readonly id: string;
      readonly summaries: readonly string[];
    }>(handler, panel);
    expect(card?.summaries).toEqual(
      expect.arrayContaining([
        `Runs 1 call through your shadow account #1 for ${ORIGIN}`,
        `Shadow account anonymizer ${ANONYMIZER}`,
        SHADOW_INVOKE_SETTLES("STRK"),
        SHADOW_INVOKE_CONTROL,
      ]),
    );
    await approveLatest(handler);
    expect(await invoke).toEqual({ ok: true, transactionHash: "0x5ee" });
    const separator = await strk20ShadowAccountScope(ORIGIN, LABEL);
    expect(submitted[0]?.[1]).toMatchObject({ dapp_name: separator, nonce: "0x1" });

    // 3. Both scopes' uses were recorded, encrypted-vault side, with exact nonces.
    expect(scopes.value).toEqual([
      expect.objectContaining({ label: LABEL, nonces: ["0x0", "0x1"], origin: ORIGIN }),
    ]);

    // 4. The view lists the record without touching the network...
    expect(await handler({ type: "wallet.strk20ShadowAccounts" }, panel)).toEqual({
      ok: true,
      strk20ShadowAccounts: {
        scopes: [
          {
            anonymizer: ANONYMIZER,
            current: true,
            label: LABEL,
            nonces: ["0x0", "0x1"],
            origin: ORIGIN,
          },
        ],
      },
    });
    // ...and is never reachable from a site.
    for (const type of [
      "wallet.strk20ShadowAccounts",
      "wallet.strk20ShadowAccountBalances",
      "wallet.strk20PrepareShadowSweep",
    ]) {
      const refused = await handler({ label: LABEL, nonce: "0x1", origin: ORIGIN, type }, dapp);
      expect(JSON.stringify(refused)).not.toContain(LABEL);
      expect(refused).toHaveProperty("error");
    }

    // 5. On request, balances: the swap left 2 STRK at nonce 1's address.
    const nonce1 = await addressAt(1n);
    heldAt.set(num.toHex(nonce1), 2n * 10n ** 18n);
    const balances = (await handler(
      { label: LABEL, origin: ORIGIN, type: "wallet.strk20ShadowAccountBalances" },
      panel,
    )) as {
      strk20ShadowAccountBalances: {
        accounts: readonly {
          nonce: string;
          address: string;
          balances: readonly { symbol: string; formatted: string }[];
          recorded: boolean;
        }[];
      };
    };
    expect(balances.strk20ShadowAccountBalances.accounts).toEqual([
      expect.objectContaining({
        address: await addressAt(0n),
        balances: [],
        nonce: "0x0",
        recorded: true,
      }),
      expect.objectContaining({
        address: nonce1,
        balances: [expect.objectContaining({ formatted: "2", symbol: "STRK", tokenId: strk.id })],
        nonce: "0x1",
        recorded: true,
      }),
    ]);

    // 6. The sweep: one OPEN transfer per held token to this account, then a
    // call-less invoke collecting everything, relayed with the fee in private STRK.
    const prepared = (await handler(
      { label: LABEL, nonce: "0x1", origin: ORIGIN, type: "wallet.strk20PrepareShadowSweep" },
      panel,
    )) as {
      strk20Preparation: { id: string; kind: string; route: string; summaries: readonly string[] };
    };
    expect(prepared.strk20Preparation).toMatchObject({
      kind: "shadow-sweep",
      route: "private-relay",
    });
    expect(prepared.strk20Preparation.summaries.slice(0, 3)).toEqual([
      `Sweep your shadow account #1 for ${ORIGIN}`,
      `Shadow account anonymizer ${ANONYMIZER}`,
      SHADOW_INVOKE_SETTLES("STRK"),
    ]);
    const executed = await awaitStrk20Job(
      handler,
      await handler(
        { preparationId: prepared.strk20Preparation.id, type: "wallet.strk20Execute" },
        panel,
      ),
      panel,
    );
    expect(executed).toEqual({ ok: true, transactionHash: "0x5ee" });
    expect(submitted[1]).toEqual([
      { amount: "OPEN", recipient: account.address, token: strk.address, type: "transfer" },
      {
        calls: [],
        collect_policy: { type: "all" },
        dapp_name: separator,
        nonce: "0x1",
        type: "shadow_account_invoke",
      },
    ]);

    // 7. Activity is plain browser storage and goes out in the CSV export, so
    // the sweep's line names no site, label, nonce, or scope separator (F2).
    // The site's own invoke line is the pre-existing "<origin> submitted …".
    const entries = await activity.list();
    const sweep = entries.filter((entry) => !entry.summary.includes("submitted a private"));
    expect(sweep.map((entry) => entry.summary)).toEqual(["Sweep shadow account"]);
    for (const text of [JSON.stringify(sweep), activityToCsv(sweep)]) {
      for (const secret of [ORIGIN, new URL(ORIGIN).host, LABEL, separator, "#1"]) {
        expect(text).not.toContain(secret);
      }
    }
  });

  test("a sweep of an empty shadow account is refused before any quote", async () => {
    const { handler, submitted } = harness();
    const commitment = handler(
      {
        dappName: LABEL,
        nonce: "0x3",
        origin: ORIGIN,
        type: "wallet.strk20ShadowAccountCommitment",
      },
      dapp,
    );
    await approveLatest(handler);
    await commitment;
    expect(
      await handler(
        { label: LABEL, nonce: "0x3", origin: ORIGIN, type: "wallet.strk20PrepareShadowSweep" },
        panel,
      ),
    ).toEqual({ error: "shadow account holds no tracked token" });
    // An unrecorded scope, or a nonce neither recorded nor in the scan window.
    expect(
      await handler(
        { label: "Other", nonce: "0x3", origin: ORIGIN, type: "wallet.strk20PrepareShadowSweep" },
        panel,
      ),
    ).toEqual({ error: "shadow account scope not recorded" });
    expect(
      await handler(
        { label: LABEL, nonce: "0x99", origin: ORIGIN, type: "wallet.strk20PrepareShadowSweep" },
        panel,
      ),
    ).toEqual({ error: "shadow account scope not recorded" });
    expect(submitted).toEqual([]);
  });
});
