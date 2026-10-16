/**
 * Carries the wallet's own endpoint refusal across starknet.js's error rewrap.
 *
 * starknet.js 10.8.0's `fetchEndpoint` catches whatever its `fetch` rejects
 * with and rethrows `Error(error.message)`, so the {@link RpcRefusedError} that
 * {@link timedRpcFetch} raised for an HTTP 429 or JSON-RPC -32005 reaches the
 * wallet as a plain `Error` (mc-wallet #660). A refused broadcast then read as
 * "status unknown", which burns a counterfactual deploy address, and a refused
 * read lost its `Retry-After` cooldown.
 */

import type { RpcProvider } from "starknet";
import { RpcRefusedError } from "./rpc-transport";

type ChannelMethod = (this: object, ...args: readonly unknown[]) => unknown;

// Runs one `fetchEndpoint` call with a receiver whose `fetch` notes a refusal
// from that call only. The receiver is per call, so concurrent requests on one
// channel never see each other's refusal.
const refusalPreservingFetchEndpoint = (fetchEndpoint: ChannelMethod): ChannelMethod =>
  async function (this: object, ...args: readonly unknown[]): Promise<unknown> {
    let refusal: RpcRefusedError | null = null;
    const receiver = new Proxy(this, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property, target);
        if (property !== "fetch" || typeof value !== "function") {
          return value;
        }
        return (...fetchArgs: readonly unknown[]): Promise<unknown> =>
          Promise.resolve(Reflect.apply(value, target, fetchArgs)).catch((error: unknown) => {
            if (error instanceof RpcRefusedError) {
              refusal = error;
            }
            throw error;
          });
      },
    });
    try {
      return await Reflect.apply(fetchEndpoint, receiver, args);
    } catch (error) {
      // Only the wallet's own transport mints an RpcRefusedError, and only for
      // a 429 or a -32005 it read itself, so no node text can reach this branch.
      throw refusal ?? error;
    }
  };

/**
 * Makes a provider's JSON-RPC channel rethrow the exact {@link RpcRefusedError}
 * its transport raised, instead of starknet.js's message-only copy. Trust
 * boundary: the original object is matched by identity to the one request that
 * produced it, never by message text, so a node that echoes the refusal
 * sentence still reads as an ordinary failure, and a broadcast stays
 * outcome-unknown unless the wallet itself saw the refusal. Failure behaviour:
 * a provider without the expected channel shape, or a starknet.js release that
 * stops calling `fetch` from `fetchEndpoint`, is left as it is, which keeps the
 * cautious outcome-unknown result. Mutates and returns the given provider.
 */
export const preserveRpcRefusals = (provider: RpcProvider): RpcProvider => {
  const channel: unknown = Reflect.get(provider, "channel", provider);
  if (typeof channel !== "object" || channel === null) {
    return provider;
  }
  const fetchEndpoint: unknown = Reflect.get(channel, "fetchEndpoint", channel);
  if (typeof fetchEndpoint !== "function" || typeof Reflect.get(channel, "fetch") !== "function") {
    return provider;
  }
  Object.defineProperty(channel, "fetchEndpoint", {
    configurable: true,
    value: refusalPreservingFetchEndpoint(fetchEndpoint as ChannelMethod),
    writable: true,
  });
  return provider;
};
