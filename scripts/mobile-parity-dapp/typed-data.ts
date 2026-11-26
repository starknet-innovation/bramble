/**
 * The `typedData` and `outside` blocks: a site's SNIP-12 typed data as the extension judges it
 * before queuing a sign card (`chain-ops.ts`'s `queueSignTypedData`).
 *
 * - `typedData`: the gate (`isTypedDataShape`), the chain-bound hash for the account on Mainnet
 *   and Sepolia (`typedDataHashForChain`; starknet.js hashes, so `hash` is its message hash or
 *   the sentence that refused), and the card's summary (`describeTypedData`).
 * - `outside`: a SNIP-9 outside execution, as starknet.js's `outsideExecution.getTypedData`
 *   builds it (v1 and v2) or hand-broken, reviewed by `reviewOutsideExecution` at queue time (with
 *   the allowance log) and at signing (without it, as `signTypedDataApproval` calls it): the risk
 *   flags and call summaries, a refusal's sentence, or `null` for typed data that is not one.
 *   The trusted set is the call-review fixture's (`mobile-parity-calls/shared.ts`).
 */

import { isTypedDataShape, typedDataHashForChain } from "@bramble/starknet/typed-data";
import type { AllowanceRecord } from "@bramble/transactions/allowance-store";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import { type Call, OutsideExecutionVersion, outsideExecution } from "starknet";
import { reviewOutsideExecution } from "../../apps/extension/src/background/transactions/outside-execution-review";
import { describeTypedData } from "../../apps/extension/src/background/transactions/typed-data-summary";
import {
  ACCOUNT,
  CONTACT,
  CONTACT_TWIN,
  call,
  NFT,
  ONE_AND_A_HALF,
  OWN_ACCOUNT,
  OWN_TWIN,
  PAID,
  PAID_TWIN,
  SPENDER,
  STRK,
  trackedTokens,
  U128_MAX,
  UNKNOWN,
} from "../mobile-parity-calls/shared";
import { MAINNET_CHAIN_ID, SEPOLIA_CHAIN_ID, thrownMessage } from "./shared";

const REV1_DOMAIN_TYPE = ["name", "version", "chainId", "revision"].map((name) => ({
  name,
  type: "shortstring",
}));
const REV0_DOMAIN_TYPE = ["name", "version", "chainId"].map((name) => ({ name, type: "felt" }));

/** A revision 1 document with `message` of `primary`, its fields declared by `fields`. */
const rev1 = (
  domain: Record<string, unknown>,
  fields: readonly object[] = [{ name: "content", type: "felt" }],
  message: Record<string, unknown> = { content: "hello" },
  extra: Record<string, unknown> = {},
  primaryType = "Mail",
) => ({
  domain: { chainId: "SN_MAIN", name: "Bramble Test", revision: "1", version: "1", ...domain },
  message,
  primaryType,
  types: { [primaryType]: fields, StarknetDomain: REV1_DOMAIN_TYPE, ...extra },
});

const rev0 = (domain: Record<string, unknown> = {}) => ({
  domain: { chainId: "SN_MAIN", name: "Bramble Test", version: "1", ...domain },
  message: { content: "0x1", memo: "hello" },
  primaryType: "Note",
  types: {
    Note: [
      { name: "content", type: "felt" },
      { name: "memo", type: "shortstring" },
    ],
    StarkNetDomain: REV0_DOMAIN_TYPE,
  },
});

