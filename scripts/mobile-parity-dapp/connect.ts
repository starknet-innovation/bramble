/**
 * The `connect` block: connecting a site and the passive reads around it, through the
 * extension's real path end to end: the page's request read by the bridge
 * (`readProviderRequestArguments`, `toRuntimeMessage`), the background's message handler
 * (`createMessageHandler`: the blocklist, lock and grant gates, the connect card and its
 * decision), and the reply shaped for the page (`toProviderPayload`). The wallet is the
 * background suites' stub (`tests/support/background-wallet-stub.ts`): two Sepolia accounts, a
 * grant for `https://example.com`, and the real `grantedAccountIdsFor` over them.
 *
 * Each case fixes the wallet's state, sends one or two page requests, and, for a request held
 * for the person, takes a decision on the card. Written: the state as the core reads it (grants,
 * active account, lock, block, active chain id), each request's page answer (`pending` while
 * held), the decision's outcome for the panel, and the grant the decision wrote.
 */
import type { Json } from "@bramble/core/json";
import { createOriginGuard } from "@bramble/permissions/blocklist";
import { createPreferencesStore, type WalletPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import type { OriginGrantInput } from "@bramble/vault/service";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS, type StarknetNetworkId } from "@bramble/wallet-model/networks";
import {
  type ProviderMethod,
  readProviderRequest,
  readProviderRequestArguments,
  toProviderPayload,
  toRuntimeMessage,
} from "@bramble/wallet-protocol/bridge";
import { invalidRequestPayload } from "@bramble/wallet-protocol/rpc-errors";
import type { MessageHandlerOptions } from "../../apps/extension/src/background/routing/message-context";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import {
  createUnlockSession,
  type UnlockSession,
} from "../../apps/extension/src/background/runtime/session";
import {
  account,
  contentSender,
  createWallet,
  extensionSender,
  grantedOrigin,
  secondAccount,
  testExtension,
  vaultPassphrase,
} from "../../tests/support/background-wallet-stub";
import { flushHeld } from "../../tests/support/held";
import { makeRuntimeRpc } from "../../tests/support/runtime-rpc-stub";

type State = {
  readonly locked?: boolean;
  readonly blocked?: boolean;
  /** The stored grant's accounts for the site; the first account by default. */
  readonly granted?: readonly string[];
  /** Which account is active: the first (granted) or the second. */
  readonly active?: "first" | "second";
};

export type Ask = { readonly method: ProviderMethod; readonly params?: Json };

/** What happens to the first held card: approved (with an echo), denied, or left. */
type Decision = {
  readonly decide: "approve" | "deny";
  /** Before deciding: switch the active account, lock, or block the site. */
  readonly before?: "switch" | "lock" | "block";
  /** The account echo the panel sends; the active one by default. */
  readonly echo?: "active" | "other" | "none";
};

type Case = {
  readonly name: string;
  readonly state: State;
  readonly asks: readonly Ask[];
  readonly decision?: Decision;
};

export const ask = (method: ProviderMethod, params?: Json): Ask =>
  params === undefined ? { method } : { method, params };
const accounts = ask("wallet_requestAccounts");
const silent = ask("wallet_requestAccounts", { silent_mode: true });
const READS: readonly Ask[] = [
  ask("wallet_getPermissions"),
  ask("wallet_requestChainId"),
  ask("wallet_supportedSpecs"),
  ask("wallet_supportedWalletApi"),
  ask("wallet_supportedWalletApi", { api_version: "0.10.5" }),
  ask("wallet_supportedSpecs", { api_version: "0.9.0" }),
  ask("mc_accounts"),
  silent,
];

const STATES: readonly (readonly [string, State])[] = [
  ["connected", {}],
  ["not connected", { granted: [] }],
  ["connected to another account", { active: "second" }],
  ["locked", { locked: true }],
  ["blocked", { blocked: true }],
];

