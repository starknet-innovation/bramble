/**
 * Fully-wired background handler for the enforced key-boundary scan.
 *
 * The scan is only worth anything if each catalog entry reaches a handler that
 * really runs, so this harness supplies every collaborator the router would
 * otherwise fall back to an unavailable default for: a real in-memory
 * preferences store, allowance log, multisig registry, approval queue, Ledger
 * sign queue, swap aggregator, and STRK20 service. The stub vault is salted with
 * the recognizable secrets the scan greps for, and the STRK20 service double
 * asks the background for the account-scoped viewing key on every call whose
 * real implementation would — so those handlers really hold the salted secret
 * while they build their response, and a leak is caught rather than passing
 * because the handler never got that far.
 *
 * Nothing here weakens a boundary: the handler under test is the production
 * `createMessageHandler`, and every stub answers with well-formed data instead
 * of granting an authority the real collaborator would not.
 */

import type { ArgentMultisigSigningIntent } from "@bramble/multisig/repository";
import { memoryMultisigStore } from "@bramble/multisig/repository";
import { DEFAULT_STRK20_NETWORKS } from "@bramble/privacy/config";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { type FeeEstimate, sumFeeEstimates } from "@bramble/starknet/fee-bounds";
import { createMemoryStore } from "@bramble/store/kv";
import { memoryAllowanceStore } from "@bramble/transactions/allowance-store";
import { ec } from "starknet";
import { createApprovalQueue } from "../../apps/extension/src/background/approvals/approvals";
import { createLedgerSignQueue } from "../../apps/extension/src/background/ledger/ledger-sign-queue";
import type {
  ArgentMultisigDeploymentReview,
  ArgentMultisigIntentPackage,
} from "../../apps/extension/src/background/multisig/multisig-inputs";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../apps/extension/src/background/routing/senders";
import {
  createUnlockSession,
  type UnlockSession,
} from "../../apps/extension/src/background/runtime/session";
import { isFeeReviewResponse } from "../../packages/presentation/wallet-ui/src/popup/responses/responses";
import { testExtension } from "./background-wallet-stub";
import { flushHeld, latestApprovalId, reviewedApprovalFee } from "./held";
import {
  ETH,
  makeChainState,
  runtimeRpcFor,
  SPENDER,
  STRK,
  swapService,
  walletStub,
} from "./key-boundary-collaborators";
import {
  account,
  extensionSender,
  KEY_BOUNDARY_MULTISIG,
  KEY_BOUNDARY_MULTISIG_CONFIG,
  KEY_BOUNDARY_NFT_CONTRACT,
  KEY_BOUNDARY_ORIGIN,
  KEY_BOUNDARY_RECIPIENT,
  SECRET_PASSPHRASE,
  SECRET_PRIVATE_KEY,
} from "./key-boundary-fixtures";
import type { KeyBoundaryLiveIds } from "./key-boundary-types";
import { awaitStrk20Job, strk20RunningJobId } from "./strk20-background";

/**
 * The wired handler plus the live identifiers and session controls the scan
 * needs. `settle` drives a request to completion, approving only the approvals
 * that request itself queued, so pre-seeded prompts are left untouched.
 */
export type KeyBoundaryHarness = {
  readonly handler: ReturnType<typeof createMessageHandler>;
  readonly liveIds: KeyBoundaryLiveIds;
  readonly session: UnlockSession;
  readonly settle: (message: Record<string, unknown>, sender: RuntimeSender) => Promise<unknown>;
  readonly unlock: () => void;
};

// A held dapp promise that is deliberately left unanswered (the fee-retry
// fixture) or that gets denied still settles eventually; attaching the handler
// here stops that rejection from surfacing as an unhandled one and failing an
// unrelated test in the same file.
const park = (held: Promise<unknown>): void => {
  held.catch(() => undefined);
};

const declarationReviewedFee = (declaration: {
  readonly deploymentFee?: FeeEstimate | null;
  readonly fee?: FeeEstimate | null;
}): FeeEstimate | null => {
  const fee = declaration.fee ?? null;
  const deployment = declaration.deploymentFee ?? null;
  return fee && deployment ? sumFeeEstimates(fee, deployment) : fee;
};