const DOCUMENTS: readonly (readonly [string, unknown])[] = [
  ["revision 1 on Mainnet", rev1({})],
  ["revision 1 on Sepolia", rev1({ chainId: "SN_SEPOLIA" })],
  ["revision 1, the chain id as its felt", rev1({ chainId: MAINNET_CHAIN_ID })],
  ["revision 1, a numeric revision", rev1({ revision: 1 })],
  ["revision 0 on Mainnet", rev0()],
  ["revision 0, the chain id as its felt", rev0({ chainId: MAINNET_CHAIN_ID })],
  ["revision 0 on another chain", rev0({ chainId: "SN_GOERLI" })],
  [
    "revision 1 with no chain id",
    (() => {
      const document = rev1({});
      const { chainId: _dropped, ...domain } = document.domain;
      return {
        ...document,
        domain,
        types: {
          ...document.types,
          StarknetDomain: REV1_DOMAIN_TYPE.filter((f) => f.name !== "chainId"),
        },
      };
    })(),
  ],
  ["an undeclared domain key", rev1({ salt: "0x1" })],
  ["an extra envelope key", { ...rev1({}), extra: true }],
  ["an undeclared primary type", { ...rev1({}), primaryType: "Missing" }],
  [
    "a type name carrying a separator",
    rev1({}, [{ name: "content", type: "felt" }], { content: "0x1" }, {}, "Mail,Evil"),
  ],
  [
    "a field name carrying a separator",
    rev1({}, [{ name: "a:b", type: "felt" }], { "a:b": "0x1" }),
  ],
  ["a message missing its field", rev1({}, undefined, {})],
  ["a message with an undeclared key", rev1({}, undefined, { content: "0x1", other: "0x2" })],
  ["a felt past the field", rev1({}, undefined, { content: `0x${"f".repeat(64)}` })],
  [
    "a u256 preset",
    rev1({}, [{ name: "amount", type: "u256" }], { amount: { high: "0x0", low: "0x64" } }),
  ],
  [
    "a nested struct and an array",
    rev1(
      {},
      [
        { name: "to", type: "Person" },
        { name: "tags", type: "felt*" },
      ],
      { tags: ["0x1", "0x2"], to: { name: "Bob", wallet: "0x2" } },
      {
        Person: [
          { name: "name", type: "shortstring" },
          { name: "wallet", type: "ContractAddress" },
        ],
      },
    ),
  ],
  [
    "an enum, the unit variant",
    rev1(
      {},
      [{ contains: "Choice", name: "pick", type: "enum" }],
      { pick: { Yes: [] } },
      {
        Choice: [
          { name: "Yes", type: "()" },
          { name: "No", type: "(felt)" },
        ],
      },
    ),
  ],
  [
    "an enum, the payload variant",
    rev1(
      {},
      [{ contains: "Choice", name: "pick", type: "enum" }],
      { pick: { No: ["0x5"] } },
      {
        Choice: [
          { name: "Yes", type: "()" },
          { name: "No", type: "(felt)" },
        ],
      },
    ),
  ],
  [
    "a merkletree of felts",
    rev1({}, [{ contains: "felt", name: "root", type: "merkletree" }], { root: ["0x1", "0x2"] }),
  ],
  [
    "a one-field domain",
    {
      domain: { name: "App", revision: "1" },
      message: { content: "0x1" },
      primaryType: "Mail",
      types: {
        Mail: [{ name: "content", type: "felt" }],
        StarknetDomain: [{ name: "name", type: "shortstring" }],
      },
    },
  ],
  [
    "domain fields in another order",
    rev1({}, undefined, undefined, {
      StarknetDomain: ["name", "chainId", "version", "revision"].map((name) => ({
        name,
        type: "shortstring",
      })),
    }),
  ],
  ["a long domain name", rev1({ name: "N".repeat(70) })],
  ["a long primary type", rev1({}, undefined, undefined, {}, `P${"q".repeat(70)}`)],
  ["no domain name", rev1({ name: "" })],
  ["an array", [rev1({})]],
  ["a string", "hello"],
];

/** Every document: the gate, the chain-bound hash on each network, and the card's summary. */
export const computeTypedData = (): readonly object[] =>
  DOCUMENTS.map(([name, document]) => {
    const hashOn = (chainId: string) => {
      try {
        return { hash: typedDataHashForChain(document, ACCOUNT, chainId) };
      } catch (error) {
        return { refused: thrownMessage(error) };
      }
    };
    return {
      account: ACCOUNT,
      document,
      mainnet: hashOn(MAINNET_CHAIN_ID),
      name,
      sepolia: hashOn(SEPOLIA_CHAIN_ID),
      shape: isTypedDataShape(document),
      summary: describeTypedData(document),
    };
  });

const send = (to: string) => call(STRK, "transfer", [to, ONE_AND_A_HALF, 0]);
const grant = (entrypoint: string, spender: string, low: string, high = "0") =>
  call(STRK, entrypoint, [spender, low, high]);

/** starknet.js's outside execution for `calls` on Mainnet, v2 unless `v1`. */
const outside = (calls: readonly Call[], v1 = false) =>
  outsideExecution.getTypedData(
    "SN_MAIN",
    { caller: "0x414e595f43414c4c4552", execute_after: "0x1", execute_before: "0xe8d4a50fff" },
    "0x7",
    [...calls],
    v1 ? OutsideExecutionVersion.V1 : OutsideExecutionVersion.V2,
  ) as unknown as Record<string, unknown> & { message: Record<string, unknown> };

