/**
 * The `import` block: a co-signer's package handed to the background's own
 * `wallet.importArgentMultisigIntent` handler (`importIntent` in `multisig-tx-ops.ts`, reached
 * through the exported `handleMultisigTxOps`), with what the chain answered (authority and nonce),
 * the intent the registry held before, the response (`intent`, `intentPackage`, `feeReview`, or
 * the refusal) and what the registry holds after.
 */
import type { MultisigStore } from "@bramble/multisig/repository";
import { argentMultisigIntentPackage } from "../../apps/extension/src/background/multisig/multisig-inputs";
import { CONTACT, RECIPIENT } from "../mobile-parity-calls/shared";
import { lookalike, signerChangeCall, transferTo } from "./review";
import { type HandlerCase, runHandlerCases } from "./run";
import { currentAuthority, intentFor, type Setup, withSignatures } from "./shared";

const TYPE = "wallet.importArgentMultisigIntent";

type Case = Omit<HandlerCase, "intentId" | "message"> & {
  /** The message's `package`, or the whole message when `message` is set. */
  readonly package?: unknown;
  readonly message?: unknown;
};

const envelope = (intent: unknown) => ({
  intent,
  kind: "bramble.argent-multisig-intent",
  version: 1,
});

/** The intents the cases are built from: a transfer to the contact, unsigned to fully signed. */
export const intents = async (setup: Setup) => {
  const proposal = await intentFor(setup, [transferTo(CONTACT)], []);
  const signed = (indexes: readonly number[]) => withSignatures(setup, proposal, indexes);
  const ready = await signed([1, 2]);
  return {
    byMember0: await signed([0]),
    byMember1: await signed([1]),
    byMember2: await signed([2]),
    change: await intentFor(setup, [signerChangeCall(setup, "changeThreshold")], []),
    other: await intentFor(setup, [transferTo(RECIPIENT)], []),
    poisoned: await intentFor(setup, [transferTo(lookalike(CONTACT))], []),
    proposal,
    ready,
    submitted: {
      ...ready,
      broadcastTransactionHash: ready.prepared.transactionHash,
      state: "submitted" as const,
    },
  };
};

