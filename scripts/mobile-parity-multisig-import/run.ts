/**
 * Runs one privileged multisig message per case through the background's own handler
 * (`handleMultisigTxOps`) in the case's wallet, and records the chain reads, the registry before
 * and after, and the response. Shared by the `import` and `signature` blocks.
 */
import type { ArgentMultisigSigningIntent } from "@bramble/multisig/repository";
import { handleMultisigTxOps } from "../../apps/extension/src/background/multisig/multisig-tx-ops";
import {
  type ChainReads,
  caseWallet,
  currentAuthority,
  NONCE,
  type Setup,
  type WalletOptions,
} from "./shared";

/** One message to the handler and the wallet it meets. */
export type HandlerCase = {
  readonly name: string;
  readonly message: unknown;
  /** The intent whose registry entry is recorded after the call. */
  readonly intentId: string;
  readonly reads?: Partial<ChainReads>;
  readonly stored?: ArgentMultisigSigningIntent;
  readonly wallet?: WalletOptions;
  /** Set where the extension's pinned answer differs from wallet-core's and awaits a decision. */
  readonly divergence?: string;
};

const plain = (value: unknown): unknown =>
  value === undefined ? null : (JSON.parse(JSON.stringify(value)) as unknown);

/** Every case of one message type, in order. */
export const runHandlerCases = async (
  setup: Setup,
  type: string,
  cases: readonly HandlerCase[],
): Promise<readonly object[]> => {
  const results = [];
  for (const item of cases) {
    const reads: ChainReads = {
      authority: currentAuthority(setup.record),
      nonce: NONCE,
      ...item.reads,
    };
    const { deps, store } = await caseWallet(setup, reads, item.wallet);
    if (item.stored && (await store.upsertIntent(item.stored)) !== "stored") {
      throw new Error(`${item.name}: the registry refused the stored intent`);
    }
    const response = await handleMultisigTxOps(deps, type, item.message);
    results.push({
      authority: reads.authority,
      ...(item.divergence ? { divergence: item.divergence } : {}),
      message: item.message,
      name: item.name,
      nonce: reads.nonce,
      response: plain(response),
      stored: plain(item.stored),
      // The registry itself, never a case's wrapper around it.
      storedAfter: plain(await store.getIntent(item.intentId)),
      wallet: {
        activeNetwork: item.wallet?.activeNetwork ?? "SN_SEPOLIA",
        locked: item.wallet?.locked ?? false,
        record:
          item.wallet?.record === undefined ? "fixture" : item.wallet.record ? "watched" : "none",
        storeAnswersAnotherTransaction: item.wallet?.store !== undefined,
      },
    });
  }
  return results;
};
