/**
 * Whether an account address shows on-chain evidence of use. Shared by phrase
 * discovery and raw-key import so both read "this account exists" the same way.
 */
import type { TokenConfig } from "@bramble/settings/preferences";
import type { RuntimeRpc } from "../runtime/runtime-rpc";

/** A probed token the undeployed address holds, as display text only. */
export type AccountHolding = { readonly formatted: string; readonly symbol: string };

/**
 * On-chain evidence for one address. A deployed address is not probed for
 * balances, so it carries no funding answer at all rather than a false one;
 * an undeployed address reports whether, and in what, it holds probed tokens.
 */
export type AccountActivity =
  | { readonly deployed: true }
  | {
      readonly deployed: false;
      readonly funded: boolean;
      readonly holdings: readonly AccountHolding[];
    };

/**
 * Reads deployment first and balances only for an undeployed address, since a
 * deployed account needs no further evidence. Probe the recovery token set,
 * not the display defaults: an account funded only in native USDC would read
 * as empty otherwise. RPC failures propagate; the caller decides whether a
 * missing answer fails the operation.
 */
export const readAccountActivity = async (
  runtimeRpc: Pick<RuntimeRpc, "getDeploymentStatus" | "getTokenBalances">,
  input: {
    readonly accountAddress: string;
    readonly rpcUrls: readonly string[];
    readonly tokens: readonly TokenConfig[];
  },
): Promise<AccountActivity> => {
  const { accountAddress, rpcUrls, tokens } = input;
  if (await runtimeRpc.getDeploymentStatus({ accountAddress, rpcUrls })) {
    return { deployed: true };
  }
  const balances = await runtimeRpc.getTokenBalances({ accountAddress, rpcUrls, tokens });
  const held = balances.filter((balance) => BigInt(balance.balance) > 0n);
  return {
    deployed: false,
    funded: held.length > 0,
    holdings: held.map(({ formatted, symbol }) => ({ formatted, symbol })),
  };
};
