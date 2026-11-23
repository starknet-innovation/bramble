/**
 * The `flags` block of the call-review fixture: whole batches through `verifyCalls`
 * (`routing/verify.ts`) with the review context written out, the allowance log seeded through
 * `standingAllowanceTotals` under `allowanceOwner` as the dapp invoke seeds it
 * (`provider-ops.ts`), and the one refusal, `refuseOnPoisonedRecipient`. Batches are crafted so
 * every flag is raised at least once, beside a clean batch.
 */

import type { AllowanceRecord } from "@bramble/transactions/allowance-store";
import { standingAllowanceTotals } from "@bramble/transactions/allowances";
import {
  refuseOnPoisonedRecipient,
  type VerificationContext,
  verifyCalls,
} from "@bramble/transactions/verify";
import { canonicalFelt, type StarknetNetworkId } from "@bramble/wallet-model/networks";
import type { Call } from "starknet";
import { allowanceOwner } from "../../apps/extension/src/background/portfolio/allowance-recording";
import {
  ACCOUNT,
  avnuRoute,
  CONTACT,
  CONTACT_TWIN,
  call,
  ETH,
  HALF_U128,
  NFT,
  ONE_AND_A_HALF,
  OTHER_UNKNOWN,
  OWN_ACCOUNT,
  OWN_TWIN,
  PAID,
  PAID_TWIN,
  RECIPIENT,
  ROUTER,
  SPENDER,
  STRK,
  trackedTokens,
  U128_MAX,
  UNKNOWN,
  USDC,
} from "./shared";

/** Three below the unlimited threshold (`2^128 - 1`): five more crosses it. */
const JUST_BELOW = (2n ** 128n - 4n).toString();

const accountId = (networkId: StarknetNetworkId, address = ACCOUNT) => `${networkId}:${address}`;

/** A stored allowance record of `amount` base units for `(token, spender)`. */
const record = (
  token: string,
  amount: string,
  {
    networkId = "SN_MAIN",
    owner = ACCOUNT,
  }: { networkId?: StarknetNetworkId; owner?: string } = {},
): AllowanceRecord => {
  const id = accountId(networkId, owner);
  return {
    accountId: id,
    amount,
    id: `${id}:${canonicalFelt(token)}:${canonicalFelt(SPENDER)}`,
    networkId,
    spender: canonicalFelt(SPENDER) ?? SPENDER,
    token: canonicalFelt(token) ?? token,
  };
};

type Case = {
  readonly name: string;
  readonly calls: readonly Call[];
  readonly networkId?: StarknetNetworkId;
  readonly standing?: readonly AllowanceRecord[];
};

const send = (to: string, token = STRK) => call(token, "transfer", [to, ONE_AND_A_HALF, 0]);
const grant = (entrypoint: string, amountLow: string, token = STRK, high = "0") =>
  call(token, entrypoint, [SPENDER, amountLow, high]);
const swap = (beneficiary: string, extra: readonly string[] = []) =>
  call(ROUTER, "multi_route_swap", avnuRoute(STRK, ETH, beneficiary, extra));

