/**
 * Shared get-starknet feature types.
 *
 * starknet@10.8.0's WalletAccountV6 extends WalletAccountV5 but imports
 * WalletWithStarknetFeatures from two package names. TypeScript treats those
 * as unrelated, so skipLibCheck: false fails. Root tsconfig paths map both
 * specifiers here so they share one identity.
 */

/** Minimal wallet-standard wallet that both V5 and V6 connect signatures accept. */
export type WalletWithStarknetFeatures = {
  readonly features: {
    readonly "standard:connect": {
      readonly connect: (input?: { readonly silent?: boolean }) => Promise<{
        readonly accounts: readonly { readonly address?: string }[];
      }>;
    };
    readonly "standard:events": {
      readonly on: (
        event: "change",
        listener: (change: StandardEventsChangeProperties) => void,
      ) => () => void;
    };
    readonly "starknet:walletApi": {
      readonly request: (...args: never[]) => unknown;
    };
  };
};

/** Wallet-standard account/network change payload used by WalletAccountV5. */
export type StandardEventsChangeProperties = {
  readonly accounts?: readonly {
    readonly address?: string;
    readonly chains?: readonly string[];
  }[];
};