/**
 * Builds the key-boundary handler and seeds every store the catalog reads back
 * from. `unlocked: false` leaves the session locked for the reveal-gate tests.
 *
 * `session` replaces the default unlock session, so a suite that needs to watch
 * how handlers read it — a fake clock, or a wrapper counting renewals against
 * peeks (tests/background/panel-poll-unlock-window.test.ts) — drives the same
 * fully wired handler instead of standing up a second, thinner one. It must
 * accept {@link SECRET_PASSPHRASE}, which is what `unlock` hands it.
 */
export const makeKeyBoundaryHarness = async (
  options: { readonly session?: UnlockSession; readonly unlocked?: boolean } = {},
): Promise<KeyBoundaryHarness> => {
  const session = options.session ?? createUnlockSession();
  const unlock = (): void => {
    session.unlock(SECRET_PASSPHRASE);
  };
  // Seeding writes through the same locked-down handlers the scan drives, so it
  // needs the session open; a harness asked for a locked wallet is re-locked
  // once the seed is in place.
  unlock();
  const chainState = makeChainState();
  const approvals = createApprovalQueue();
  const ledgerSignQueue = createLedgerSignQueue();
  const allowanceStore = memoryAllowanceStore();
  const multisigStore = memoryMultisigStore();
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  const handler = createMessageHandler(walletStub, testExtension, {
    allowanceStore,
    approvals,
    ledgerSignQueue,
    multisigStore,
    preferencesStore,
    runtimeRpc: runtimeRpcFor(chainState),
    session,
    swap: swapService,
  });

  const settle = async (
    message: Record<string, unknown>,
    sender: RuntimeSender,
  ): Promise<unknown> => {
    const known = new Set(approvals.list().map((approval) => approval.id));
    const held = handler(message, sender);
    const outcome = held.then(
      (value) => ({ ok: true as const, value }),
      (cause: unknown) => ({ cause, ok: false as const }),
    );
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const raced = await Promise.race([outcome, flushHeld().then(() => null)]);
      if (raced !== null) {
        if (!raced.ok) {
          throw raced.cause;
        }
        if (isFeeReviewResponse(raced.value)) {
          return settle({ ...message, reviewedFee: raced.value.feeReview }, sender);
        }
        return raced.value;
      }
      for (const approval of approvals.list()) {
        if (!known.has(approval.id)) {
          let reviewedFee: FeeEstimate | null = declarationReviewedFee(approval.declaration ?? {});
          if (approval.kind === "invoke") {
            // This scan also exercises counterfactual deployment data, so the
            // shared chain starts undeployed. Model its deployment before the
            // invoke's explicit retry; only a priced card may be approved.
            const wasDeployed = chainState.accountDeployed;
            try {
              chainState.accountDeployed = true;
              await handler({ id: approval.id, type: "wallet.retryApprovalFee" }, extensionSender);
              reviewedFee = await reviewedApprovalFee(handler, extensionSender, approval.id);
            } finally {
              chainState.accountDeployed = wasDeployed;
            }
          }
          await handler(
            {
              id: approval.id,
              ...(reviewedFee ? { reviewedFee } : {}),
              type: "wallet.approveOrigin",
            },
            extensionSender,
          );
        }
      }
    }
    throw new Error(`wallet message did not settle: ${String(message["type"] ?? "unknown")}`);
  };

  const seeded = await seedStores({ allowanceStore, preferencesStore });
  const multisig = await seedArgentMultisig(settle);
  let connectOrigins = 0;

  const liveIds: KeyBoundaryLiveIds = {
    addressBookId: seeded.addressBookId,
    allowanceId: seeded.allowanceId,
    async connectApprovalId() {
      connectOrigins += 1;
      park(
        handler(
          { origin: `https://connect-${connectOrigins}.example`, type: "wallet.requestAccounts" },
          { id: "extension-id", url: `https://connect-${connectOrigins}.example/app` },
        ),
      );
      await flushHeld();
      return latestApprovalId(handler, extensionSender);
    },
    groupId: seeded.groupId,
    async invokeApprovalId() {
      park(
        handler(
          {
            calls: [{ calldata: ["0x1"], contractAddress: ETH.address, entrypoint: "transfer" }],
            origin: KEY_BOUNDARY_ORIGIN,
            type: "wallet.addInvokeTransaction",
          },
          { id: "extension-id", url: `${KEY_BOUNDARY_ORIGIN}/swap` },
        ),
      );
      await flushHeld();
      return latestApprovalId(handler, extensionSender);
    },
    async ledgerSignId() {
      park(
        ledgerSignQueue.request({
          accountId: account.id,
          messageHash: "0x9",
          path: "m/2645'/1195502025'/1148870696'/0'/0'/0",
          publicKeyX: account.publicKeyX,
        }),
      );
      const parked = ledgerSignQueue.pending().at(-1)?.id;
      if (!parked) {
        throw new Error("ledger sign was not parked");
      }
      return parked;
    },
    multisigDeploymentReview: async () => {
      const response = (await settle(
        {
          networkId: "SN_MAIN",
          salt: "0x9",
          signerAccountId: account.id,
          ...KEY_BOUNDARY_MULTISIG_CONFIG,
          type: "wallet.reviewArgentMultisigDeployment",
        },
        extensionSender,
      )) as { readonly deploymentReview?: ArgentMultisigDeploymentReview };
      if (!response.deploymentReview) throw new Error("deployment review was not prepared");
      return response.deploymentReview;
    },
    multisigId: multisig.multisigId,
    multisigIntentPackage: multisig.intentPackage,
    multisigSignatureImport: multisig.signatureImport,
    multisigSignIntentId: multisig.signIntentId,
    multisigSubmitIntentId: multisig.submitIntentId,
    nftId: seeded.nftId,
    async strk20PreparationId() {
      return preparationIdOf(
        await settle(
          {
            amount: "1",
            recipient: KEY_BOUNDARY_RECIPIENT,
            tokenId: ETH.id,
            type: "wallet.strk20PrepareTransfer",
          },
          extensionSender,
        ),
        "strk20Preparation",
      );
    },
    async strk20PreparationJobId() {
      const started = await settle(
        {
          amount: "1",
          recipient: KEY_BOUNDARY_RECIPIENT,
          tokenId: ETH.id,
          type: "wallet.strk20PrepareDeposit",
        },
        extensionSender,
      );
      const jobId = strk20RunningJobId(started);
      if (jobId === null) {
        throw new Error(`shield did not start a job: ${JSON.stringify(started)}`);
      }
      // Settled before the poll under scan runs, so that poll answers with the
      // job's outcome; the liveness test is what refuses an outcome that is an
      // error rather than the review.
      await awaitStrk20Job(settle, started, extensionSender);
      return jobId;
    },
    async swapPreparationId() {
      return preparationIdOf(
        await settle(
          {
            amount: "0.01",
            buyAmount: "12.5",
            buyTokenId: STRK.id,
            quoteId: "dae4e180-e2cb-49f4-bd91-6f3de3a0c3ca",
            sellTokenId: ETH.id,
            type: "wallet.swapPrepare",
          },
          extensionSender,
        ),
        "swapPreparation",
      );
    },
    async removableTokenId() {
      const preferences = await preferencesStore.upsertToken(
        {
          address: "0x0123456789abcdef",
          decimals: 6,
          name: "Removable Token",
          networkId: "SN_MAIN",
          symbol: "RMV",
        },
        "dapp",
      );
      const id = preferences.tokens.at(-1)?.id;
      if (!id) throw new Error("removable token was not stored");
      return id;
    },
    tokenId: ETH.id,
    unregisterStrk20Account() {
      chainState.strk20Registered = false;
    },
  };

  if (options.unlocked === false) {
    session.lock();
  }
  return { handler, liveIds, session, settle, unlock };
};

