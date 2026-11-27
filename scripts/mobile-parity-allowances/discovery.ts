/**
 * The pure blocks of the allowances fixture: `decode` (`decodeApprovalEvent`), `amount`
 * (`parseAllowanceAmount`), `unlimited` (`isUnlimitedAllowance`), `record`
 * (`isAllowanceRecord` on load), `merge` (`mergeAllowanceViews`), `outstanding` (the listing's
 * `outstandingAllowances`) and `notices` (its `listingNotices`).
 */
import {
  type AllowanceView,
  APPROVAL_EVENT_KEY,
  decodeApprovalEvent,
  isUnlimitedAllowance,
  mergeAllowanceViews,
  parseAllowanceAmount,
} from "@bramble/transactions/allowance-discovery";
import { isAllowanceRecord } from "@bramble/transactions/allowance-store";
import { hash } from "starknet";
import {
  listingNotices,
  outstandingAllowances,
} from "../../apps/extension/src/background/portfolio/allowance-ops";
import {
  ACCOUNT_ID,
  ADDRESS,
  ASSETS,
  BRIDGE,
  clean,
  DEX,
  FIELD_PRIME,
  HASH,
  LENDER,
  MULTISIG_ID,
  NETWORK,
  NFT,
  OTHER_ID,
  record,
  STRK,
  UNKNOWN,
  UNLIMITED,
  USDC,
} from "./shared";

const TRANSFER_KEY = hash.getSelectorFromName("Transfer");
const OWNER = ADDRESS;

const DECODES: readonly { readonly name: string; readonly event: unknown }[] = [
  { event: { data: ["0x64", "0x0"], keys: [APPROVAL_EVENT_KEY, OWNER, DEX] }, name: "Cairo 1" },
  {
    event: { data: [OWNER, DEX, "0x64", "0x0"], keys: [APPROVAL_EVENT_KEY] },
    name: "legacy: owner and spender in the data",
  },
  {
    event: {
      data: [],
      keys: [APPROVAL_EVENT_KEY.toUpperCase().replace("0X", "0x"), "0x00A11CE", DEX],
    },
    name: "upper-case selector and padded owner, read canonical",
  },
  {
    event: { data: [OWNER, DEX], keys: [APPROVAL_EVENT_KEY, OWNER] },
    name: "two keys: read from the data",
  },
  {
    event: { data: ["0x1", "0x0"], keys: [APPROVAL_EVENT_KEY, OWNER, NFT, "0x7", "0x0"] },
    name: "an ERC-721 Approval (five keys) decodes the same",
  },
  { event: { data: ["0x64", "0x0"], keys: [TRANSFER_KEY, OWNER, DEX] }, name: "a Transfer" },
  { event: { data: [], keys: [] }, name: "no keys" },
  { event: { data: [OWNER], keys: [APPROVAL_EVENT_KEY] }, name: "legacy without a spender" },
  {
    event: { data: ["0x64", "0x0"], keys: [APPROVAL_EVENT_KEY, OWNER, "0x0"] },
    name: "a zero spender",
  },
  {
    event: { data: ["0x64", "0x0"], keys: [APPROVAL_EVENT_KEY, "0x0", DEX] },
    name: "a zero owner",
  },
  {
    event: { data: ["0x64", "0x0"], keys: [APPROVAL_EVENT_KEY, "owner", DEX] },
    name: "an owner that is not a number",
  },
  {
    event: { data: ["0x64", "0x0"], keys: [APPROVAL_EVENT_KEY, OWNER, FIELD_PRIME] },
    name: "a spender at the field prime",
  },
  {
    event: { data: ["0x64", "0x0"], keys: [APPROVAL_EVENT_KEY, 5, 6] },
    name: "keys that are numbers, not strings",
  },
];

