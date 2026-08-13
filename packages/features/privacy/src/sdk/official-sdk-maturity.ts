/**
 * Privacy proof maturity runtime. The official SDK proves against historical
 * state, so every prior write is accepted and then allowed to age beyond that
 * proving block before a dependent proof is created.
 */

import { WalletError } from "@mc-wallet/core/errors";
import { IndeterminateRpcWriteError, isTransportRpcError } from "@mc-wallet/starknet/provider";
import { canonicalFelt, isNonZeroStarkFieldElement } from "@mc-wallet/wallet-model/networks";
import type { RpcProvider } from "starknet";
import {
  memoryStrk20MaturityStore,
  type Strk20MaturityScope,
  type Strk20MaturityStore,
} from "../policy/maturity";
import { STRK20_SERVICE_UNAVAILABLE } from "../service";

const PROVING_BLOCK_DEPTH = 10;
const MAX_MATURITY_POLLS = 120;
const ACCEPTANCE_RETRIES = 240;
const ACCEPTANCE_LIFECYCLE_RETRIES = 120;

class RejectedPrivacyTransaction extends Error {}

type MaturityRuntimeOptions = {
  readonly pause?: () => Promise<void>;
  readonly store?: Strk20MaturityStore;
  readonly waitForAccepted?: (provider: RpcProvider, transactionHash: string) => Promise<number>;
};

const defaultPause = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 1_000);
  });

const defaultWaitForAccepted = async (
  provider: RpcProvider,
  transactionHash: string,
): Promise<number> => {
  const receipt = await provider.waitForTransaction(transactionHash, {
    lifeCycleRetries: ACCEPTANCE_LIFECYCLE_RETRIES,
    retries: ACCEPTANCE_RETRIES,
    retryInterval: 250,
  });
  if (!receipt.isSuccess()) {
    throw new RejectedPrivacyTransaction();
  }
  if (!Number.isSafeInteger(receipt.block_number)) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  return receipt.block_number;
};

/**
 * Receipt and proving-block coordinator used by one SDK service instance.
 */
export type Strk20MaturityRuntime = {
  readonly provingBlock: (
    provider: RpcProvider,
    scope: Strk20MaturityScope,
    isHistoricalStateReady?: (block: number) => Promise<boolean>,
  ) => Promise<number>;
  readonly recordSubmission: (
    provider: RpcProvider,
    scope: Strk20MaturityScope,
    transactionHash: string,
  ) => Promise<void>;
  readonly submitAccepted: <P, T extends { readonly transactionHash: string }>(
    provider: RpcProvider,
    scope: Strk20MaturityScope,
    prepare: () => Promise<P>,
    broadcast: (prepared: P) => Promise<T>,
  ) => Promise<T>;
};

/**
 * Creates the accepted-receipt and historical-state readiness coordinator.
 */
export const createStrk20MaturityRuntime = ({
  pause = defaultPause,
  store = memoryStrk20MaturityStore(),
  waitForAccepted = defaultWaitForAccepted,
}: MaturityRuntimeOptions = {}): Strk20MaturityRuntime => {
  const submissionTails = new Map<string, Promise<void>>();
  const scopeKey = (scope: Strk20MaturityScope): string =>
    `${scope.accountId}|${scope.networkId}|${canonicalFelt(scope.poolAddress) ?? scope.poolAddress}`;
  const serializeSubmission = <T>(
    scope: Strk20MaturityScope,
    operation: () => Promise<T>,
  ): Promise<T> => {
    const key = scopeKey(scope);
    const previous = submissionTails.get(key) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    submissionTails.set(key, tail);
    void tail.then(() => {
      if (submissionTails.get(key) === tail) {
        submissionTails.delete(key);
      }
    });
    return result;
  };
  const acceptedBlock = async (
    provider: RpcProvider,
    scope: Strk20MaturityScope,
    transactionHash: string,
  ): Promise<number> => {
    const block = await waitForAccepted(provider, transactionHash);
    if (!Number.isSafeInteger(block) || block < 0) {
      throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
    }
    await store.write(scope, {
      acceptedBlock: block,
      state: "submitted",
      transactionHash,
    });
    return block;
  };

  const priorAcceptedBlock = async (
    provider: RpcProvider,
    scope: Strk20MaturityScope,
  ): Promise<number | undefined> => {
    const record = await store.read(scope);
    if (!record) {
      return undefined;
    }
    if (record.state === "submitting") {
      throw new WalletError(
        `${STRK20_SERVICE_UNAVAILABLE}: submission status is unknown; close every browser window and reopen the browser to recover`,
      );
    }
    if (record.acceptedBlock !== undefined) {
      return record.acceptedBlock;
    }
    try {
      return await acceptedBlock(provider, scope, record.transactionHash);
    } catch (error) {
      if (error instanceof RejectedPrivacyTransaction) {
        await store.write(scope, null);
      }
      throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
    }
  };

  const provingBlock = async (
    provider: RpcProvider,
    scope: Strk20MaturityScope,
    isHistoricalStateReady?: (block: number) => Promise<boolean>,
  ): Promise<number> => {
    const priorBlock = await priorAcceptedBlock(provider, scope);
    for (let attempt = 0; attempt <= MAX_MATURITY_POLLS; attempt += 1) {
      const latest = await provider.getBlockNumber();
      const candidate = Math.max(0, latest - PROVING_BLOCK_DEPTH);
      if (
        (priorBlock === undefined || priorBlock < candidate) &&
        (!isHistoricalStateReady || (await isHistoricalStateReady(candidate)))
      ) {
        return candidate;
      }
      if (attempt === MAX_MATURITY_POLLS) {
        break;
      }
      await pause();
    }
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  };
  const recordSubmission = async (
    provider: RpcProvider,
    scope: Strk20MaturityScope,
    transactionHash: string,
  ): Promise<void> => {
    if (!isNonZeroStarkFieldElement(transactionHash)) {
      throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
    }
    await store.write(scope, { state: "submitted", transactionHash });
    try {
      await acceptedBlock(provider, scope, transactionHash);
    } catch (error) {
      if (error instanceof RejectedPrivacyTransaction) {
        await store.write(scope, null);
      }
      throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
    }
  };
  const submitPreparedAccepted = <P, T extends { readonly transactionHash: string }>(
    provider: RpcProvider,
    scope: Strk20MaturityScope,
    prepare: () => Promise<P>,
    broadcast: (prepared: P) => Promise<T>,
  ): Promise<T> =>
    serializeSubmission(scope, async () => {
      const prepared = await prepare();
      const previous = await store.read(scope);
      await store.write(scope, { state: "submitting" });
      // A structured RPC rejection is determinate: the sequencer refused the
      // transaction, so no write is in flight and the scope must be released or
      // every later attempt on it fails with a stale `submitting` guard.
      // Transport and unknown failures stay indeterminate — the transaction may
      // have been accepted after the response was lost — so those keep the scope
      // closed rather than risk proving against state a landed write invalidates.
      const result = await broadcast(prepared).catch(async (error: unknown) => {
        if (!(error instanceof IndeterminateRpcWriteError) && !isTransportRpcError(error)) {
          await store.write(scope, previous);
        }
        throw error;
      });
      await recordSubmission(provider, scope, result.transactionHash);
      return result;
    });

  return {
    provingBlock,
    recordSubmission,
    submitAccepted: submitPreparedAccepted,
  };
};
