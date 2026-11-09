/**
 * Sherlock 257: a row key composes one SNIP-12 name per nesting level, and each
 * name may be 64 characters, so a nested message produces dotted keys wider
 * than the card. The key used to be laid out at full width (`flex: none`, no
 * break opportunity) while the value beside it collapsed to nothing, so the
 * card offered Sign over a recipient, amount and nonce it showed at zero
 * pixels.
 *
 * Layout cannot be measured here, so this suite pins the declarations the fix
 * rests on, the full key the card prints, and the bound past which it refuses
 * to offer Sign.
 */
import { describe, expect, test } from "bun:test";
import type { Json } from "@bramble/core/json";
import { isTypedDataShape } from "@bramble/starknet/typed-data";
import type { PendingApproval, WalletStatus } from "../../../../src/popup/responses/responses";
import { approvalCard } from "../../../../src/sidepanel/journeys/approvals/approval-cards";
import {
  SIGN_REQUEST_STYLES,
  SIGN_REQUEST_UNCLASSIFIED_WARNING,
  signRequestView,
} from "../../../../src/sidepanel/shared/sign-request";
import { SIGN_KEY_MAX_LENGTH } from "../../../../src/sidepanel/shared/sign-request-rows";

const DOMAIN = { chainId: "SN_MAIN", name: "Marketplace", revision: "1", version: "1" };
const DOMAIN_TYPE = [
  { name: "name", type: "shortstring" },
  { name: "version", type: "shortstring" },
  { name: "chainId", type: "shortstring" },
  { name: "revision", type: "shortstring" },
];

// The audit's order: four levels, longest single name 21 characters.
const ORDER: Json = {
  domain: DOMAIN,
  message: {
    authorization: {
      settlementInstruction: {
        outboundTransfer: {
          beneficiaryAddress: "0x05f1e2c3b4a596877889aabbccddeeff00112233445566778899aabbccddeeff",
          replayNonce: "7",
          transferAmount: "250000000000000000000",
        },
      },
    },
  },
  primaryType: "Order",
  types: {
    Authorization: [{ name: "settlementInstruction", type: "Settlement" }],
    Order: [{ name: "authorization", type: "Authorization" }],
    Settlement: [{ name: "outboundTransfer", type: "Transfer" }],
    StarknetDomain: DOMAIN_TYPE,
    Transfer: [
      { name: "beneficiaryAddress", type: "ContractAddress" },
      { name: "transferAmount", type: "u128" },
      { name: "replayNonce", type: "felt" },
    ],
  },
};

// `names.length` nested single-field structs ending in one felt, so the leaf's
// key is exactly the names joined with dots.
const nested = (names: readonly string[]): Json => {
  const types: Record<string, Json> = { StarknetDomain: DOMAIN_TYPE };
  let message: Json = "0x1";
  for (let level = names.length - 1; level >= 0; level -= 1) {
    const name = names[level] ?? "";
    types[`L${level}`] = [{ name, type: level === names.length - 1 ? "felt" : `L${level + 1}` }];
    message = { [name]: message };
  }
  return { domain: DOMAIN, message, primaryType: "L0", types };
};

const longName = (level: number): string => `${String.fromCharCode(97 + level)}${"n".repeat(63)}`;

const rule = (selector: string): string => {
  const match = SIGN_REQUEST_STYLES.match(new RegExp(`\\${selector} \\{([^}]*)\\}`));
  if (!match?.[1]) throw new Error(`missing ${selector} rule`);
  return match[1];
};

