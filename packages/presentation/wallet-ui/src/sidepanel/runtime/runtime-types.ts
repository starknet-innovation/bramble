/** Shared side-panel runtime boundary and loading-state types. */

import type { TokenBalance } from "../../popup/responses/responses";

/** Sender evidence delivered with a runtime message. */
export type RuntimeMessageSender = {
  readonly id?: string;
  readonly tab?: { readonly id?: number };
};

/** Minimal browser runtime API consumed by the side panel. */
export type RuntimeApi = {
  readonly onMessage?: {
    readonly addListener: (
      listener: (message: unknown, sender: RuntimeMessageSender | undefined) => void,
    ) => void;
  };
  readonly sendMessage: (message: unknown) => Promise<unknown>;
};

/** Balance loading state rendered by the side panel. */
export type BalanceState =
  | {
      readonly asOf?: number | null;
      readonly balances: readonly TokenBalance[];
      readonly error?: never;
      readonly stale?: boolean;
    }
  | { readonly balances?: never; readonly error: string };

/** Successful balances retain the account/network scope proven by the response. */
export type ScopedBalanceState =
  | {
      readonly accountId: string;
      readonly asOf?: number | null;
      readonly balances: readonly TokenBalance[];
      readonly error?: never;
      readonly networkId: string;
      readonly stale?: boolean;
    }
  | {
      readonly accountId?: never;
      readonly balances?: never;
      readonly error: string;
      readonly networkId?: never;
    };
