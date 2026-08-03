/** Shared account-address surface used by single-owner and multisig Receive. */
import { escapeHtml } from "../shared/html";
import { button } from "../ui/controls";
import { copyButton } from "./parts";
import { qrSvg } from "./qr";

type ReceiveAddressViewOptions = {
  readonly address: string;
  readonly copyLabel: string;
  readonly eyebrow: string;
  readonly hint: string;
  readonly qrLabel?: string;
  readonly title?: string;
};

/**
 * Renders the canonical Receive card. Only the public address is encoded and
 * copied; callers provide account-type context as escaped presentation copy.
 */
export const receiveAddressView = ({
  address,
  copyLabel,
  eyebrow,
  hint,
  qrLabel,
  title,
}: ReceiveAddressViewOptions): string => `
  <div class="stack receive-address-view">
    <div class="qr-card">${qrSvg(address, qrLabel)}</div>
    <p class="eyebrow">${escapeHtml(eyebrow)}</p>
    ${title ? `<h2>${escapeHtml(title)}</h2>` : ""}
    <div class="address-line">
      <code>${escapeHtml(address)}</code>
      ${copyButton(address, copyLabel)}
    </div>
    ${button({ attributes: { "data-copy": address }, icon: "copy", label: copyLabel })}
    <p class="hint">${escapeHtml(hint)}</p>
  </div>`;