const status: WalletStatus = {
  accountCount: 0,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const card = (typedData: Json): string =>
  approvalCard(
    {
      id: "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14",
      kind: "sign-typed-data",
      origin: "https://market.example",
      typedData,
    } satisfies PendingApproval,
    status,
  );

describe("sign card layout", () => {
  test("lets a key shrink and wrap, and caps it at half the row", () => {
    const key = rule(".sign-key");
    expect(key).not.toContain("flex: none");
    expect(key).toContain("flex: 0 1 auto");
    expect(key).toContain("min-width: 0");
    expect(key).toContain("max-width: 50%");
    expect(key).toContain("overflow-wrap: anywhere");
  });

  test("gives the value the rest of the row", () => {
    const value = rule(".sign-val");
    expect(value).toContain("flex: 1 1 0");
    expect(value).toContain("min-width: 0");
    expect(value).toContain("overflow-wrap: anywhere");
  });

  test("keeps the block's column no wider than the card", () => {
    expect(rule(".sign-block")).toContain("grid-template-columns: minmax(0, 1fr)");
  });
});

describe("composed keys", () => {
  test("a nested order prints every full key beside its value and still offers Sign", () => {
    expect(isTypedDataShape(ORDER)).toBe(true);
    const view = signRequestView(ORDER);
    expect(view.classified).toBe(true);
    const path = "authorization.settlementInstruction.outboundTransfer";
    for (const [field, value] of [
      ["beneficiaryAddress", "0x5f1e2c3b4a596877889aabbccddeeff00112233445566778899aabbccddeeff"],
      ["transferAmount", "250000000000000000000 (u128"],
      ["replayNonce", "0x7 (felt)"],
    ]) {
      expect(view.html).toContain(
        `<span class="sign-key">${path}.${field}</span><span class="sign-val">${value}`,
      );
    }
    expect(card(ORDER)).toContain('data-approval-action="approve"');
  });

  test("a key at the bound still offers Sign", () => {
    const payload = nested([0, 1, 2, 3].map(longName));
    expect(isTypedDataShape(payload)).toBe(true);
    const key = [0, 1, 2, 3].map(longName).join(".");
    expect(key.length).toBe(SIGN_KEY_MAX_LENGTH);
    const view = signRequestView(payload);
    expect(view.html).toContain(`<span class="sign-key">${key}</span>`);
    expect(view.classified).toBe(true);
  });

  test("a key past the bound withholds Sign but still shows the value", () => {
    const payload = nested([0, 1, 2, 3, 4].map(longName));
    expect(isTypedDataShape(payload)).toBe(true);
    expect(signRequestView(payload).classified).toBe(false);
    const html = card(payload);
    expect(html).not.toContain('data-approval-action="approve"');
    expect(html).toContain('data-approval-action="deny"');
    expect(html).toContain(SIGN_REQUEST_UNCLASSIFIED_WARNING);
    expect(html).toContain("0x1");
  });

  test("a key past the bound in the not-signed block also withholds Sign", () => {
    // Three long levels, then an array of structs: the declared leaf's key is
    // short, but an undeclared sibling's key is three characters past the bound.
    const [n0, n1, n2, extra] = [0, 1, 2, 3].map(longName);
    const payload = (item: Json): Json => ({
      domain: DOMAIN,
      message: { [n0 ?? ""]: { [n1 ?? ""]: { [n2 ?? ""]: [item] } } },
      primaryType: "L0",
      types: {
        Item: [{ name: "x", type: "felt" }],
        L0: [{ name: n0 ?? "", type: "L1" }],
        L1: [{ name: n1 ?? "", type: "L2" }],
        L2: [{ name: n2 ?? "", type: "Item*" }],
        StarknetDomain: DOMAIN_TYPE,
      },
    });
    expect(signRequestView(payload({ x: "0x1" })).classified).toBe(true);
    const padded = signRequestView(payload({ x: "0x1", [extra ?? ""]: "site text" }));
    expect(padded.html).toContain(`${n0}.${n1}.${n2}[0].${extra}`);
    expect(padded.classified).toBe(false);
  });

  test("a deep message of short names stays under the bound", () => {
    const names = Array.from({ length: 12 }, (_, level) => `field${level}`);
    expect(signRequestView(nested(names)).classified).toBe(true);
  });
});