const cases = async (setup: Setup): Promise<readonly Case[]> => {
  const i = await intents(setup);
  const authority = currentAuthority(setup.record);
  const { currentConfig: _config, deployment: _deployment, ...watched } = setup.record;
  const otherTransaction = (store: MultisigStore): MultisigStore => ({
    ...store,
    getIntent: async () => ({ ...i.other, id: i.proposal.id }),
  });
  return [
    { name: "a proposal with no signatures", package: envelope(i.proposal) },
    { name: "one co-signature", package: envelope(i.byMember1) },
    { name: "a ready package", package: envelope(i.ready) },
    {
      name: "the nonce read in a padded spelling",
      package: envelope(i.byMember1),
      reads: { nonce: "0x05" },
    },
    {
      name: "a remote summary is replaced by the wallet's review",
      package: envelope({ ...i.byMember1, summary: "Harmless note" }),
    },
    {
      name: "a threshold the chain no longer has",
      package: envelope(i.byMember1),
      reads: { authority: { ...authority, threshold: 3 } },
    },
    {
      name: "a signer set the chain no longer has",
      package: envelope(i.byMember1),
      reads: {
        authority: { ...authority, signerGuids: authority.signerGuids.slice(1), threshold: 2 },
      },
    },
    {
      name: "another account class",
      package: envelope(i.byMember1),
      reads: { authority: { ...authority, classHash: "0x1234" } },
    },
    {
      name: "the authority read fails",
      package: envelope(i.byMember1),
      reads: { authority: { error: "RPC unavailable" } },
    },
    {
      name: "the chain nonce moved past the intent",
      package: envelope(i.byMember1),
      reads: { nonce: "0x6" },
    },
    {
      name: "the chain nonce behind the intent",
      package: envelope(i.byMember1),
      reads: { nonce: "0x4" },
    },
    { name: "the call review refuses a poisoned recipient", package: envelope(i.poisoned) },
    { name: "a signer change", package: envelope(i.change) },
    {
      name: "a signer change for a watch with no public config",
      package: envelope(i.change),
      wallet: { record: watched },
    },
    {
      name: "a stored intent under the id froze another transaction",
      package: envelope(i.byMember1),
      wallet: { store: otherTransaction },
    },
    {
      divergence:
        "The extension merges and keeps the stored threshold-3 snapshot although the chain reports threshold 2; wallet-core refuses with Conflict.",
      name: "a stored intent with another config snapshot",
      package: envelope(i.byMember1),
      stored: { ...i.proposal, configSnapshot: { ...i.proposal.configSnapshot, threshold: 3 } },
    },
    {
      name: "a co-signature added to the local one",
      package: envelope(i.byMember2),
      stored: i.byMember1,
    },
    {
      name: "a complete package over the same partial",
      package: envelope(i.ready),
      stored: i.byMember1,
    },
    {
      name: "a complete package over a different partial (Bramble #1003)",
      package: envelope(i.ready),
      stored: i.byMember0,
    },
    {
      name: "a partial package over a ready local intent",
      package: envelope(i.byMember1),
      stored: i.ready,
    },
    {
      name: "a package over a submitted local intent",
      package: envelope(i.ready),
      stored: i.submitted,
    },
    {
      name: "a package over a stale local intent",
      package: envelope(i.ready),
      stored: { ...i.byMember1, staleReason: "nonce", state: "stale" },
    },
    {
      name: "the local summary is kept",
      package: envelope(i.byMember2),
      stored: { ...i.byMember1, summary: "Local summary" },
    },
    { name: "a remote submitted claim", package: envelope(i.submitted) },
    { name: "a remote accepted claim", package: envelope({ ...i.submitted, state: "accepted" }) },
    {
      name: "a remote stale claim with its reason and outcome",
      package: envelope({
        ...i.byMember1,
        staleOutcome: "reverted",
        staleReason: "config",
        state: "stale",
      }),
    },
    {
      name: "a remote ready claim below the threshold",
      package: envelope({ ...i.byMember1, state: "ready" }),
    },
    {
      name: "explicit null broadcastTransactionHash",
      package: envelope({ ...i.byMember1, broadcastTransactionHash: null }),
    },
    { name: "explicit null staleReason", package: envelope({ ...i.byMember1, staleReason: null }) },
    {
      name: "explicit null staleOutcome",
      package: envelope({ ...i.byMember1, staleOutcome: null }),
    },
    {
      name: "explicit null proofFacts",
      package: envelope({
        ...i.byMember1,
        prepared: { ...i.byMember1.prepared, proofFacts: null },
      }),
    },
    { name: "another package kind", package: { ...envelope(i.byMember1), kind: "bramble.other" } },
    { name: "package version 2", package: { ...envelope(i.byMember1), version: 2 } },
    { name: "an unknown package key", package: { ...envelope(i.byMember1), note: "hi" } },
    {
      name: "an unknown message key",
      message: { origin: "x", package: envelope(i.byMember1), type: TYPE },
    },
    { name: "a locked wallet", package: envelope(i.byMember1), wallet: { locked: true } },
    {
      name: "another active network",
      package: envelope(i.byMember1),
      wallet: { activeNetwork: "SN_MAIN" },
    },
    {
      name: "a multisig this wallet does not hold",
      package: envelope(i.byMember1),
      wallet: { record: null },
    },
    {
      name: "a package straight from argentMultisigIntentPackage",
      package: argentMultisigIntentPackage({ ...i.byMember1, staleReason: "fee" }),
    },
  ];
};

/** Every import case, run through the background handler. */
export const computeImports = async (setup: Setup): Promise<readonly object[]> => {
  return runHandlerCases(
    setup,
    TYPE,
    (await cases(setup)).map(({ package: pkg, message, ...item }) => {
      const sent = (message ?? { package: pkg, type: TYPE }) as {
        readonly package: { readonly intent: { readonly id: string } };
      };
      return { ...item, intentId: sent.package.intent.id, message: sent };
    }),
  );
};