// A preparation answers with its one-time record nested under a per-flow key;
// the id inside it is what the matching execute message must quote.
const preparationIdOf = (response: unknown, key: string): string => {
  const record = (response as Record<string, unknown>)[key];
  const id = (record as { readonly id?: unknown } | undefined)?.id;
  if (typeof id !== "string") {
    throw new Error(`preparation did not return an id: ${JSON.stringify(response)}`);
  }
  return id;
};

type SeededIds = {
  readonly addressBookId: string;
  readonly allowanceId: string;
  readonly groupId: string;
  readonly nftId: string;
};

// Records the catalog reads back by id. Written through the same stores the
// router holds, so an id the scan sends is one the handler can really find.
const seedStores = async (stores: {
  readonly allowanceStore: ReturnType<typeof memoryAllowanceStore>;
  readonly preferencesStore: ReturnType<typeof createPreferencesStore>;
}): Promise<SeededIds> => {
  await stores.allowanceStore.record({
    accountId: account.id,
    amount: "1000",
    networkId: "SN_MAIN",
    spender: SPENDER,
    token: ETH.address,
  });
  const allowance = (await stores.allowanceStore.list()).at(0);
  const contacts = await stores.preferencesStore.saveAddress({
    address: account.address,
    label: "Me",
    networkId: "SN_MAIN",
  });
  const withNft = await stores.preferencesStore.addNft({
    contract: KEY_BOUNDARY_NFT_CONTRACT,
    networkId: "SN_MAIN",
    tokenId: "1",
  });
  const withGroup = await stores.preferencesStore.createGroup({ icon: "folder", name: "Trading" });
  // The opt-in SDK shadow account module, so the commitment entry reaches the
  // viewing key instead of stopping at the pre-approval anonymizer check.
  const mainnet = DEFAULT_STRK20_NETWORKS.SN_MAIN;
  if (!mainnet) throw new Error("key-boundary harness needs the bundled Mainnet STRK20 config");
  await stores.preferencesStore.setStrk20NetworkConfig({
    config: { ...mainnet, subaccountAnonymizerAddress: "0x2" },
    networkId: "SN_MAIN",
  });
  const addressBookId = contacts.addressBook.at(-1)?.id;
  const groupId = withGroup.groups?.at(-1)?.id;
  const nftId = withNft.nfts?.at(-1)?.id;
  if (!allowance || !addressBookId || !groupId || !nftId) {
    throw new Error("key-boundary harness failed to seed its preference records");
  }
  return { addressBookId, allowanceId: allowance.id, groupId, nftId };
};

