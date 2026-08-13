/** Pure stable Argent multisig deployment form. */
import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import { ARGENT_MULTISIG_CONTRACT } from "@mc-wallet/starknet/account-contracts";
import { emptyState, receipt } from "@mc-wallet/ui-kit/content";
import { button } from "@mc-wallet/ui-kit/controls";
import { selectField, textField } from "@mc-wallet/ui-kit/fields";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import type { WalletStatus } from "../../../popup/responses/responses";
import { accountDisplayName, flowHeader, flowScreen, noAccountEmpty } from "../../shared/parts";

/**
 * Renders exact constructor input and an explicit local deployment signer.
 */
export const multisigDeployFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  classState: boolean | "error" | null,
  preferences: WalletPreferences | null = null,
): string => {
  if (!account) {
    return (
      flowHeader("Deploy Argent multisig", status) +
      flowScreen("multisig-deploy", noAccountEmpty(status))
    );
  }
  const accounts = status.accounts.filter((candidate) => candidate.networkId === status.networkId);
  if (classState === false) {
    return (
      flowHeader("Deploy Argent multisig", status) +
      flowScreen(
        "multisig-deploy",
        emptyState(
          "The pinned Argent Multisig 0.2 class is not declared on this network. Predeclare the audited class before deployment.",
        ),
      )
    );
  }
  return (
    flowHeader("Deploy Argent multisig", status, "True M-of-N account signatures") +
    flowScreen(
      "multisig-deploy",
      `<section class="section">
        ${receipt([
          { label: "Contract", value: `Argent Multisig ${ARGENT_MULTISIG_CONTRACT.version}` },
          { label: "Class hash", value: ARGENT_MULTISIG_CONTRACT.classHash, valueStyle: "code" },
          { label: "Network", value: status.network },
        ])}
        ${
          classState === null
            ? '<p class="hint">Checking the pinned class on this network…</p>'
            : classState === "error"
              ? '<p class="review-flag" role="alert">Class availability could not be verified. Deployment remains disabled.</p>'
              : ""
        }
        <form id="multisig-deploy-form">
          ${textField({ label: "Name (optional)", maxlength: 48, name: "name" })}
          ${textField({ className: "mono", hint: "Canonical signer public keys separated by spaces. Order is normalized by the audited constructor helper.", label: "Signer public keys", name: "signerPublicKeys", required: true, spellcheck: false, value: account.publicKeyX })}
          ${textField({ inputmode: "numeric", label: "Signatures required", name: "threshold", required: true, value: "1" })}
          ${textField({ className: "mono", label: "Deployment salt", name: "salt", required: true, spellcheck: false, value: "0x0" })}
          ${selectField({
            hint: "This account must be one of the configured public keys and authorizes only this reviewed deployment.",
            label: "Deployment signer",
            name: "signerAccountId",
            options: accounts.map((candidate) => ({
              label: accountDisplayName(candidate, preferences),
              value: candidate.id,
            })),
            required: true,
            selected: account.id,
          })}
          <div id="multisig-deploy-review" aria-live="polite"></div>
          ${button({ disabled: classState !== true, label: "Review deployment", type: "submit" })}
          <p id="multisig-deploy-result" role="status"></p>
        </form>
      </section>`,
    )
  );
};
