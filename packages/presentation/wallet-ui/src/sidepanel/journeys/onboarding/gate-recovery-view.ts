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
import { t, th } from "../../../i18n/messages";
import type { WalletStatus } from "../../../popup/responses/responses";

const RECOVERY_COPY: Readonly<
  Record<VaultRecovery, { readonly title: () => string; readonly lede: () => string }>
> = {
  invalid: {
    lede: () => th("onboarding.recoveryGate.invalidLede"),
    title: () => th("onboarding.recoveryGate.invalidTitle"),
  },
  rollback: {
    lede: () => th("onboarding.recoveryGate.rollbackLede"),
    title: () => th("onboarding.recoveryGate.rollbackTitle"),
  },
  unverified: {
    lede: () => th("onboarding.recoveryGate.unverifiedLede"),
    title: () => th("onboarding.recoveryGate.unverifiedTitle"),
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
      <h1>${copy.title()}</h1>
      <p class="lede">${copy.lede()}</p>
    </div>`;
  if (recovery === "invalid") {
    return `<section class="screen flow gate" data-recovery="${recovery}">${head}</section>`;
  }
  return `
  <section class="screen flow gate" data-recovery="${recovery}">
    ${head}
    <form id="unlock-form" class="gate-form" data-unlock="unverified">
      ${passwordField}
      <p id="form-result" role="status"></p>
      <div class="gate-cta">
        <p class="hint">${th("onboarding.recoveryGate.disconnects")}</p>
        ${button({
          disabled: !status.ready,
          label: t("onboarding.recoveryGate.unlockAnyway"),
          type: "submit",
        })}
      </div>
    </form>
    <div class="gate-alt">
      <p class="hint">${th("onboarding.recoveryGate.reinstall")}</p>
    </div>
  </section>`;
};