const CASES: readonly Case[] = [
  { calls: [send(CONTACT), grant("approve", ONE_AND_A_HALF)], name: "a clean batch" },
  { calls: [call(UNKNOWN, "mint", [1])], name: "an unknown contract" },
  {
    calls: [
      call(UNKNOWN, "mint", [1]),
      call(OTHER_UNKNOWN, "mint", [2]),
      call(UNKNOWN, "burn", []),
    ],
    name: "two unknown contracts, one twice",
  },
  { calls: [call(ROUTER, "deposit", [1])], name: "a pinned contract" },
  { calls: [grant("approve", U128_MAX, STRK, U128_MAX)], name: "an unlimited approve" },
  { calls: [grant("approve", JUST_BELOW)], name: "an approve just below the threshold" },
  {
    calls: [grant("increase_allowance", HALF_U128), grant("increaseAllowance", HALF_U128)],
    name: "two increases that cross together",
  },
  {
    calls: [grant("increase_allowance", HALF_U128), grant("increase_allowance", HALF_U128, ETH)],
    name: "increases on two tokens",
  },
  {
    calls: [grant("increase_allowance", "5")],
    name: "an increase over a standing allowance",
    standing: [record(STRK, JUST_BELOW)],
  },
  {
    calls: [grant("decrease_allowance", "5"), grant("increase_allowance", "5")],
    name: "a decrease before the increase",
    standing: [record(STRK, JUST_BELOW)],
  },
  {
    calls: [grant("decreaseAllowance", U128_MAX, STRK, U128_MAX), grant("increase_allowance", "5")],
    name: "a decrease past zero",
    standing: [record(STRK, JUST_BELOW)],
  },
  {
    calls: [grant("approve", "1"), grant("increase_allowance", "5")],
    name: "an approve replaces the standing allowance",
    standing: [record(STRK, (2n ** 128n - 1n).toString())],
  },
  {
    calls: [grant("increase_allowance", "5")],
    name: "standing records of another account, network or token",
    standing: [
      record(STRK, JUST_BELOW, { owner: OWN_ACCOUNT }),
      record(STRK, JUST_BELOW, { networkId: "SN_SEPOLIA" }),
      record(UNKNOWN, JUST_BELOW),
      record(NFT, JUST_BELOW),
    ],
  },
  {
    calls: [call(NFT, "approve", [SPENDER, U128_MAX, U128_MAX])],
    name: "an item approval on a watched collection",
  },
  { calls: [call(NFT, "set_approval_for_all", [SPENDER, 1])], name: "an operator grant" },
  { calls: [call(NFT, "setApprovalForAll", [SPENDER, 0])], name: "an operator revoke" },
  { calls: [send(ACCOUNT)], name: "a payment to the account itself" },
  {
    calls: [call(NFT, "transfer_from", [ACCOUNT, ACCOUNT, 7, 0])],
    name: "an item moved to the account itself",
  },
  { calls: [send(ETH)], name: "a payment to a tracked token" },
  { calls: [send(USDC)], name: "a payment to a curated token" },
  { calls: [send(STRK, UNKNOWN)], name: "STRK paid on an unknown contract" },
  { calls: [swap(ACCOUNT)], name: "a swap paid to the account" },
  { calls: [swap(RECIPIENT)], name: "a swap paid elsewhere" },
  { calls: [swap(ACCOUNT, ["0x1"])], name: "an undecoded swap paid to the account" },
  { calls: [swap(RECIPIENT, ["0x1"])], name: "an undecoded swap paid elsewhere" },
  { calls: [send(CONTACT_TWIN)], name: "a payee mimicking a contact" },
  { calls: [send(OWN_TWIN)], name: "a payee mimicking another own account" },
  { calls: [send(PAID_TWIN)], name: "a payee mimicking a paid recipient" },
  { calls: [send(OWN_ACCOUNT), send(PAID)], name: "payments to an own account and a paid one" },
  {
    calls: [call(NFT, "safe_transfer_from", [ACCOUNT, CONTACT_TWIN, 7, 0, 3])],
    name: "an undescribed safe transfer to a lookalike",
  },
  { calls: [swap(CONTACT_TWIN)], name: "a swap paying a lookalike" },
  {
    calls: [send(CONTACT), grant("approve", U128_MAX, STRK, U128_MAX), send(ETH, ETH)],
    name: "a sepolia batch",
    networkId: "SN_SEPOLIA",
  },
];

/** The review context of `networkId`: everything `verifyCalls` reads besides the calls. */
const contextFor = (networkId: StarknetNetworkId): VerificationContext => ({
  account: { address: ACCOUNT, networkId },
  addressBook: [{ address: CONTACT, label: "Contact", networkId }] as never[],
  knownContracts: [ROUTER],
  nftContracts: [NFT],
  ownAccounts: [OWN_ACCOUNT],
  recentRecipients: [PAID],
  tokens: trackedTokens(networkId),
});

/** Every flag case: the batch, its context and allowance log, and what the extension reports. */
export const computeFlags = () =>
  CASES.map(({ calls, name, networkId = "SN_MAIN", standing = [] }) => {
    const context = contextFor(networkId);
    const totals = standingAllowanceTotals(
      standing,
      allowanceOwner({ id: accountId(networkId), networkId }),
      context,
    );
    const report = verifyCalls(calls, context, totals);
    return {
      calls,
      context: {
        account: context.account,
        addressBook: context.addressBook.map((entry) => entry.address),
        knownContracts: context.knownContracts,
        nftContracts: context.nftContracts,
        ownAccounts: context.ownAccounts,
        recentRecipients: context.recentRecipients,
        tokens: context.tokens,
      },
      decoded: report.calls.map(({ kind, summary }) => ({ kind, summary })),
      flags: report.flags,
      name,
      refusal: refuseOnPoisonedRecipient(report)?.error ?? null,
      standing,
    };
  });
