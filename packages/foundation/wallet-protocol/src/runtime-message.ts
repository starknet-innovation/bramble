/**
 * Background runtime messages reachable through the untrusted dapp provider
 * bridge. Keeping this union separate makes the capability surface easy to
 * compare with the enforced DAPP_MESSAGES allowlist.
 */
import type { Json } from "@mc-wallet/core/json";
import type { ProviderChain } from "./add-chain";
import type { ProviderDeclare } from "./declare";
import type { ProviderInvokeCall } from "./invoke";
import type { Strk20Action, Strk20Proof } from "./strk20-bridge";
import type { ProviderWatchAsset } from "./watch-asset";

/**
 * Exact extension messages the provider bridge may send to the background.
 */
export type RuntimeMessage =
  | {
      readonly origin: string;
      readonly type: "wallet.strk20Register";
    }
  | {
      readonly chain: ProviderChain;
      readonly origin: string;
      readonly type: "wallet.addStarknetChain";
    }
  | {
      readonly declare: ProviderDeclare;
      readonly origin: string;
      readonly type: "wallet.addDeclareTransaction";
    }
  | {
      readonly calls: readonly ProviderInvokeCall[];
      readonly origin: string;
      readonly proof?: Strk20Proof;
      readonly type: "wallet.addInvokeTransaction";
    }
  | {
      readonly apiVersion?: string;
      readonly origin: string;
      readonly type: "wallet.deploymentData";
    }
  | {
      readonly origin: string;
      readonly type: "wallet.getChainId";
    }
  | {
      readonly apiVersion?: string;
      readonly origin: string;
      readonly type: "wallet.supportedSpecs";
    }
  | {
      readonly apiVersion?: string;
      readonly origin: string;
      readonly type: "wallet.supportedWalletApi";
    }
  | {
      readonly origin: string;
      readonly type: "wallet.getGrantedAccounts";
    }
  | {
      readonly origin: string;
      readonly type: "wallet.getPermissions";
    }
  | {
      readonly origin: string;
      readonly silent?: boolean;
      readonly type: "wallet.requestAccounts";
    }
  | {
      readonly origin: string;
      readonly typedData: Json;
      readonly type: "wallet.signTypedData";
    }
  | {
      readonly origin: string;
      readonly tokens: readonly string[];
      readonly type: "wallet.strk20Balances";
    }
  | {
      readonly actions: readonly Strk20Action[];
      readonly origin: string;
      readonly simulate: boolean;
      readonly type: "wallet.strk20PrepareInvoke";
    }
  | {
      readonly actions: readonly Strk20Action[];
      readonly origin: string;
      readonly type: "wallet.strk20InvokeTransaction";
    }
  | {
      readonly dappName: string;
      readonly nonce?: string;
      readonly origin: string;
      readonly type: "wallet.strk20SubaccountCommitment";
    }
  | {
      readonly chainId: string;
      readonly origin: string;
      readonly type: "wallet.switchChain";
    }
  | {
      readonly asset: ProviderWatchAsset;
      readonly origin: string;
      readonly type: "wallet.watchAsset";
    };
