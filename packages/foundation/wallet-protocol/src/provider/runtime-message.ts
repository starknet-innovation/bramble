/**
 * Background runtime messages reachable through the untrusted dapp provider
 * bridge. Keeping this union separate makes the capability surface easy to
 * compare with the enforced DAPP_MESSAGES allowlist.
 */
import type { Json } from "@bramble/core/json";
import type { Strk20Action, Strk20Proof } from "../privacy/strk20-bridge";
import type { ProviderChain } from "../transactions/add-chain";
import type { ProviderDeclare } from "../transactions/declare";
import type { ProviderInvokeCall } from "../transactions/invoke";
import type { ProviderWatchAsset } from "../transactions/watch-asset";

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
      readonly type: "wallet.strk20ShadowAccountCommitment";
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
