/**
 * "Can't find it? Paste the account address" in the recovery picker (issue
 * 398). Reads the pasted address or explorer link, asks the background which
 * key of the phrase controls it, and hands a match to the picker. The search
 * itself, the key match, and every refusal are the background's; this only
 * turns the answer into a line the reader can act on.
 */

import {
  ADDRESS_IMPORT_REFUSALS,
  type RecoveryAccountCandidate,
} from "@bramble/wallet-model/recovery";
import { buttonBusy, errorDetails, errorLine } from "../../shared/dom";
import { networkName, readPastedAddress } from "./recovery-address";

type RecoveryAddressFinderDeps = {
  readonly form: HTMLFormElement;
  /** The background lookup, bound to the phrase the picker searches. */
  readonly lookup: (address: string) => Promise<RecoveryAccountCandidate>;
  readonly networkId: () => string;
  /** Adds a match to the picker and returns the line that reports it. */
  readonly onFound: (candidate: RecoveryAccountCandidate) => string;
};

/** The finder's handle: clears its input and result when the picker resets. */
export type RecoveryAddressFinder = {
  readonly reset: () => void;
};

// A search derives up to a few hundred keys before it can answer no, which
// takes seconds; the line says so while it runs.
const SEARCHING_LINE = "Checking this account. This can take a few seconds.";

const notFoundLine = (networkId: string): string =>
  `No account found at this address on ${networkName(networkId)}. Check the address and network.`;

// The background's refusal in the reader's words. Not-found names the network
// searched, which the shared copy table cannot.
const failureLine = (error: unknown, networkId: string): string =>
  errorDetails(error, "") === ADDRESS_IMPORT_REFUSALS.notDeployed
    ? notFoundLine(networkId)
    : errorLine(error, ADDRESS_IMPORT_REFUSALS.unavailable);

/** Binds the address finder inside a recovery picker form. */
export const bindRecoveryAddressFinder = (
  deps: RecoveryAddressFinderDeps,
): RecoveryAddressFinder => {
  const input = deps.form.querySelector<HTMLInputElement>('input[name="recoveryAddress"]');
  const search = deps.form.querySelector<HTMLButtonElement>("#recovery-address-search");
  const network = deps.form.querySelector<HTMLElement>("[data-recovery-address-network]");
  const result = deps.form.querySelector<HTMLElement>("#recovery-address-result");
  let generation = 0;

  const showNetwork = (): void => {
    if (network) network.textContent = `On ${networkName(deps.networkId())}`;
  };
  const say = (line: string): void => {
    if (result) result.textContent = line;
  };
  // Busy for the whole lookup: the button and the field are disabled, so a
  // second search cannot start, and only a reset or the answer ends it.
  const busy = (on: boolean): void => {
    buttonBusy(search, on);
    if (input) input.disabled = on;
  };

  const find = async (): Promise<void> => {
    showNetwork();
    const networkId = deps.networkId();
    const pasted = readPastedAddress(input?.value ?? "");
    if ("reason" in pasted) {
      say(
        pasted.reason === "insecure-link"
          ? "Use the https:// link from the explorer."
          : "That doesn't look like a Starknet address.",
      );
      return;
    }
    if (pasted.network !== undefined && pasted.network !== networkId) {
      say(`That link is for ${networkName(pasted.network)}, not ${networkName(networkId)}.`);
      return;
    }
    const active = generation;
    busy(true);
    say(SEARCHING_LINE);
    try {
      const candidate = await deps.lookup(pasted.address);
      if (active === generation) say(deps.onFound(candidate));
    } catch (error) {
      if (active === generation) say(failureLine(error, networkId));
    } finally {
      // A reset already ended this search and cleared its state.
      if (active === generation) busy(false);
    }
  };

  showNetwork();
  deps.form
    .querySelector<HTMLDetailsElement>("[data-recovery-address]")
    ?.addEventListener("toggle", showNetwork);
  search?.addEventListener("click", () => void find());
  // Enter in the field searches; it must not submit the surrounding form.
  input?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!search?.hasAttribute("data-busy")) void find();
  });

  return {
    reset() {
      generation += 1;
      busy(false);
      if (input) input.value = "";
      say("");
    },
  };
};