const JUST_BELOW = (2n ** 128n - 4n).toString();
const STANDING: AllowanceRecord = {
  accountId: `SN_MAIN:${ACCOUNT}`,
  amount: JUST_BELOW,
  id: `SN_MAIN:${ACCOUNT}:${canonicalFelt(STRK)}:${canonicalFelt(SPENDER)}`,
  networkId: "SN_MAIN",
  spender: canonicalFelt(SPENDER) ?? SPENDER,
  token: canonicalFelt(STRK) ?? STRK,
};

const broken = (mutate: (document: ReturnType<typeof outside>) => unknown) =>
  mutate(structuredClone(outside([send(CONTACT)])));

const OUTSIDE: readonly (readonly [string, unknown])[] = [
  ["a transfer to a contact, v2", outside([send(CONTACT)])],
  ["a transfer to a contact, v1", outside([send(CONTACT)], true)],
  ["an unlimited approve", outside([grant("approve", SPENDER, U128_MAX, U128_MAX)])],
  ["an increase over a standing allowance", outside([grant("increase_allowance", SPENDER, "5")])],
  ["an unknown contract", outside([call(UNKNOWN, "mint", [1])])],
  ["a payee mimicking a contact", outside([send(CONTACT_TWIN)])],
  ["a payee mimicking an own account, v1", outside([send(OWN_TWIN)], true)],
  ["a payee mimicking a paid recipient", outside([send(PAID_TWIN)])],
  ["a spender mimicking a contact", outside([grant("approve", CONTACT_TWIN, "1")])],
  ["an operator grant", outside([call(NFT, "set_approval_for_all", [SPENDER, 1])])],
  ["payments to an own account and a paid one", outside([send(OWN_ACCOUNT), send(PAID)])],
  ["a call to the account itself", outside([call(ACCOUNT, "upgrade", [1])])],
  ["a selector the decoder does not know", outside([call(STRK, "frobnicate", [1])])],
  [
    "a call with no calldata",
    broken((d) => {
      delete (d.message["Calls"] as Record<string, unknown>[])[0]?.["Calldata"];
      return d;
    }),
  ],
  [
    "both call lists",
    broken((d) => ({ ...d, message: { ...d.message, calls: d.message["Calls"] } })),
  ],
  [
    "a calldata felt past the field",
    broken((d) => {
      ((d.message["Calls"] as Record<string, unknown>[])[0] as Record<string, unknown>)[
        "Calldata"
      ] = [`0x${"f".repeat(64)}`];
      return d;
    }),
  ],
  ["not an outside execution", rev1({})],
];

const PREFERENCES = {
  addressBook: [{ address: CONTACT, label: "Contact", networkId: "SN_MAIN" }] as never[],
  dappTokenIds: [],
  nfts: [{ contract: NFT, networkId: "SN_MAIN" }] as never[],
  ownAccounts: [{ address: OWN_ACCOUNT, networkId: "SN_MAIN" as const }],
  paidRecipients: [{ address: PAID, networkId: "SN_MAIN" as const }],
  tokens: trackedTokens("SN_MAIN"),
};
const ACTOR = { address: ACCOUNT, id: `SN_MAIN:${ACCOUNT}`, networkId: "SN_MAIN" as const };

/** Each outside execution reviewed at queue time and at signing. */
export const computeOutside = (): readonly object[] =>
  OUTSIDE.map(([name, document]) => {
    const at = (stage: "queue" | "sign") => {
      const review = reviewOutsideExecution(
        document,
        ACTOR,
        PREFERENCES,
        stage === "queue" ? [STANDING] : [],
        stage,
      );
      if (review === null || "error" in review) return review;
      return { flags: review.flags, summaries: review.summaries };
    };
    return {
      account: ACTOR,
      context: {
        addressBook: [CONTACT],
        nftContracts: [NFT],
        ownAccounts: [OWN_ACCOUNT],
        recentRecipients: [PAID],
        tokens: PREFERENCES.tokens,
      },
      document,
      name,
      queue: at("queue"),
      shape: isTypedDataShape(document),
      sign: at("sign"),
      standing: [STANDING],
      summary: describeTypedData(document),
    };
  });
