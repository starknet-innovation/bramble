/**
 * HTTP-backed STRK20 privacy service.
 *
 * The STRK20 protocol proof machinery cannot run inside the extension, so a real
 * deployment points the wallet at a user-configured prover endpoint. This module
 * turns that single endpoint URL into the injectable {@link Strk20Service}: the
 * read side (registration + private balances) and the proving backend all POST
 * JSON to sub-paths of the configured URL and validate every response with the
 * shared schema guards before trusting it.
 *
 * Wire contract (all requests are JSON POSTs, all bodies validated on return):
 *   POST {proverUrl}/registered {address, rpcUrls}
 *     -> { registered: boolean }
 *   POST {proverUrl}/balances {address, tokens, rpcUrls}
 *     -> STRK20_BALANCE_ENTRY[]
 *   POST {proverUrl}/prove {address, actions, balances, rpcUrls, simulate}
 *     -> STRK20_CALL_AND_PROOF
 *
 * When a request's `proverUrl` is null the wallet is unconfigured: the service
 * behaves exactly like {@link unavailableStrk20Service} — the account reads as
 * not registered and proving refuses — so an unconfigured wallet never touches
 * the network. On a non-ok response or a shape mismatch the service throws the
 * stable STRK20 errors that map to the spec codes (118/119/120/163); it never
 * fabricates registration, balances, or a proof.
 */
import { WalletError } from "../../shared/errors";
import { isRecord } from "../../shared/json";
import { STRK20_PROVING_UNAVAILABLE } from "./proving-backend";
import { isStrk20BalanceEntry, isStrk20CallAndProof, type Strk20BalanceEntry } from "./schemas";
import {
  STRK20_NOT_REGISTERED,
  type Strk20AccountContext,
  type Strk20BalancesInput,
  type Strk20Service,
} from "./service";

/**
 * The minimal request options passed to the injected HTTP function. Mirrors the
 * subset of `fetch` init the service needs, so a real `fetch` wrapper satisfies
 * it directly.
 */
export type Strk20HttpInit = {
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: "POST";
};

/**
 * The injected HTTP transport: a `fetch`-shaped function returning a response
 * whose `ok` flag and JSON body the service inspects.
 */
export type Strk20Http = (
  url: string,
  init: Strk20HttpInit,
) => Promise<{ readonly ok: boolean; readonly json: () => Promise<unknown> }>;

// Joins the configured prover base URL with a protocol sub-path, tolerating a
// trailing slash on the base so both `https://p` and `https://p/` behave.
const endpoint = (proverUrl: string, path: string): string =>
  `${proverUrl.replace(/\/+$/, "")}/${path}`;

// POSTs a JSON body and returns the parsed response payload, or throws
// `onFailure` on a non-ok response so the caller maps it to a stable STRK20
// error rather than leaking transport detail.
const postJson = async (
  http: Strk20Http,
  url: string,
  body: unknown,
  onFailure: string,
): Promise<unknown> => {
  let response: Awaited<ReturnType<Strk20Http>>;
  try {
    response = await http(url, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  } catch {
    throw new WalletError(onFailure);
  }
  if (!response.ok) {
    throw new WalletError(onFailure);
  }
  try {
    return await response.json();
  } catch {
    throw new WalletError(onFailure);
  }
};

/**
 * Builds an {@link Strk20Service} that talks to a user-configured prover over the
 * given HTTP transport. A null `proverUrl` on any request reproduces the
 * unavailable/unconfigured behavior; a set URL drives the documented wire
 * contract with strict response validation.
 */
export const createHttpStrk20Service = (http: Strk20Http): Strk20Service => ({
  async privateBalances(input: Strk20BalancesInput): Promise<readonly Strk20BalanceEntry[]> {
    if (input.proverUrl === null) {
      throw new WalletError(STRK20_NOT_REGISTERED);
    }
    const payload = await postJson(
      http,
      endpoint(input.proverUrl, "balances"),
      { address: input.account.address, rpcUrls: input.rpcUrls, tokens: input.tokens },
      STRK20_NOT_REGISTERED,
    );
    if (!Array.isArray(payload) || !payload.every(isStrk20BalanceEntry)) {
      throw new WalletError(STRK20_NOT_REGISTERED);
    }
    return payload;
  },
  proving: {
    async prove(request) {
      if (request.proverUrl === null) {
        throw new WalletError(STRK20_PROVING_UNAVAILABLE);
      }
      const payload = await postJson(
        http,
        endpoint(request.proverUrl, "prove"),
        {
          actions: request.actions,
          address: request.account.address,
          balances: request.balances,
          rpcUrls: request.rpcUrls,
          simulate: request.simulate,
        },
        STRK20_PROVING_UNAVAILABLE,
      );
      if (!isStrk20CallAndProof(payload)) {
        throw new WalletError(STRK20_PROVING_UNAVAILABLE);
      }
      return payload;
    },
  },
  async registered(input: Strk20AccountContext): Promise<boolean> {
    if (input.proverUrl === null) {
      return false;
    }
    const payload = await postJson(
      http,
      endpoint(input.proverUrl, "registered"),
      { address: input.account.address, rpcUrls: input.rpcUrls },
      STRK20_NOT_REGISTERED,
    );
    if (!isRecord(payload) || typeof payload["registered"] !== "boolean") {
      throw new WalletError(STRK20_NOT_REGISTERED);
    }
    return payload["registered"];
  },
});