const CASES: readonly Case[] = [
  ...STATES.flatMap(([label, state]) =>
    [...READS, accounts, ask("mc_requestAccounts")].map((one) => ({
      asks: [one],
      name: `${one.method}${one.params ? ` ${JSON.stringify(one.params)}` : ""}, ${label}`,
      state,
    })),
  ),
  {
    asks: [accounts, ask("mc_requestAccounts")],
    decision: { decide: "approve" },
    name: "approve answers every request waiting on the card",
    state: { granted: [] },
  },
  {
    asks: [accounts],
    decision: { decide: "deny" },
    name: "deny refuses the waiting request",
    state: { granted: [] },
  },
  {
    asks: [accounts],
    decision: { decide: "approve", echo: "none" },
    name: "approve with no account echo",
    state: { granted: [] },
  },
  {
    asks: [accounts],
    decision: { decide: "approve", echo: "other" },
    name: "approve echoing an account that is not active",
    state: { granted: [] },
  },
  {
    asks: [accounts],
    decision: { before: "switch", decide: "approve", echo: "other" },
    name: "approve after the active account moved, echoing the card's",
    state: { granted: [] },
  },
  {
    asks: [accounts],
    decision: { before: "lock", decide: "approve" },
    name: "approve after the wallet locked",
    state: { granted: [] },
  },
  {
    asks: [accounts],
    decision: { before: "block", decide: "approve" },
    name: "approve after the site was blocked",
    state: { granted: [] },
  },
  {
    asks: [accounts],
    decision: { decide: "approve" },
    name: "a site asking while locked is approved once unlocked",
    state: { granted: [], locked: true },
  },
  {
    asks: [accounts],
    decision: { decide: "approve" },
    name: "approve grants the active account beside the one already granted",
    state: { active: "second" },
  },
];

const REQUEST_ID = "00000000-0000-4000-8000-000000000001";

/** What the page receives for `reply`, the background's answer to `method`. */
const pageAnswer = (method: ProviderMethod, reply: unknown) => toProviderPayload(reply, method);

/** The stub wallet the handler reads; a case may wrap it (see {@link createBackground}). */
export type StubWallet = ReturnType<typeof createWallet>;

/** How one background is set up: the vault's accounts and grant, and the session's lock. */
export type BackgroundSetup = {
  readonly accounts: readonly AccountRef[];
  /** Read on every wallet call, so a case can switch accounts between two messages. */
  readonly active: () => AccountRef;
  /** Read on every guard call, so a case can block the site mid-case. */
  readonly blocked: () => boolean;
  readonly grantedIds: readonly string[];
  readonly locked: boolean;
  /** The active network; Sepolia by default. */
  readonly network?: StarknetNetworkId;
  /** Collaborators beyond the wallet, guard, preferences, RPC and session (multisig stores). */
  readonly options?: Partial<MessageHandlerOptions>;
  /** Writes preferences beyond the active network before the handler reads any. */
  readonly preferences?: (store: WalletPreferencesStore) => Promise<void>;
  /** Wraps the stub wallet, given the session (to lock it mid-request). */
  readonly wallet?: (
    stub: StubWallet,
    session: UnlockSession,
  ) => Parameters<typeof createMessageHandler>[0];
};

/**
 * The extension's real background message handler over the background suites' stubs, at the
 * fixed clock `1_000`. Shared by the `connect` and `sign` blocks.
 */
export const createBackground = async (setup: BackgroundSetup) => {
  const stub = createWallet({
    accounts: setup.accounts,
    activeAccountId: () => setup.active().id,
    grantAccountIds: setup.grantedIds,
  });
  const session = createUnlockSession({ now: () => 1_000, ttlMs: 60 * 60 * 1000 });
  if (!setup.locked) session.unlock(vaultPassphrase);
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  await preferencesStore.setActiveNetwork(setup.network ?? "SN_SEPOLIA");
  await setup.preferences?.(preferencesStore);
  const handler = createMessageHandler(setup.wallet?.(stub, session) ?? stub, testExtension, {
    ...setup.options,
    originGuard: createOriginGuard(() => new Set(setup.blocked() ? ["example.com"] : [])),
    preferencesStore,
    runtimeRpc: makeRuntimeRpc(),
    session,
  });
  return { handler, session };
};

type Handler = Awaited<ReturnType<typeof createBackground>>["handler"];

