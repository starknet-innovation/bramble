/**
 * Gate screens shown before the wallet dashboard: onboarding for first-run
 * wallet creation and the unlock screen for locked vaults. Both use a centered
 * brand mark, a large heading, and a primary action pinned to the bottom.
 */
import type { PendingApproval, WalletStatus } from "../popup/responses";
import { callout } from "../ui/content";
import { actionLink, button } from "../ui/controls";
import { checkboxField, selectField, textareaField, textField } from "../ui/fields";
import { BACKUP_VERIFY_POSITIONS } from "./backup-verify";
import { icon } from "./icons";
import { requiresMainnetAck } from "./mainnet-ack";

const backupVerifyInputs = (): string =>
  BACKUP_VERIFY_POSITIONS.map((position, index) =>
    textField({
      autocomplete: "off",
      autocapitalize: "off",
      inputmode: "text",
      label: `Word ${position}`,
      name: `verify-${index}`,
      spellcheck: false,
    }),
  ).join("");

const gateBrand = (): string => `<div class="gate-brand">${icon("wallet")}</div>`;

const networkField = (status: WalletStatus, name: string): string =>
  selectField({
    label: "Network",
    name,
    options: status.networks.map((network) => ({
      label: network.name,
      value: network.id,
    })),
    selected: status.networkId,
  });

const mainnetAcknowledgement = (
  status: WalletStatus,
  name: string,
  id: string,
  text: string,
): string =>
  checkboxField({
    containerAttributes: {
      id,
      hidden: !requiresMainnetAck(status.networkId),
    },
    name,
    text,
  });

/**
 * First-run screen: create a wallet from a fresh or pasted recovery phrase.
 */
export const onboarding = (status: WalletStatus): string => `
  <main class="screen gate">
    ${gateBrand()}
    <div class="gate-head">
      <h1>Create your wallet</h1>
      <p class="lede">Generate a fresh recovery phrase, or paste one you already have to import an existing wallet.</p>
    </div>
    ${actionLink({
      href: "onboarding.html",
      label: "Open full-screen setup",
      target: "_blank",
    })}
    <form id="create-form" class="gate-form">
      ${networkField(status, "networkId")}
      ${textareaField({
        autocomplete: "off",
        hint: "Anyone with these words controls the wallet. Store them offline.",
        label: "Recovery phrase",
        name: "mnemonic",
        placeholder: "12 or 24 words separated by spaces",
        required: true,
        spellcheck: false,
      })}
      ${button({
        attributes: { id: "phrase-toggle", hidden: true },
        icon: "book",
        label: "Tap to show phrase",
        size: "small",
        variant: "secondary",
      })}
      ${textField({
        autocomplete: "new-password",
        hint: "Unlocks the wallet on this device.",
        label: "Vault passphrase",
        minlength: 12,
        name: "vaultPassphrase",
        placeholder: "At least 12 characters",
        required: true,
        type: "password",
      })}
      <p id="passphrase-result" role="status"></p>
      <div id="backup-verify" class="stack" hidden>
        <span class="hint">Confirm you saved the phrase by re-typing these words.</span>
        <div class="verify-grid">${backupVerifyInputs()}</div>
        <p id="verify-result" role="status"></p>
      </div>
      ${mainnetAcknowledgement(
        status,
        "mainnetAck",
        "mainnet-ack",
        "You are creating a wallet on Starknet Mainnet with real funds.",
      )}
      <p id="form-result" role="status"></p>
      <div class="gate-cta">
        ${button({
          attributes: { id: "generate-button" },
          disabled: !status.ready,
          icon: "refresh",
          label: "Generate phrase",
          variant: "secondary",
        })}
        ${button({
          disabled: !status.ready,
          label: "Create wallet",
          type: "submit",
        })}
      </div>
    </form>
    ${ledgerSetupCard(status)}
  </main>`;

/**
 * First-run Ledger card: set up a brand-new wallet backed by a Ledger with no
 * recovery phrase generated. The user still sets an unlock passphrase (it
 * encrypts the account registry); connecting the device and picking accounts
 * happens in the onboarding overlay after this passphrase is captured.
 */
const ledgerSetupCard = (status: WalletStatus): string => `
    <div class="gate-alt">
      <p class="eyebrow">Or set up with a Ledger</p>
      <p class="lede">Back this wallet with a Ledger hardware device. No recovery phrase is generated — your keys stay on the device.</p>
      <form id="ledger-setup-form" class="gate-form">
        ${networkField(status, "ledgerNetworkId")}
        ${textField({
          autocomplete: "new-password",
          hint: "Unlocks the wallet on this device. It protects the account list — no key material is stored.",
          label: "Vault passphrase",
          minlength: 12,
          name: "ledgerVaultPassphrase",
          placeholder: "At least 12 characters",
          required: true,
          type: "password",
        })}
        <p id="ledger-passphrase-result" role="status"></p>
        ${mainnetAcknowledgement(
          status,
          "ledgerMainnetAck",
          "ledger-mainnet-ack",
          "You are setting up a wallet on Starknet Mainnet with real funds.",
        )}
        <div class="gate-cta">
          ${button({
            attributes: { "data-ledger-first-run": true, id: "ledger-setup-button" },
            disabled: !status.ready,
            icon: "shield",
            label: "Set up with a Ledger",
            variant: "secondary",
          })}
        </div>
      </form>
    </div>`;

/**
 * Unlock screen for an existing but locked vault.
 */
export const locked = (status: WalletStatus, pending: readonly PendingApproval[] = []): string => {
  const request = pending[0];
  return `
  <main class="screen gate">
    ${gateBrand()}
    <div class="gate-head">
      <h1>Welcome back</h1>
      <p class="lede">${request ? "Unlock to review the wallet request waiting for you." : "Unlock your wallet to continue."}</p>
    </div>
    ${
      request
        ? callout({
            body: request.origin,
            className: "gate-request",
            icon: "link",
            role: "status",
            title: "Site request waiting",
          })
        : ""
    }
    <form id="unlock-form" class="gate-form">
      ${textField({
        autocomplete: "current-password",
        label: "Vault passphrase",
        minlength: 12,
        name: "vaultPassphrase",
        placeholder: "Enter your passphrase",
        required: true,
        type: "password",
      })}
      <p id="form-result" role="status"></p>
      <div class="gate-cta">
        ${button({
          disabled: !status.ready,
          label: "Unlock",
          type: "submit",
        })}
      </div>
    </form>
  </main>`;
};