const AMOUNTS: readonly (readonly [string, readonly unknown[]])[] = [
  ["low limb only", ["0x3e8", "0x0"]],
  ["high limb", ["0x0", "0x1"]],
  [
    "both limbs at their top",
    ["0xffffffffffffffffffffffffffffffff", "0xffffffffffffffffffffffffffffffff"],
  ],
  ["decimal limbs", ["1000", "0"]],
  ["a high limb of 2^128", ["0x0", "0x100000000000000000000000000000000"]],
  ["one word", ["0x3e8"]],
  ["empty", []],
  ["not a number", ["0xzz", "0x0"]],
  ["a number, not a string", [1000, 0]],
];

const UNLIMITEDS: readonly string[] = [
  "0",
  "1000000000000000000",
  (BigInt(UNLIMITED) - 1n).toString(),
  UNLIMITED,
  (1n << 128n).toString(),
  "abc",
];

const valid = record(STRK, DEX, "1000");
const RECORDS: readonly { readonly name: string; readonly value: unknown }[] = [
  { name: "exact", value: valid },
  { name: "a lower bound", value: record(STRK, DEX, "0", { lowerBound: true }) },
  {
    name: "a pending revoke with its hash",
    value: record(STRK, DEX, "1000", { revokeHash: HASH, revoking: true }),
  },
  {
    name: "a pending revoke from before hashes",
    value: record(STRK, DEX, "5", { revoking: true }),
  },
  { name: "the largest stored amount", value: record(STRK, DEX, "9".repeat(77)) },
  { name: "lowerBound false", value: { ...valid, lowerBound: false } },
  { name: "revoking false", value: { ...valid, revoking: false } },
  { name: "a hash without revoking", value: { ...valid, revokeHash: HASH } },
  {
    name: "an upper-case hash",
    value: { ...valid, revokeHash: HASH.toUpperCase().replace("0X", "0x"), revoking: true },
  },
  { name: "a zero hash", value: { ...valid, revokeHash: "0x0", revoking: true } },
  { name: "an unknown key", value: { ...valid, label: "dex" } },
  { name: "an id that is not the three joined", value: { ...valid, id: `${ACCOUNT_ID}:${STRK}` } },
  {
    name: "a padded token, its id spelled the same",
    value: record(`0x0${STRK.slice(2)}`, DEX, "1"),
  },
  { name: "a zero token", value: record("0x0", DEX, "1") },
  { name: "a leading zero in the amount", value: record(STRK, DEX, "007") },
  { name: "a negative amount", value: record(STRK, DEX, "-1") },
  { name: "a hex amount", value: record(STRK, DEX, "0x10") },
  { name: "another network's account", value: { ...valid, networkId: "SN_SEPOLIA" } },
  { name: "not an object", value: [valid] },
];

const MERGES: readonly {
  readonly name: string;
  readonly input: Parameters<typeof mergeAllowanceViews>[0];
}[] = [
  {
    input: {
      account: { id: ACCOUNT_ID },
      external: [
        { amount: "500", spender: DEX, token: STRK },
        { amount: "0", spender: BRIDGE, token: STRK },
        { amount: "7", spender: `0x0${LENDER.slice(2)}`, token: USDC },
        { amount: "9", spender: LENDER, token: USDC },
      ],
      inWallet: [record(STRK, DEX, "100", { revokeHash: HASH, revoking: true })],
      networkId: NETWORK,
    },
    name: "an external figure for a tracked grant, a zero external and a duplicate",
  },
  {
    input: {
      account: { id: ACCOUNT_ID },
      external: [],
      inWallet: [
        record(STRK, DEX, "100", { lowerBound: true }),
        record(STRK, BRIDGE, "100", { lowerBound: true }),
        record(USDC, DEX, "100", { revoking: true }),
        record(USDC, BRIDGE, "100", { revoking: true }),
        record(UNKNOWN, DEX, "100"),
      ],
      networkId: NETWORK,
      readings: [
        { amount: "250", id: `${ACCOUNT_ID}:${STRK}:${DEX}` },
        { amount: "50", id: `${ACCOUNT_ID}:${STRK}:${BRIDGE}` },
        { amount: "40", id: `${ACCOUNT_ID}:${USDC}:${DEX}` },
        { amount: "0", id: `${ACCOUNT_ID}:${USDC}:${BRIDGE}` },
        { amount: "100", id: `${ACCOUNT_ID}:${UNKNOWN}:${DEX}` },
      ],
    },
    name: "readings: larger resolves a bound, smaller leaves it, a revoke takes any",
  },
  {
    input: {
      account: { id: ACCOUNT_ID },
      external: [
        { amount: "300", spender: DEX, token: STRK },
        { amount: "400", spender: BRIDGE, token: STRK },
      ],
      inWallet: [record(STRK, DEX, "100")],
      multisig: [record(STRK, BRIDGE, "100", {}, MULTISIG_ID)],
      networkId: NETWORK,
      readings: [
        { amount: "200", id: `${ACCOUNT_ID}:${STRK}:${DEX}` },
        { amount: "600", id: `${MULTISIG_ID}:${STRK}:${BRIDGE}` },
      ],
    },
    name: "a reading wins over the scan; a multisig's row and the scan's own",
  },
  {
    input: {
      account: { id: OTHER_ID },
      external: [{ amount: "5", spender: DEX, token: "0x0" }],
      inWallet: [],
      networkId: NETWORK,
    },
    name: "an external with a zero token is dropped",
  },
];