type SeededArgentMultisig = {
  readonly intentPackage: ArgentMultisigIntentPackage;
  readonly multisigId: string;
  readonly signatureImport: KeyBoundaryLiveIds["multisigSignatureImport"];
  readonly signIntentId: string;
  readonly submitIntentId: string;
};

const preparedIntent = async (
  settle: KeyBoundaryHarness["settle"],
  marker: number,
): Promise<{
  readonly intent: ArgentMultisigSigningIntent;
  readonly package: ArgentMultisigIntentPackage;
}> => {
  const response = (await settle(
    {
      calls: [
        {
          calldata: [`0x${marker.toString(16)}`],
          contractAddress: account.address,
          entrypoint: "transfer",
        },
      ],
      multisigId: `SN_MAIN:${KEY_BOUNDARY_MULTISIG}`,
      type: "wallet.prepareArgentMultisigIntent",
    },
    extensionSender,
  )) as {
    readonly intent?: ArgentMultisigSigningIntent;
    readonly intentPackage?: ArgentMultisigIntentPackage;
  };
  if (!response.intent || !response.intentPackage)
    throw new Error("Argent intent was not prepared");
  return { intent: response.intent, package: response.intentPackage };
};

// Seeds distinct exact hashes for local sign, imported fragment, full package,
// and submit so durable per-signer claims cannot make one catalog entry shadow
// another.
const seedArgentMultisig = async (
  settle: KeyBoundaryHarness["settle"],
): Promise<SeededArgentMultisig> => {
  await settle(
    {
      address: KEY_BOUNDARY_MULTISIG,
      networkId: "SN_MAIN",
      type: "wallet.addMultisig",
    },
    extensionSender,
  );
  const multisigId = `SN_MAIN:${KEY_BOUNDARY_MULTISIG}`;
  const signing = await preparedIntent(settle, 1);
  const importing = await preparedIntent(settle, 2);
  const packaged = await preparedIntent(settle, 3);
  const submitting = await preparedIntent(settle, 4);
  const raw = ec.starkCurve.sign(importing.intent.prepared.transactionHash, SECRET_PRIVATE_KEY);
  const signatureImport = {
    intentId: importing.intent.id,
    signature: {
      publicKey: account.publicKeyX,
      r: `0x${raw.r.toString(16)}`,
      s: `0x${raw.s.toString(16)}`,
    },
  };
  const signed = (await settle(
    {
      intentId: submitting.intent.id,
      signerAccountId: account.id,
      type: "wallet.signArgentMultisigIntent",
    },
    extensionSender,
  )) as { readonly intent?: ArgentMultisigSigningIntent };
  if (signed.intent?.state !== "ready") throw new Error("Argent submit intent was not signed");
  return {
    intentPackage: packaged.package,
    multisigId,
    signatureImport,
    signIntentId: signing.intent.id,
    submitIntentId: signed.intent.id,
  };
};
