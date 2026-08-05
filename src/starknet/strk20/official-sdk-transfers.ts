/**
 * Constructs the official SDK private-transfers session for one account
 * context: CallSet signing stays delegated to the wallet's Krusty boundary,
 * discovery/proving are routed only to the reviewed per-network service
 * configuration, and a missing config or RPC URL fails closed.
 */

import type { Signature } from "starknet";
import { WalletError } from "../../shared/errors";
import { STARKNET_NETWORKS } from "../networks";
import { Strk20CallSetSigner } from "./call-set-signer";
import type { PrivacySdkRuntime, SdkTransfers } from "./official-sdk-runtime";
import { requireStrk20Config } from "./official-sdk-values";
import { STRK20_SERVICE_UNAVAILABLE, type Strk20AccountContext } from "./service";

const signatureFor = async (
  context: Strk20AccountContext,
  messageHash: string,
): Promise<Signature> => {
  const signature = await context.signHash(messageHash);
  return [signature.r, signature.s];
};

/**
 * Builds the SDK transfers session for the context's account and network
 * configuration. Throws {@link WalletError} when the config, RPC URL, or the
 * SDK's OHTTP support required by the config is missing.
 */
export const transfersFor = (
  sdk: PrivacySdkRuntime,
  context: Strk20AccountContext,
): SdkTransfers => {
  const config = requireStrk20Config(context);
  const chainId = STARKNET_NETWORKS[context.account.networkId].chainId;
  const nodeUrl = context.rpcUrls[0];
  if (!nodeUrl) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  const signer = new Strk20CallSetSigner({
    accountAddress: context.account.address,
    chainId,
    sign: (messageHash) => signatureFor(context, messageHash),
  });
  const ohttp =
    config.ohttpEnabled || config.ohttpRelayUrl
      ? config.ohttpRelayUrl
        ? { relayUrl: config.ohttpRelayUrl }
        : true
      : undefined;
  if (ohttp && !sdk.IndexerDiscoveryProvider) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  const discoveryProvider =
    ohttp && sdk.IndexerDiscoveryProvider
      ? new sdk.IndexerDiscoveryProvider(config.discoveryUrl, config.poolAddress, { ohttp })
      : { url: config.discoveryUrl };
  return sdk.createPrivateTransfers({
    account: { address: context.account.address, signer },
    discoveryProvider,
    poolContractAddress: config.poolAddress,
    provingProvider: {
      chainId,
      nodeUrl,
      ...(ohttp ? { ohttp } : {}),
      url: config.proverUrl,
    },
    ...(config.subaccountAnonymizerAddress
      ? { subAccountAnonymizerAddress: config.subaccountAnonymizerAddress }
      : {}),
    viewingKeyProvider: {
      async getViewingKey() {
        return context.viewingKey();
      },
    },
  });
};