/**
 * Sends each page request from `grantedOrigin` through the bridge and the handler, without
 * awaiting: `answers[i]` stays `"pending"` while a card holds it. Resolves once each request
 * has either answered or queued its card.
 */
export const askPage = async (handler: Handler, asks: readonly Ask[]) => {
  const answers: unknown[] = asks.map(() => "pending");
  const held = asks.map(async ({ method, params }, index) => {
    const args = readProviderRequestArguments(
      params === undefined ? { method } : { method, params },
    );
    const request =
      args && readProviderRequest({ ...args, id: REQUEST_ID, target: "bramble:content" });
    const message = request && toRuntimeMessage(request, grantedOrigin);
    answers[index] = message
      ? pageAnswer(method, await handler(message, contentSender))
      : { error: invalidRequestPayload() };
  });
  await flushHeld();
  return { answers, held };
};

const runCase = async ({ asks, decision, name, state }: Case) => {
  let blocked = state.blocked === true;
  let active = state.active === "second" ? secondAccount : account;
  const initial = active;
  const grantedIds = state.granted ?? [account.id];
  const grants: OriginGrantInput[] = [];
  const { handler, session } = await createBackground({
    accounts: [account, secondAccount],
    active: () => active,
    blocked: () => blocked,
    grantedIds,
    locked: state.locked === true,
    // The stub's `grantOrigin` answers with its first account whatever was granted; the vault
    // service answers with the granted one (`findVaultAccount`), so this does too. Only the
    // answer is replaced: the real `grantOrigin` also runs `requireGrantAuthorization` and
    // validates the origin, but the handler has already checked both before it calls here
    // (the session's authorization, and `grantedOrigin` is a valid https origin in every case),
    // and the stub never wrote anything this block records, so no recorded outcome changes.
    wallet: (stub) => ({
      ...stub,
      async grantOrigin(input: OriginGrantInput) {
        grants.push(input);
        return [input.accountId === secondAccount.id ? secondAccount : account];
      },
    }),
  });
  const { answers, held } = await askPage(handler, asks);

  let decided: unknown = null;
  if (decision) {
    const listed = (await handler({ type: "wallet.pendingApprovals" }, extensionSender)) as {
      readonly pending: readonly { readonly id: string; readonly kind: string }[];
    };
    const card = listed.pending[0];
    const cardAccount = active.id;
    if (decision.before === "switch") active = active === account ? secondAccount : account;
    if (decision.before === "lock") session.lock();
    if (decision.before === "block") blocked = true;
    if (decision.before === undefined && state.locked === true) session.unlock(vaultPassphrase);
    const echo =
      decision.echo === "none"
        ? {}
        : decision.echo === "other"
          ? { reviewedAccountId: cardAccount === active.id ? secondAccount.id : cardAccount }
          : { reviewedAccountId: active.id };
    const type = decision.decide === "approve" ? "wallet.approveOrigin" : "wallet.denyOrigin";
    const reply = (await handler({ id: card?.id, type, ...echo }, extensionSender)) as Record<
      string,
      unknown
    >;
    decided = {
      before: decision.before ?? null,
      card: card?.kind ?? null,
      decide: decision.decide,
      echo: echo.reviewedAccountId ?? null,
      reply: "error" in reply ? { error: reply["error"] } : { ok: reply["ok"] },
    };
    await flushHeld();
  }
  await Promise.race([Promise.all(held), flushHeld()]);

  return {
    answers: [...answers],
    asks,
    decided,
    grants: grants.map(({ accountId, origin }) => ({ accountId: accountId ?? null, origin })),
    name,
    state: {
      active: { address: initial.address, id: initial.id, networkId: initial.networkId },
      blocked: state.blocked === true,
      chainId: STARKNET_NETWORKS.SN_SEPOLIA.chainId,
      grants: [{ accountIds: grantedIds, origin: grantedOrigin }],
      locked: state.locked === true,
      origin: grantedOrigin,
    },
  };
};

/** Runs every case, each over a fresh background. */
export const computeConnect = async (): Promise<readonly object[]> => {
  const cases: object[] = [];
  for (const one of CASES) cases.push(await runCase(one));
  return cases;
};
