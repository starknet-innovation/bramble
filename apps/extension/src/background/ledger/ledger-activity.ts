/**
 * On-chain state of a Ledger account address: the best-effort read behind the
 * picker's `wallet.ledgerAccountStatus`, and the fail-closed gate that keeps the
 * background from storing a Braavos Ledger account no one has used. Reads only
 * public chain state through the runtime RPC; no device, key, or vault write.
 */

import { knownTokensForNetwork } from "@bramble/portfolio/token-registry";
import { STARKNET_NETWORKS, type StarknetNetworkId } from "@bramble/wallet-model/networks";
import type { WalletOpsDeps } from "../accounts/wallet-ops";
import { networkRpcUrls } from "../runtime/runtime-state";
import type { AddLedgerAccountRequest } from "./ledger-inputs";

/**
 * Best-effort on-chain state of a Ledger candidate. `null` means the read
 * failed, which callers must treat as unknown, never as inactive-but-safe.
 */
export type LedgerAccountState = {
  readonly balance: string | null;
  readonly deployed: boolean | null;
  readonly funded: boolean | null;
};

// Best-effort balances for a candidate address across every known token on the
// network — the same token set the recovery scan's funded check reads, so a
// Ready Ledger account holding only ETH is detected exactly like a phrase
// recovery would detect it. `balance` is the first non-zero holding formatted
// for display (registry order), or the zero STRK line when nothing is held;
// `funded` is true when any known token balance is non-zero. A failed read
// degrades both to null so the picker shows "checking"/"unavailable" rather
// than blocking or fabricating a value.
const ledgerAccountBalances = async (
  deps: WalletOpsDeps,
  address: string,
  networkId: StarknetNetworkId,
  rpcUrls: readonly string[],
): Promise<{ readonly balance: string | null; readonly funded: boolean | null }> => {
  const tokens = knownTokensForNetwork(networkId);
  if (tokens.length === 0) {
    return { balance: null, funded: null };
  }
  const balances = await deps.runtimeRpc.getTokenBalances({
    accountAddress: address,
    rpcUrls,
    tokens,
  });
  const held = balances.find((entry) => BigInt(entry.balance) > 0n);
  const shown = held ?? balances.find((entry) => entry.symbol === "STRK") ?? balances[0];
  return {
    balance: shown ? `${shown.formatted} ${shown.symbol}` : null,
    funded: held !== undefined,
  };
};

/**
 * Reads an address's deployed status and known-token balances on one network.
 * Never throws for an RPC failure: each half degrades to `null` on its own.
 */
export const readLedgerAccountState = async (
  deps: WalletOpsDeps,
  address: string,
  networkId: StarknetNetworkId,
): Promise<LedgerAccountState> => {
  const preferences = await deps.preferencesStore.read();
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[networkId], preferences);
  const [deployed, balances] = await Promise.all([
    deps.runtimeRpc.getDeploymentStatus({ accountAddress: address, rpcUrls }).catch(() => null),
    ledgerAccountBalances(deps, address, networkId, rpcUrls).catch(() => ({
      balance: null,
      funded: null,
    })),
  ]);
  return { balance: balances.balance, deployed, funded: balances.funded };
};

/**
 * Why the background refuses to store a Ledger account, as the stable raw
 * diagnostic the panel translates (friendly-error-copy), or null to proceed.
 * The two Braavos refusals stay distinct because the reader's move differs: a
 * key with no Braavos account has nothing to retry, an unreadable chain does.
 */
export type LedgerStoreRefusal = { readonly error: string } | null;

/**
 * Checks whether the background may store this Ledger account. Bramble never
 * creates a Braavos account, so a Braavos request passes only when its derived
 * address is proven active on chain — deployed, or funded in a known token, the
 * same rule the picker's `ledgerCandidateSelectable` applies. Fails closed:
 * - no or failing derivation refuses as `wallet unavailable`;
 * - an address read as neither deployed nor funded refuses as not found;
 * - a chain read that failed without proving activity refuses as unavailable.
 * Every other family passes unchecked (Argent's picker rule is unchanged).
 */
export const ledgerStoreRefusal = async (
  deps: WalletOpsDeps,
  input: AddLedgerAccountRequest,
): Promise<LedgerStoreRefusal> => {
  if (input.accountContractType !== "braavos") {
    return null;
  }
  const derive = deps.wallet.deriveLedgerAccounts;
  const account = derive
    ? await derive({
        accountContractType: input.accountContractType,
        ...(input.eip2645application === undefined
          ? {}
          : { eip2645application: input.eip2645application }),
        entries: [{ accountIndex: input.accountIndex, publicKeyX: input.publicKeyX }],
        networkId: input.networkId,
      }).then(
        ([derived]) => derived,
        () => undefined,
      )
    : undefined;
  if (!account) {
    return { error: "wallet unavailable" };
  }
  const state = await readLedgerAccountState(deps, account.address, input.networkId);
  if (state.deployed === true || state.funded === true) {
    return null;
  }
  // A network with no curated tokens has no balance to read, which is not a
  // failed read: there, a known-undeployed address is simply not in use.
  const funded = knownTokensForNetwork(input.networkId).length === 0 ? false : state.funded;
  return state.deployed === false && funded === false
    ? { error: "braavos ledger account not found" }
    : { error: "braavos ledger account status unavailable" };
};
