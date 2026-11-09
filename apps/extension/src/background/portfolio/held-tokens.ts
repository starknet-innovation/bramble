/**
 * Tracks curated tokens the account already holds, without a manual scan
 * (mc-wallet issue 663).
 *
 * A received USDC stayed invisible until the user found "Find held tokens" and
 * added it by hand, and a shielded one stayed invisible altogether. The public
 * balance read and the private balance read now include every curated token for
 * the network, and a curated token with a non-zero balance is tracked.
 *
 * What is never tracked: a token outside the curated registry (spam stays out;
 * a site's or a sender's token still needs the user's Add), a curated token
 * whose record fails the manual Add's symbol grammar or the spam heuristics, and
 * a token the user removed (`wasTokenRemoved`). A token the user hid is still
 * tracked, so it is never a candidate and stays hidden.
 *
 * The record is built from the registry entry, not from an on-chain metadata
 * read. For a curated address the registry is the trusted source (it is what
 * `isCuratedToken` compares a chain answer against), and a metadata read right
 * after private discovery would tell the RPC endpoint which token was just
 * found in the private balance.
 */
import {
  isCuratedToken,
  isLikelySpam,
  knownTokensForNetwork,
} from "@bramble/portfolio/token-registry";
import {
  type TokenConfig,
  type WalletPreferences,
  wasTokenRemoved,
} from "@bramble/settings/preferences";
import { type StarknetNetworkId, sameFelt } from "@bramble/wallet-model/networks";
import { buildTokenRecord } from "./token-ops";

/**
 * The curated tokens for `networkId` that the account does not track. Balance
 * reads add these to the tracked set, so the tokens a read asks the RPC about
 * do not depend on which of them the account holds. Removed tokens stay in the
 * read for the same reason; {@link trackHeldCuratedTokens} skips them.
 */
export const untrackedCuratedTokens = (
  preferences: Pick<WalletPreferences, "tokens">,
  networkId: StarknetNetworkId,
): readonly TokenConfig[] =>
  knownTokensForNetwork(networkId).filter(
    (known) =>
      !preferences.tokens.some(
        (token) => token.networkId === networkId && sameFelt(token.address, known.address),
      ),
  );

/**
 * Tracks each curated, untracked, not-removed token in `held` (addresses with a
 * non-zero balance) as if the user had added it. Returns the tokens tracked, in
 * curated order; an empty list writes nothing. Best effort: a token the store
 * refuses (the added-token cap, a concurrent write) is skipped, never thrown,
 * because a failed convenience must not fail the balance read that ran it.
 */
export const trackHeldCuratedTokens = async (
  preferencesStore: {
    readonly read: () => Promise<WalletPreferences>;
    readonly upsertToken: (
      token: Omit<TokenConfig, "id">,
      source: "user",
    ) => Promise<WalletPreferences>;
  },
  networkId: StarknetNetworkId,
  held: readonly string[],
): Promise<readonly TokenConfig[]> => {
  if (held.length === 0) return [];
  const preferences = await preferencesStore.read();
  const added: TokenConfig[] = [];
  for (const curated of untrackedCuratedTokens(preferences, networkId)) {
    if (!held.some((address) => sameFelt(address, curated.address))) continue;
    if (wasTokenRemoved(preferences, networkId, curated.address)) continue;
    const record = buildTokenRecord(curated.address, networkId, curated);
    if (!record || !isCuratedToken(record) || isLikelySpam(record)) continue;
    try {
      await preferencesStore.upsertToken(record, "user");
      added.push(curated);
    } catch {
      // Skipped: see the doc comment.
    }
  }
  return added;
};

/** Longest a scope goes between curated probes while balances keep refreshing. */
const PROBE_INTERVAL_MS = 10 * 60_000;
/** A forced refresh probes again only after this long, so a held Refresh is bounded. */
const FORCED_PROBE_MIN_MS = 60_000;
const MAX_PROBE_SCOPES = 64;

// Last probe per scope, per preferences store (one per wallet; tests make many).
const probes = new WeakMap<object, Map<string, number>>();

/**
 * Whether the public balance read for `scope` should include the curated
 * tokens, and a `ran` callback to record a probe that completed. `scope` names
 * the unlock session, network and account, so the first read after an unlock,
 * an account switch or a network switch always probes; after that a probe runs
 * every {@link PROBE_INTERVAL_MS}, or on a forced (user) refresh at most once
 * a minute. Bounded so the curated reads add a few RPC calls per scope per ten
 * minutes rather than per balance refresh.
 */
export const curatedProbe = (
  owner: object,
  scope: string,
  now: number,
  forced: boolean,
): { readonly due: boolean; readonly ran: () => void } => {
  const scopes = probes.get(owner) ?? new Map<string, number>();
  probes.set(owner, scopes);
  const last = scopes.get(scope);
  const due =
    last === undefined ||
    now - last >= PROBE_INTERVAL_MS ||
    (forced && now - last >= FORCED_PROBE_MIN_MS);
  return {
    due,
    ran: () => {
      scopes.delete(scope);
      scopes.set(scope, now);
      const oldest = scopes.keys().next().value;
      if (scopes.size > MAX_PROBE_SCOPES && oldest !== undefined) scopes.delete(oldest);
    },
  };
};

/**
 * The token list a private balance read asks for: the tracked tokens, then the
 * untracked curated ones, cut at `limit` (the private read's token bound) so a
 * full tracked list is never refused for the curated additions. Private
 * discovery fetches every note whatever the list says and filters locally, so
 * widening it sends nothing new to any service.
 */
export const privateReadTokens = (
  tracked: readonly TokenConfig[],
  curated: readonly TokenConfig[],
  limit: number,
): readonly string[] =>
  [...tracked, ...curated.slice(0, Math.max(0, limit - tracked.length))].map(
    (token) => token.address,
  );

/**
 * After a private read that covered `curated`, tracks each curated token with
 * a non-zero private balance and returns the network's tracked tokens after
 * it: `tracked` plus what was added. Callers keep only entries for these, so
 * the private state the panel receives still names tracked tokens alone.
 */
export const trackPrivatelyHeldTokens = async (
  preferencesStore: Parameters<typeof trackHeldCuratedTokens>[0],
  networkId: StarknetNetworkId,
  tracked: readonly TokenConfig[],
  curated: readonly TokenConfig[],
  discovered: readonly { readonly balance: string; readonly token: string }[],
): Promise<readonly TokenConfig[]> => {
  const held = discovered
    .filter(
      (entry) =>
        BigInt(entry.balance) > 0n && curated.some((token) => sameFelt(token.address, entry.token)),
    )
    .map((entry) => entry.token);
  return [...tracked, ...(await trackHeldCuratedTokens(preferencesStore, networkId, held))];
};