const view = (
  tokenAddress: string,
  amount: string,
  extra: Partial<AllowanceView> = {},
): AllowanceView => ({ ...record(tokenAddress, DEX, amount), source: "external", ...extra });

const OUTSTANDING: readonly {
  readonly name: string;
  readonly views: readonly AllowanceView[];
  readonly confirmed: readonly string[];
}[] = [
  {
    confirmed: [],
    name: "a tracked token, an unknown contract, a watched collection",
    views: [view(STRK, "5"), view(UNKNOWN, "5", { source: "wallet" }), view(NFT, "5")],
  },
  {
    confirmed: [`${ACCOUNT_ID}:${UNKNOWN}:${DEX}`],
    name: "an unknown contract the chain answered for",
    views: [view(UNKNOWN, "5")],
  },
  {
    confirmed: [],
    name: "an exact zero goes, a zero lower bound stays",
    views: [
      view(STRK, "0", { source: "wallet" }),
      view(USDC, "0", { lowerBound: true, source: "wallet" }),
    ],
  },
];

/** `decode`, `amount`, `unlimited`, `record`, `merge`, `outstanding` and `notices`. */
export const computeDiscovery = (): readonly (readonly [string, readonly object[]])[] => [
  [
    "decode",
    DECODES.map(({ event, name }) => ({
      decoded: decodeApprovalEvent(event as never),
      event,
      name,
    })),
  ],
  [
    "amount",
    AMOUNTS.map(([name, response]) => ({
      amount: parseAllowanceAmount(response as never),
      name,
      response,
    })),
  ],
  [
    "unlimited",
    UNLIMITEDS.map((amount) => ({ amount, name: amount, unlimited: isUnlimitedAllowance(amount) })),
  ],
  ["record", RECORDS.map(({ name, value }) => ({ name, valid: isAllowanceRecord(value), value }))],
  [
    "merge",
    MERGES.map(({ input, name }) => clean({ input, name, views: mergeAllowanceViews(input) })),
  ],
  [
    "outstanding",
    OUTSTANDING.map(({ confirmed, name, views }) =>
      clean({
        assets: ASSETS,
        confirmed,
        name,
        listed: outstandingAllowances(views, ASSETS, new Set(confirmed)),
        views,
      }),
    ),
  ],
  [
    "notices",
    [false, true].flatMap((scanComplete) =>
      [false, true].flatMap((multisigUnread) =>
        [false, true].map((retentionFull) => {
          const flags = { multisigUnread, retentionFull, scanComplete };
          const said = [
            ...(scanComplete ? [] : ["scan incomplete"]),
            ...(multisigUnread ? ["multisig unread"] : []),
            ...(retentionFull ? ["retention full"] : []),
          ];
          return {
            ...flags,
            name: said.join(", ") || "nothing to say",
            notices: listingNotices(flags),
          };
        }),
      ),
    ),
  ],
];
