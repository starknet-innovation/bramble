/**
 * The `review` block: one call batch each through the background's multisig call review
 * (`reviewArgentMultisigCalls`, which runs `requireSafeArgentMultisigCalls`, then either the
 * signer-change review or `verifyCalls` with the multisig as a contact and the vault's accounts
 * trusted, and `refuseOnPoisonedRecipient`), and the summary it returns or the refusal. The
 * single-call decodes are G7c's (`extension-call-review.jsonl`); this pins what the multisig path
 * adds: the `(+N more)` suffix, the 120-character cut, the multisig's own trust set, staking
 * batches as the wallet builds them, and the self-call rules.
 */
import { type ArgentMultisigCall, argentMultisigConfigChangeCall } from "@bramble/multisig/chain";
import { buildStakingCalls, type StakingBuildInput } from "@bramble/transactions/staking-calls";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import type { Call } from "starknet";
import { reviewArgentMultisigCalls } from "../../apps/extension/src/background/multisig/multisig-call-review";
import { signerChanges } from "../mobile-multisig-transactions";
import {
  avnuRoute,
  CONTACT,
  call,
  ETH,
  ONE_AND_A_HALF,
  OTHER_UNKNOWN,
  RECIPIENT,
  ROUTER,
  SPENDER,
  STRK,
  U128_MAX,
  UNKNOWN,
} from "../mobile-parity-calls/shared";
import { caseWallet, currentAuthority, NONCE, type Setup } from "./shared";

/** `call` with its contract address in the canonical spelling a frozen intent requires. */
const frozen = (value: Call): ArgentMultisigCall => ({
  calldata: (value.calldata ?? []) as string[],
  contractAddress: canonicalFelt(value.contractAddress) ?? "",
  entrypoint: value.entrypoint,
});

/** The self-call of G5's signer change `name` against the fixture's multisig. */
export const signerChangeCall = (setup: Setup, name: string): ArgentMultisigCall => {
  const change = signerChanges(setup.signers)[name];
  if (!change) throw new Error(`no signer change ${name}`);
  return argentMultisigConfigChangeCall(setup.record.address, change);
};

/** An address that renders like `address` (same first and last four digits) but is not it. */
export const lookalike = (address: string): string => {
  const digits = (canonicalFelt(address) ?? "").slice(2);
  const twin = `0x${digits.slice(0, 4)}${"1".repeat(digits.length - 8)}${digits.slice(-4)}`;
  if (twin === `0x${digits}`) throw new Error(`no lookalike of ${address}`);
  return twin;
};

/** A 1.5 STRK transfer to `to`. */
export const transferTo = (to: string) => frozen(call(STRK, "transfer", [to, ONE_AND_A_HALF, 0]));

const POOL = "0x6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b";
const staking = (setup: Setup, action: StakingBuildInput["action"]) => {
  const member = { amount: 10n ** 18n, rewardAddress: setup.record.address, unclaimedRewards: 7n };
  const built = buildStakingCalls({
    account: setup.record.address,
    action,
    amount: 10n ** 18n,
    member:
      action === "stake"
        ? "none"
        : { ...member, unpoolAmount: 0n, unpoolTime: action === "withdraw" ? 1 : null },
    nowSeconds: 2,
    pool: { accepting: true, commission: 500, delegated: 0n, pool: POOL },
    token: STRK,
  });
  if ("refusal" in built) throw new Error(built.refusal);
  return built.map(frozen);
};

