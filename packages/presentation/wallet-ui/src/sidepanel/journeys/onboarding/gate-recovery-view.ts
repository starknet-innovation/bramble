/**
 * The locked gate for a vault the background cannot verify (Sherlock 138):
 * no record vouches for it (`unverified`), a record names a newer copy
 * (`rollback`), or its stored data is malformed (`invalid`). The first two
 * offer "Unlock anyway" with the password; every case offers reinstalling and
 * restoring from the recovery phrase, which is how Bramble starts over.
 *
 * This copy states a security decision and is edited as a reviewed group, like
 * approval and signing sentences, against "did we lose a fact?".
 */

import { button } from "@bramble/ui-kit/controls";
import type { VaultRecovery } from "@bramble/wallet-model/vault-recovery";
import type { WalletStatus } from "../../../popup/responses/responses";

const RECOVERY_COPY: Readonly<
  Record<VaultRecovery, { readonly title: string; readonly lede: string }>
> = {
  invalid: {
    lede: "This wallet's saved data is damaged. Reinstall Bramble and restore your wallet from its recovery phrase.",
    title: "This wallet cannot be opened",
  },
  rollback: {
    lede: "Bramble has a newer copy on record. Restoring a browser backup causes this. If you did not, someone may have changed this browser's data.",
    title: "This wallet is out of date",
  },
  unverified: {
    lede: "Bramble cannot confirm this is the latest copy of your wallet.",
    title: "Check this wallet",
  },
};

/**
 * The recovery gate for a status carrying `recovery`. The form keeps the
 * unlock form's id so one binder serves both; `data-unlock="unverified"` tells
 * it to send "Unlock anyway" instead of a normal unlock. The password field is
 * built by the unlock gate, which owns the credential input.
 */
export const recoveryGate = (
  status: WalletStatus,
  recovery: VaultRecovery,
  brand: string,
  passwordField: string,
): string => {
  const copy = RECOVERY_COPY[recovery];
  const head = `
    ${brand}
    <div class="gate-head">
      <h1>${copy.title}</h1>
      <p class="lede">${copy.lede}</p>
    </div>`;
  if (recovery === "invalid") {
    return `<main class="screen flow gate" data-recovery="${recovery}">${head}</main>`;
  }
  return `
  <main class="screen flow gate" data-recovery="${recovery}">
    ${head}
    <form id="unlock-form" class="gate-form" data-unlock="unverified">
      ${passwordField}
      <p id="form-result" role="status"></p>
      <div class="gate-cta">
        <p class="hint">Unlocking it disconnects every site.</p>
        ${button({
          disabled: !status.ready,
          label: "Unlock anyway",
          type: "submit",
        })}
      </div>
    </form>
    <div class="gate-alt">
      <p class="hint">Or reinstall Bramble and restore your wallet from its recovery phrase.</p>
    </div>
  </main>`;
};
