/**
 * The watch-collectible approval card and its boundary check: a watch-asset
 * card names exactly one token or one collectible, and the collectible card
 * shows the full contract, the token id and the network before the user
 * approves.
 */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { isPendingApprovalsResponse } from "../../../../src/popup/responses/responses";
import { approvalCard } from "../../../../src/sidepanel/journeys/approvals/approval-cards";

const CONTRACT = "0x00000000000000000000000000000000000000000000000000511a2b3c4d5e6f";
const nft = { contract: CONTRACT, networkId: "SN_MAIN", standard: "ERC721", tokenId: "42" };
const card = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  kind: "watch-asset",
  nft,
  origin: "https://dapp.example",
};
const token = { address: "0x1", decimals: 18, name: "Token", networkId: "SN_MAIN", symbol: "TKN" };
const status: WalletStatus = {
  accountCount: 1,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const accepts = (approval: Record<string, unknown>): boolean =>
  isPendingApprovalsResponse({ ok: true, pending: [approval] });

describe("watch-collectible card", () => {
  test("the boundary admits one collectible, never beside a token or a tracked mark", () => {
    expect(accepts(card)).toBe(true);
    expect(accepts({ ...card, token })).toBe(false);
    expect(accepts({ ...card, alreadyTracked: true })).toBe(false);
    expect(accepts({ ...card, kind: "invoke" })).toBe(false);
    expect(accepts({ ...card, nft: { ...nft, tokenId: "-1" } })).toBe(false);
    expect(accepts({ ...card, nft: { ...nft, standard: "ERC20" } })).toBe(false);
    expect(accepts({ ...card, nft: { ...nft, extra: 1 } })).toBe(false);
    const { nft: _nft, ...tokenCard } = card;
    expect(accepts({ ...tokenCard, token })).toBe(true);
  });

  test("with NFTs turned off it is a close-only notice naming the setting", () => {
    const off = { ...defaultWalletPreferences(), collectiblesPreview: false };
    const html = approvalCard(card as never, status, off);
    expect(html).toContain(
      "NFTs are turned off. Turn on Show NFTs on Home in Appearance &amp; currency to watch one.",
    );
    expect(html).toContain("data-approval-notice");
    expect(html).not.toContain('data-approval-action="approve"');
    expect(html).toContain(CONTRACT);
    // Preferences not loaded yet: fail closed to the notice.
    expect(approvalCard(card as never, status, null)).toContain("data-approval-notice");
  });

  test("on by default: shows the contract, token id and network, and promises the ownership check", () => {
    const { collectiblesPreview: _unset, ...defaults } = defaultWalletPreferences();
    const html = approvalCard(card as never, status, defaults);
    expect(html).not.toContain("data-approval-notice");
    expect(html).toContain("Watch collectible request");
    expect(html).toContain(CONTRACT);
    expect(html).toContain(">42<");
    expect(html).toContain("Starknet Mainnet");
    expect(html).toContain("Show this NFT on Home once Bramble confirms this account owns it.");
    expect(html).toContain("Watch collectible");
    expect(html).not.toContain("Add token");
  });
});
