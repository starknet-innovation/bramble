/**
 * Accepted-transaction maturity contract shared by the privacy adapter and
 * its browser-session persistence boundary.
 */

import type { StarknetNetworkId } from "@bramble/wallet-model/networks";

/**
 * Account/network/pool scope whose latest privacy write must mature before a
 * later proof can use historical state.
 */
export type Strk20MaturityScope = {
  readonly accountId: string;
  readonly networkId: StarknetNetworkId;
  readonly poolAddress: string;
};

/**
 * Latest privacy write. `submitting` is persisted immediately before the
 * broadcast boundary so an indeterminate post-broadcast failure cannot be
 * mistaken for a clean scope.
 */
export type Strk20MaturityRecord =
  | {
      readonly state: "submitting";
    }
  | {
      readonly acceptedBlock?: number;
      readonly state: "submitted";
      readonly transactionHash: string;
    };

/**
 * Minimal persistence boundary. Production uses trusted browser session
 * storage so a service-worker restart cannot forget a just-submitted write.
 */
export type Strk20MaturityStore = {
  readonly read: (scope: Strk20MaturityScope) => Promise<Strk20MaturityRecord | null>;
  readonly write: (
    scope: Strk20MaturityScope,
    record: Strk20MaturityRecord | null,
  ) => Promise<void>;
};

const scopeKey = (scope: Strk20MaturityScope): string =>
  `${scope.accountId}|${scope.networkId}|${scope.poolAddress}`;

/**
 * In-memory default for tests and environments without browser storage.
 */
export const memoryStrk20MaturityStore = (): Strk20MaturityStore => {
  const records = new Map<string, Strk20MaturityRecord>();
  return {
    async read(scope) {
      return records.get(scopeKey(scope)) ?? null;
    },
    async write(scope, record) {
      const key = scopeKey(scope);
      if (record) {
        records.set(key, { ...record });
      } else {
        records.delete(key);
      }
    },
  };
};
