/**
 * The address finder on both private-key import forms (issue 779). A Ready
 * account deployed with a guardian, another salt, or a rotated key is at an
 * address release discovery cannot derive, so once discovery has answered —
 * a picker, or no account — the form offers "Can't find it? Paste the
 * account address". The lookup is bound to that discovery's key, salt and
 * network (./ready-key-session.ts); any input change hides the finder and
 * drops an answer still on its way. The key never reaches this module.
 */

import { type KeyAddressCandidate, NO_READY_ACCOUNT_FOR_KEY } from "@bramble/wallet-model/recovery";
import type { SidepanelWallet } from "../../runtime/runtime";
import { errorDetails } from "../../shared/dom";
import type { ReadyKeyPicker } from "./ready-key-picker";
import type { ReadyKeySession } from "./ready-key-session";
import { bindRecoveryAddressFinder } from "./recovery-address-ui";

type ReadyKeyAddressFinderDeps = {
  /** The form holding the `[data-recovery-address="key"]` block. */
  readonly form: HTMLFormElement | null;
  /** Mounts the found account's one-row picker where the release picker goes. */
  readonly mount: (candidate: KeyAddressCandidate) => ReadyKeyPicker | null;
  readonly networkId: () => string;
  /** Runs after a found account replaced the picker, to re-gate the form. */
  readonly onFound: () => void;
  readonly session: ReadyKeySession;
  readonly wallet: Pick<SidepanelWallet, "findKeyAccountByAddress">;
};

/** The form's handle on its finder. */
export type ReadyKeyAddressFinder = {
  /** Shows the finder after a discovery that listed accounts or found none. */
  readonly offer: (discovery: { readonly error: unknown } | "listed") => void;
  /** Hides and clears it, and drops any lookup still on its way. */
  readonly withdraw: () => void;
};

const foundLine = (candidate: KeyAddressCandidate | null): string => {
  if (candidate === null) return "";
  return candidate.restriction
    ? "Found your account. It's view only until you recover it."
    : "Found your account.";
};

/** Binds the finder block inside a private-key import form. */
export const bindReadyKeyAddressFinder = (
  deps: ReadyKeyAddressFinderDeps,
): ReadyKeyAddressFinder => {
  const root =
    deps.form?.querySelector<HTMLDetailsElement>('[data-recovery-address="key"]') ?? null;
  const finder = bindRecoveryAddressFinder({
    lookup: (address) =>
      deps.session.findByAddress(
        (inputs) =>
          deps.wallet.findKeyAccountByAddress(inputs.networkId, inputs.key, inputs.salt, address),
        deps.mount,
      ),
    networkId: deps.networkId,
    onFound: (candidate) => {
      if (candidate !== null) deps.onFound();
      return foundLine(candidate);
    },
    root,
  });
  return {
    offer(discovery) {
      // Only "no account for this key" leaves a search worth making: any
      // other failure (unreadable chain, malformed key) would refuse it too.
      if (
        discovery !== "listed" &&
        errorDetails(discovery.error, "") !== NO_READY_ACCOUNT_FOR_KEY
      ) {
        return;
      }
      root?.removeAttribute("hidden");
    },
    withdraw() {
      finder.reset();
      if (!root) return;
      root.open = false;
      root.setAttribute("hidden", "");
    },
  };
};
