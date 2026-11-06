/**
 * `wallet.stakingDirectory` (issue 750): one page of Starkscan's validator
 * directory, read through the SNF gateway route for the active network.
 *
 * Trust boundary: the gateway holds the Starkscan API key and passes
 * Starkscan's answer through unchanged; the extension never holds a key. The
 * answer is untrusted. It is read with a size and time bound, validated
 * strictly (@bramble/transactions/staking-directory), filtered to active
 * validators with an active pool for a tracked token, and returned as display
 * strings. Nothing from it is signed or used to build a call: a validator
 * picked from this list is verified on chain like a pasted address.
 *
 * Failure behaviour: no route configured is "off"; a coverage status other
 * than `prepared` is "incomplete" with no validators; any transport, status,
 * size, deadline or schema failure is one refusal. The screen then offers the
 * pasted address, which always works.
 */
import {
  type BoundedHttpFetch,
  fetchBoundedJson,
  HTTP_BODY_LIMITS,
  untrustedFetch,
} from "@bramble/core/http-json";
import { isServiceUrl } from "@bramble/core/service-url";
import { formatTokenAmount } from "@bramble/starknet/rpc";
import {
  directoryEntries,
  parseStakingDirectoryPage,
  STAKING_DIRECTORY_PAGE_SIZE,
} from "@bramble/transactions/staking-directory";
import { STAKING_DIRECTORY_URLS } from "@bramble/transactions/staking-networks";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { type StakingOpsDeps, stakingContext } from "./staking-context";
import type { StakingDirectoryView } from "./staking-view";

/** The refusal for a directory that could not be read or did not validate. */
const STAKING_DIRECTORY_UNREADABLE = {
  error: "Couldn't load the validator list. Paste a validator address instead.",
} as const;

/**
 * The directory route per network and its transport. Production uses the
 * bundled routes (none yet) and the hardened untrusted fetch; tests inject
 * both.
 */
export type StakingDirectoryRouting = {
  readonly http: BoundedHttpFetch;
  readonly urls: Readonly<Record<StarknetNetworkId, string | null>>;
};

/** The production routing: bundled routes and the hardened transport. */
export const DEFAULT_STAKING_DIRECTORY: StakingDirectoryRouting = {
  http: untrustedFetch,
  urls: STAKING_DIRECTORY_URLS,
};

const pageUrl = (base: string, cursor: string | null): string => {
  const url = new URL(base);
  url.searchParams.set("limit", String(STAKING_DIRECTORY_PAGE_SIZE));
  if (cursor !== null) url.searchParams.set("cursor", cursor);
  return url.href;
};

/**
 * Reads one directory page for the active account's network.
 */
export const stakingDirectoryResponse = async (
  deps: StakingOpsDeps,
  routing: StakingDirectoryRouting,
  cursor: string | null,
): Promise<RuntimeResponse> => {
  const context = await stakingContext(deps, true);
  if ("error" in context) return { error: context.error };
  const { networkId } = context;
  const base = routing.urls[networkId];
  const off = (state: StakingDirectoryView): RuntimeResponse => ({
    ok: true,
    stakingDirectory: state,
  });
  if (!base || !isServiceUrl(base) || networkId === "SN_DEVNET") return off({ state: "off" });
  let body: unknown;
  try {
    body = await fetchBoundedJson(
      routing.http,
      pageUrl(base, cursor),
      HTTP_BODY_LIMITS.stakingDirectory,
    );
  } catch {
    return STAKING_DIRECTORY_UNREADABLE;
  }
  const page = parseStakingDirectoryPage(body, networkId);
  if (!page) return STAKING_DIRECTORY_UNREADABLE;
  if (page.coverage !== "prepared") return off({ state: "incomplete" });
  const tokens = context.preferences.tokens.filter((token) => token.networkId === networkId);
  return off({
    entries: directoryEntries(page, tokens, formatTokenAmount),
    nextCursor: page.nextCursor,
    state: "ready",
  });
};
