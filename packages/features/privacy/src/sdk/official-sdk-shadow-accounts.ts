/**
 * Lists a scope's shadow accounts through the configured anonymizer's
 * `get_shadow_accounts` view (#443, PR 5). The partial commitment comes from
 * the pinned SDK (it needs the viewing key and never leaves this boundary
 * except as the view's argument); the addresses come from the anonymizer, which
 * reports undeployed nonces at the address its primer deploy would use.
 *
 * Privacy: the call sends the partial commitment to the RPC node and returns
 * the scope's addresses, so the node can link them. Callers run it only when
 * the user asks.
 */
import { WalletError } from "@bramble/core/errors";
import { isNonZeroStarkFieldElement } from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";
import { num } from "starknet";
import type { Strk20ShadowAccountInfo } from "../service";
import { STRK20_SERVICE_UNAVAILABLE, type Strk20Service } from "../service";
import { mapStrk20ProtocolError } from "./official-sdk-errors";
import { retryStrk20ServiceRead, type ServiceRetryPause } from "./official-sdk-retry";
import type { PrivacySdkRuntime } from "./official-sdk-runtime";
import { transfersFor } from "./official-sdk-transfers";
import { requireStrk20Config } from "./official-sdk-values";

// The anonymizer's nonce type is u64; larger nonces are outside its view.
const SHADOW_ACCOUNT_VIEW_NONCE_LIMIT = 1n << 64n;

// The anonymizer's MAX_SCAN_RANGE: one view call covers at most this many nonces.
const MAX_SCAN_RANGE = 1024n;

const unavailable = (reason: string): WalletError =>
  new WalletError(`${STRK20_SERVICE_UNAVAILABLE}: could not list shadow accounts (${reason})`);

// Contiguous [start, end) windows covering the requested nonces, each within
// the anonymizer's scan bound, so a gap between nonces costs nothing.
const nonceWindows = (nonces: readonly bigint[]): readonly (readonly [bigint, bigint])[] => {
  const sorted = [...new Set(nonces)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const windows: [bigint, bigint][] = [];
  for (const nonce of sorted) {
    const last = windows.at(-1);
    if (last && nonce === last[1] && last[1] - last[0] < MAX_SCAN_RANGE) {
      last[1] = nonce + 1n;
    } else {
      windows.push([nonce, nonce + 1n]);
    }
  }
  return windows;
};

// Span<ShadowAccountInfo>: a length, then (nonce, address, is_deployed) each.
const decodeInfos = (
  response: readonly string[],
  window: readonly [bigint, bigint],
): readonly Strk20ShadowAccountInfo[] => {
  const length = response[0] === undefined ? -1 : Number(BigInt(response[0]));
  if (length !== Number(window[1] - window[0]) || response.length !== 1 + length * 3) {
    throw unavailable("the anonymizer returned an unexpected result shape");
  }
  return Array.from({ length }, (_, index) => {
    const nonce = BigInt(response[1 + index * 3] ?? "-1");
    const address = num.toHex(response[2 + index * 3] ?? "0x0");
    const deployed = BigInt(response[3 + index * 3] ?? "2");
    if (
      nonce !== window[0] + BigInt(index) ||
      !isNonZeroStarkFieldElement(address) ||
      (deployed !== 0n && deployed !== 1n)
    ) {
      throw unavailable("the anonymizer returned a malformed entry");
    }
    return { address, deployed: deployed === 1n, nonce: num.toHex(nonce) };
  });
};

/**
 * Builds the `shadowAccounts` read. Nonces at or above 2^64 are refused, since the view cannot
 * address them; an unreachable node or a malformed answer fails closed.
 */
export const strk20ShadowAccountReads = (deps: {
  readonly pauseForServiceRetry: ServiceRetryPause;
  readonly providerFor: (nodeUrl: string) => RpcProvider;
  readonly sdk: PrivacySdkRuntime;
}): Pick<Strk20Service, "shadowAccounts"> => ({
  async shadowAccounts(input) {
    const config = requireStrk20Config(input);
    const anonymizer = config.shadowAccountAnonymizerAddress;
    const nodeUrl = input.rpcUrls[0];
    if (!anonymizer || !nodeUrl) {
      throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
    }
    if (input.nonces.some((nonce) => nonce < 0n || nonce >= SHADOW_ACCOUNT_VIEW_NONCE_LIMIT)) {
      throw unavailable("a nonce is outside the anonymizer's range");
    }
    let partial: bigint;
    try {
      partial = await transfersFor(deps.sdk, input)
        .build()
        .shadowAccounts(input.dappName)
        .partialCommitment();
    } catch (error) {
      return mapStrk20ProtocolError(error);
    }
    const infos: Strk20ShadowAccountInfo[] = [];
    for (const window of nonceWindows(input.nonces)) {
      let response: readonly string[];
      try {
        response = await retryStrk20ServiceRead(
          () =>
            deps.providerFor(nodeUrl).callContract({
              calldata: [num.toHex(partial), num.toHex(window[0]), num.toHex(window[1]), "0x0"],
              contractAddress: anonymizer,
              entrypoint: "get_shadow_accounts",
            }),
          deps.pauseForServiceRetry,
        );
      } catch {
        throw unavailable("the node did not answer get_shadow_accounts");
      }
      infos.push(...decodeInfos(response, window));
    }
    return infos;
  },
});
