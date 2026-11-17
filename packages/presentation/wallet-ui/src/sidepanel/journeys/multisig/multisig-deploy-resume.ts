/**
 * What the multisig deployment wizard carries between a quote and the user's
 * next press: an automatic quote held for "Check fee and address", and the
 * setup a "Fund from this wallet" send left from. UI state only; neither is
 * consent to deploy, and both are dropped as soon as they no longer match.
 */
import { sameFelt } from "@bramble/wallet-model/networks";
import type { ArgentMultisigDeploymentReview } from "../../../popup/responses/multisig-responses";
import type { SendIntent } from "../send/send-model";
import type { ArgentMultisigDeploymentSetup } from "./multisig-runtime";

type HeldQuote = {
  readonly generation: number;
  readonly input: ArgentMultisigDeploymentSetup;
  readonly review: ArgentMultisigDeploymentReview;
};

const heldQuotes = new WeakMap<HTMLFormElement, HeldQuote>();
let fundingReturn: { readonly address: string; readonly networkId: string } | null = null;

/** Whether two deployment setups are field-for-field the same. */
export const sameDeploymentSetup = (
  left: ArgentMultisigDeploymentSetup,
  right: ArgentMultisigDeploymentSetup,
): boolean => JSON.stringify(left) === JSON.stringify(right);

/**
 * Holds an automatic quote for the user's own check press. It is bound to the
 * review generation it ran under, so any edit, back step or newer quote
 * retires it: a review is never reused across edits.
 */
export const holdQuote = (form: HTMLFormElement, quote: HeldQuote): void => {
  heldQuotes.set(form, quote);
};

/**
 * Takes the held quote, if it still belongs to `generation` and `input`.
 * Always clears it, so a held quote is offered at most once.
 */
export const takeHeldQuote = (
  form: HTMLFormElement,
  generation: number | undefined,
  input: ArgentMultisigDeploymentSetup,
): ArgentMultisigDeploymentReview | undefined => {
  const held = heldQuotes.get(form);
  heldQuotes.delete(form);
  return held && held.generation === generation && sameDeploymentSetup(held.input, input)
    ? held.review
    : undefined;
};

/**
 * Wraps the funding opener so the setup it leaves from is remembered. Send
 * returns by re-rendering the wizard, which opens a saved setup on Approval;
 * the marker lets that return go straight back to Fund. A failed open forgets
 * it.
 */
export const trackFundingReturn =
  (openFunding: (intent: SendIntent) => Promise<void>) =>
  (intent: SendIntent): Promise<void> => {
    fundingReturn = { address: intent.recipient, networkId: intent.networkId };
    return openFunding(intent).catch((error: unknown) => {
      fundingReturn = null;
      throw error;
    });
  };

/**
 * Whether this mount is the return from a funding send for `setup`, and so
 * should check it again explicitly. A different setup forgets the marker; a
 * matching one that is not `ready` (class unchecked, not on Approval) keeps it
 * for the repaint that follows.
 */
export const takeFundingReturn = (
  setup: ArgentMultisigDeploymentSetup | undefined,
  ready: boolean,
): boolean => {
  const returning = fundingReturn;
  if (!returning) return false;
  const matches =
    setup?.expectedAddress !== undefined &&
    sameFelt(setup.expectedAddress, returning.address) &&
    setup.networkId === returning.networkId;
  if (matches && !ready) return false;
  fundingReturn = null;
  return matches;
};
