/** Presentation-only renderer for a shared account's actionable intent queue. */
import type { ArgentMultisigSigningIntent } from "@mc-wallet/multisig/repository";
import { emptyState } from "@mc-wallet/ui-kit/content";
import { button } from "@mc-wallet/ui-kit/controls";
import { menuRow } from "@mc-wallet/ui-kit/navigation";
import { sameFelt } from "@mc-wallet/wallet-model/networks";
import { tokenGlyph } from "../portfolio/token-row";

type CompactIntentItem = {
  readonly accountId: string;
  readonly assets: readonly { readonly address: string; readonly symbol: string }[];
  readonly id: string;
  readonly label: string;
  readonly supportingText: string;
};

/**
 * Renders the destructive local-only control inside intent inspection.
 */
export const intentDeleteButton = (id: string, accountId: string): string =>
  button({
    attributes: { "data-ms-delete-intent": id, "data-ms-intent-account": accountId },
    label: "Delete saved intent",
    size: "small",
    tone: "danger",
    variant: "ghost",
  });

const sameCalls = (
  left: ArgentMultisigSigningIntent,
  right: ArgentMultisigSigningIntent,
): boolean =>
  left.prepared.calls.length === right.prepared.calls.length &&
  left.prepared.calls.every((call, index) => {
    const other = right.prepared.calls[index];
    return (
      other !== undefined &&
      call.entrypoint === other.entrypoint &&
      sameFelt(call.contractAddress, other.contractAddress) &&
      call.calldata.length === other.calldata.length &&
      call.calldata.every((value, valueIndex) => sameFelt(value, other.calldata[valueIndex] ?? ""))
    );
  });

/**
 * Identifies a newly fee-reviewed version of a retained failed attempt.
 */
export const isFeeReplacementIntent = (
  intent: ArgentMultisigSigningIntent,
  accountIntents: readonly ArgentMultisigSigningIntent[],
): boolean =>
  (intent.state === "collecting" || intent.state === "ready") &&
  accountIntents.some(
    (candidate) =>
      candidate.state === "stale" &&
      candidate.id !== intent.id &&
      candidate.accountId === intent.accountId &&
      sameFelt(candidate.prepared.nonce, intent.prepared.nonce) &&
      sameCalls(candidate, intent),
  );

/**
 * Renders pre-reviewed rows without handling wallet or signer data.
 */
export const compactIntentListView = (
  heading: string,
  items: readonly CompactIntentItem[],
  emptyMessage: string,
): string => {
  const list =
    items.length === 0
      ? emptyState(emptyMessage)
      : `<p class="eyebrow">${heading}</p><ul class="menu-list multisig-intent-list">${items
          .map((item) => {
            const assetGlyphs =
              item.assets.length === 0
                ? ""
                : `<span class="multisig-intent-assets" aria-hidden="true">${item.assets.map((asset) => tokenGlyph(asset.address, asset.symbol)).join("")}</span>`;
            return `<li class="multisig-intent-row${item.assets.length === 0 ? "" : " has-assets"}">${menuRow(
              {
                attributes: {
                  "data-ms-intent-account": item.accountId,
                  "data-ms-open-intent": item.id,
                },
                icon: "users",
                label: item.label,
                supportingText: item.supportingText,
              },
            )}${assetGlyphs}</li>`;
          })
          .join("")}</ul>`;
  return `${list}${button({
    attributes: { "data-view": "multisig-track" },
    className: "tab-more",
    icon: "chevronRight",
    iconPosition: "after",
    label: "Import intent",
    size: "small",
    variant: "ghost",
  })}`;
};
