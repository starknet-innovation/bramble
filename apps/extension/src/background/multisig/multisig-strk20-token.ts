/**
 * Tracked-token resolution and balance checks for a multisig STRK20 action.
 * The token list is the wallet's tracked tokens. Public balances use the same
 * balance read as the multisig portfolio. Private balances use the same
 * private-balance read as the single-signer privacy screen.
 */

import { readStrk20Balances } from "@bramble/privacy/service";
import type { TokenConfig } from "@bramble/settings/preferences";
import { formatTokenAmount } from "@bramble/starknet/rpc";
import { sameFelt } from "@bramble/wallet-model/networks";
import { STRK20_LIMITS } from "@bramble/wallet-protocol/strk20";
import {
  privateReadTokens,
  trackPrivatelyHeldTokens,
  untrackedCuratedTokens,
} from "../portfolio/held-tokens";
import type { MultisigOpsDeps } from "./multisig-deps";
import type { MultisigStrk20Session } from "./multisig-strk20-session";

/**
 * One private balance the panel can show next to a tracked token.
 */
export type MultisigStrk20PrivateBalance = {
  readonly balance: string;
  readonly formatted: string;
  readonly symbol: string;
  readonly token: string;
  readonly tokenId: string;
};

/**
 * Private balances of tracked tokens for this multisig, including a curated
 * token the pool reports as held. A failed read is null, not a zero balance.
 */
export const readMultisigStrk20PrivateBalances = async (
  deps: MultisigOpsDeps,
  session: MultisigStrk20Session,
): Promise<readonly MultisigStrk20PrivateBalance[] | null> => {
  const networkId = session.context.record.networkId;
  const preferences = await deps.preferencesStore.read();
  const tracked = preferences.tokens.filter((token) => token.networkId === networkId);
  const curated = untrackedCuratedTokens(preferences, networkId);
  try {
    const discovered = await readStrk20Balances(session.strk20, {
      ...session.readContext(),
      tokens: privateReadTokens(tracked, curated, STRK20_LIMITS.balances),
    });
    const trackedTokens = await trackPrivatelyHeldTokens(
      deps.preferencesStore,
      networkId,
      tracked,
      curated,
      discovered,
    );
    return discovered.flatMap((entry) => {
      const token = trackedTokens.find((candidate) => sameFelt(candidate.address, entry.token));
      return token
        ? [
            {
              balance: entry.balance,
              formatted: formatTokenAmount(BigInt(entry.balance), token.decimals),
              symbol: token.symbol,
              token: entry.token,
              tokenId: token.id,
            },
          ]
        : [];
    });
  } catch {
    return null;
  }
};

const exceeds = (balance: string | undefined, raw: bigint): boolean => {
  if (balance === undefined || balance === "") return false;
  try {
    return raw > BigInt(balance);
  } catch {
    return true;
  }
};

/**
 * Refuses an amount the multisig's public or private balance cannot cover.
 * A missing public read is not treated as zero. A missing private balance is,
 * because the pool reported every tracked token it was asked about.
 */
export const multisigStrk20Unaffordable = async (
  deps: MultisigOpsDeps,
  session: MultisigStrk20Session,
  kind: "deposit" | "transfer" | "withdraw",
  token: TokenConfig,
  raw: string,
): Promise<{ readonly error: string } | null> => {
  const amount = BigInt(raw);
  if (kind === "deposit") {
    const [row] = await deps.runtimeRpc.getTokenBalances({
      accountAddress: session.context.record.address,
      rpcUrls: session.context.rpcUrls,
      tokens: [token],
    });
    return exceeds(row?.balance, amount)
      ? { error: "Amount exceeds this multisig's balance." }
      : null;
  }
  const balances = await readMultisigStrk20PrivateBalances(deps, session);
  if (!balances) return { error: "private balances unavailable" };
  const held = balances.find((entry) => sameFelt(entry.token, token.address));
  return !held || exceeds(held.balance, amount)
    ? { error: "Amount exceeds this multisig's private balance." }
    : null;
};
