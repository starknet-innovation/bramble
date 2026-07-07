/**
 * NFT gallery operations dispatched from the background message handler: watch
 * a collectible after proving on-chain ownership, and send one through the
 * verification + invoke path. Removing and spam-hiding watched NFTs are plain
 * preference mutations handled in preference-ops.ts.
 */
import { STARKNET_NETWORKS } from "../starknet/networks";
import { buildErc721TransferCall } from "../starknet/nft";
import { verifyCalls } from "../starknet/verify";
import { readAddNftInput, readTransferNftInput } from "./nft-inputs";
import { activeAccountContext, networkRpcUrls } from "./runtime-state";
import type { RuntimeResponse } from "./runtime-types";
import { signerForContext, verificationContext, type WalletOpsDeps } from "./wallet-ops";

/**
 * Handles NFT gallery messages; returns null for other message types.
 */
export const handleNftOps = async (
  deps: WalletOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  if (messageType === "wallet.addNft") {
    const input = readAddNftInput(message);
    if (!input) {
      return { error: "invalid add nft request" };
    }
    const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
    if (context.error !== undefined) {
      return { error: context.error };
    }
    if (input.networkId !== context.networkId) {
      return { error: "switch to the NFT's network first" };
    }
    const preferences = await deps.preferencesStore.read();
    const owner = await deps.runtimeRpc.getNftOwner({
      contractAddress: input.contract,
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences),
      tokenId: input.tokenId,
    });
    if (BigInt(owner) !== BigInt(context.account.address)) {
      return { error: "this account does not own that NFT" };
    }
    return {
      ok: true,
      preferences: await deps.preferencesStore.addNft({
        contract: input.contract,
        ...(input.label === undefined ? {} : { label: input.label }),
        networkId: input.networkId,
        tokenId: input.tokenId,
      }),
    };
  }

  if (messageType === "wallet.transferNft") {
    const input = readTransferNftInput(message);
    if (!input) {
      return { error: "invalid transfer nft request" };
    }
    const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
    if (context.error !== undefined) {
      return { error: context.error };
    }
    if (input.networkId !== context.networkId) {
      return { error: "switch to the NFT's network first" };
    }
    const preferences = await deps.preferencesStore.read();
    const call = buildErc721TransferCall(
      input.contract,
      context.account.address,
      input.recipient,
      BigInt(input.tokenId),
    );
    const report = verifyCalls([call], verificationContext(context.account, preferences));
    const result = await deps.runtimeRpc.submitInvokeTransaction({
      account: context.account,
      calls: [call],
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences),
      signHash: signerForContext(deps, context),
    });
    await deps.activity.record({
      accountId: context.account.id,
      hash: result.transactionHash,
      kind: "invoke",
      networkId: context.networkId,
      summary: report.calls[0]?.summary ?? `Send NFT #${input.tokenId}`,
    });
    return { ok: true, transactionHash: result.transactionHash };
  }

  return null;
};