/** The calls of each case, built against the fixture's multisig. */
const cases = (
  setup: Setup,
): readonly (readonly [string, readonly ArgentMultisigCall[], boolean?])[] => {
  const self = setup.record.address;
  const change = (name: string) => signerChangeCall(setup, name);
  const swap = (beneficiary: string) =>
    frozen(call(ROUTER, "multi_route_swap", avnuRoute(STRK, ETH, beneficiary)));
  // Two untracked tokens, so both amounts are spelled in base units; `sell` sets the length.
  const longSwap = (sell: string) => {
    const route = avnuRoute(UNKNOWN, OTHER_UNKNOWN, self);
    route[1] = sell;
    return frozen(call(ROUTER, "multi_route_swap", route));
  };
  return [
    ["a transfer to a contact", [transferTo(CONTACT)]],
    ["a transfer to an unknown recipient", [transferTo(RECIPIENT)]],
    ["a transfer to the vault's own account", [transferTo(setup.vaultAccount.address)]],
    ["an approve", [frozen(call(STRK, "approve", [SPENDER, ONE_AND_A_HALF, 0]))]],
    ["an unlimited approve", [frozen(call(STRK, "approve", [SPENDER, U128_MAX, U128_MAX]))]],
    [
      "an AVNU swap paid to the multisig, after its approve",
      [frozen(call(STRK, "approve", [ROUTER, ONE_AND_A_HALF, 0])), swap(self)],
    ],
    ["an AVNU swap alone", [swap(self)]],
    ["a stake: approve then enter the pool", staking(setup, "stake")],
    ["a staking claim", staking(setup, "claim")],
    ["a staking unstake", staking(setup, "unstake")],
    ["a staking withdraw", staking(setup, "withdraw")],
    ["an unknown call", [frozen(call(UNKNOWN, "mint", [1]))]],
    [
      "a three-call multicall",
      [
        transferTo(CONTACT),
        frozen(call(STRK, "approve", [SPENDER, ONE_AND_A_HALF, 0])),
        frozen(call(UNKNOWN, "mint", [1])),
      ],
    ],
    // 2^128 - 1 sold: the first line alone runs past the cut.
    ["a summary cut at 120 characters", [longSwap(U128_MAX), transferTo(CONTACT)]],
    // 10^29 sold: the cut lands on the space before "(+1 more)", which is trimmed.
    [
      "a summary cut on a space and trimmed",
      [longSwap(`0x${(10n ** 29n).toString(16)}`), transferTo(CONTACT)],
    ],
    ["a signer change", [change("addSigners")]],
    ["a signer change without the current config", [change("changeThreshold")], true],
    ["a self-call inside a batch", [transferTo(CONTACT), change("changeThreshold")]],
    ["a transfer to a contact's lookalike", [transferTo(lookalike(CONTACT))]],
    [
      "a transfer to the vault account's lookalike",
      [transferTo(lookalike(setup.vaultAccount.address))],
    ],
    ["a transfer to the multisig's own lookalike", [transferTo(lookalike(self))]],
    [
      "a poisoned transfer second in a batch",
      [transferTo(CONTACT), transferTo(lookalike(CONTACT))],
    ],
    [
      "an approve to a contact's lookalike",
      [frozen(call(STRK, "approve", [lookalike(CONTACT), 5, 0]))],
    ],
    ["a swap paid to a contact's lookalike", [swap(lookalike(CONTACT))]],
  ];
};

/** Cases whose pinned answer is the extension's today but awaits a decision. */
const DIVERGENCES: Readonly<Record<string, string>> = {
  "an approve to a contact's lookalike":
    "Not refused today because the poisoning check reads only payees; a fix on main will refuse a lookalike spender.",
};

/** Every case: its calls, whether the current config is known, and the summary or refusal. */
export const computeReviews = async (setup: Setup): Promise<readonly object[]> => {
  // The review reads no chain state; the reads are the import block's defaults.
  const { deps } = await caseWallet(setup, {
    authority: currentAuthority(setup.record),
    nonce: NONCE,
  });
  const results = [];
  for (const [name, calls, withoutConfig] of cases(setup)) {
    const config = withoutConfig ? null : (setup.record.currentConfig ?? null);
    let outcome: object;
    try {
      outcome = await reviewArgentMultisigCalls(
        deps,
        { record: setup.record } as Parameters<typeof reviewArgentMultisigCalls>[1],
        calls,
        config,
      );
    } catch (error) {
      outcome = { thrown: error instanceof Error ? error.message : String(error) };
    }
    const divergence = DIVERGENCES[name];
    results.push({
      calls,
      currentConfig: config,
      ...(divergence ? { divergence } : {}),
      name,
      ...outcome,
    });
  }
  return results;
};
