/**
 * Decodes the one call a multisig STRK20 CallSet carries: the privacy pool's
 * `compile_actions(user_addr, user_private_key, Span<ClientAction>)`. Every
 * field in this flow's actions is one felt, so the layout below is exact.
 * `tests/conformance/pool-client-actions-abi.test.ts` fails when it drifts from
 * the pinned pool ABI. Anything outside it, and any action this flow never
 * produces, decodes to null and must not be signed.
 */

import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  sameFelt,
  UINT128_LIMIT,
} from "@bramble/wallet-model/networks";

/**
 * `ClientAction` variants in ABI order, with their struct members. Index 8
 * (`InvokeExternal`) and 9 (`ComputeAndInvoke`) carry arbitrary calldata and
 * are not listed, so they never decode.
 */
export const POOL_CLIENT_ACTION_LAYOUT: readonly (readonly [string, readonly string[]])[] = [
  ["SetViewingKey", ["random"]],
  ["OpenChannel", ["recipient_addr", "index", "random", "salt"]],
  [
    "OpenSubchannel",
    ["recipient_addr", "recipient_public_key", "channel_key", "index", "token", "salt"],
  ],
  ["CreateEncNote", ["recipient_addr", "recipient_public_key", "token", "amount", "index", "salt"]],
  ["CreateOpenNote", ["recipient_addr", "recipient_public_key", "token", "index", "random"]],
  ["Deposit", ["token", "amount"]],
  ["UseNote", ["channel_key", "token", "index"]],
  ["Withdraw", ["to_addr", "token", "amount", "random"]],
];

/** The most client actions one CallSet may carry. */
const MAX_ACTIONS = 64;

/**
 * One decoded client action. `setup` is channel and note bookkeeping that
 * moves no value; it is checked but not shown.
 */
export type MultisigStrk20PoolAction =
  | { readonly kind: "register" }
  | { readonly kind: "setup" }
  | { readonly amount: bigint; readonly kind: "deposit"; readonly token: string }
  | {
      readonly amount: bigint;
      readonly kind: "note" | "withdraw";
      readonly recipient: string;
      readonly token: string;
    };

const address = (felt: string | undefined): string | null => {
  const value = canonicalFelt(felt ?? "");
  return value !== null && isNonZeroStarkFieldElement(value) ? value : null;
};

const amount = (felt: string | undefined): bigint | null => {
  const value = canonicalFelt(felt ?? "");
  if (value === null) return null;
  const raw = BigInt(value);
  return raw < UINT128_LIMIT ? raw : null;
};

const actionFrom = (
  variant: string,
  fields: Readonly<Record<string, string>>,
): MultisigStrk20PoolAction | null => {
  if (variant === "SetViewingKey") return { kind: "register" };
  if (variant === "OpenChannel" || variant === "OpenSubchannel" || variant === "UseNote") {
    return { kind: "setup" };
  }
  const token = address(fields["token"]);
  const value = amount(fields["amount"]);
  if (!token || value === null) return null;
  if (variant === "Deposit") return { amount: value, kind: "deposit", token };
  const recipient = address(fields["recipient_addr"] ?? fields["to_addr"]);
  if (!recipient) return null;
  if (variant === "CreateEncNote") return { amount: value, kind: "note", recipient, token };
  if (variant === "Withdraw") return { amount: value, kind: "withdraw", recipient, token };
  return null;
};

const variantAt = (felt: string | undefined): readonly [string, readonly string[]] | null => {
  const tag = canonicalFelt(felt ?? "");
  const at = tag === null ? -1n : BigInt(tag);
  return at >= 0n && at < BigInt(POOL_CLIENT_ACTION_LAYOUT.length)
    ? (POOL_CLIENT_ACTION_LAYOUT[Number(at)] ?? null)
    : null;
};

const U32_LIMIT = 1n << 32n;

// Every member must be a felt; `index` is a u32 and a note's `salt` a u128,
// so calldata Cairo could not deserialize is refused rather than reviewed.
const fitsAbi = (variant: string, member: string, felt: string | undefined): boolean => {
  const value = canonicalFelt(felt ?? "");
  if (value === null) return false;
  if (member === "index") return BigInt(value) < U32_LIMIT;
  if (variant === "CreateEncNote" && member === "salt") return BigInt(value) < UINT128_LIMIT;
  return true;
};

// One enum value at `offset`: its variant felt, then one felt per member.
const actionAt = (
  calldata: readonly string[],
  offset: number,
): { readonly action: MultisigStrk20PoolAction; readonly next: number } | null => {
  const entry = variantAt(calldata[offset]);
  if (!entry) return null;
  const [variant, members] = entry;
  const next = offset + 1 + members.length;
  if (next > calldata.length) return null;
  const fields: Record<string, string> = {};
  for (const [at, member] of members.entries()) {
    const felt = calldata[offset + 1 + at];
    if (!fitsAbi(variant, member, felt)) return null;
    fields[member] = felt ?? "";
  }
  const action = actionFrom(variant, fields);
  return action ? { action, next } : null;
};

/**
 * Decodes restored `compile_actions` calldata. Returns null unless the user is
 * `accountAddress`, the key is `scalar`, every action is one this flow
 * produces, and the span consumes the calldata exactly.
 */
export const decodeMultisigStrk20CompileActions = (
  calldata: readonly string[],
  accountAddress: string,
  scalar: string,
): readonly MultisigStrk20PoolAction[] | null => {
  const [user, key, length] = calldata;
  if (!user || !key || !sameFelt(user, accountAddress) || !sameFelt(key, scalar)) return null;
  const count = canonicalFelt(length ?? "");
  if (count === null || BigInt(count) > BigInt(MAX_ACTIONS)) return null;
  const actions: MultisigStrk20PoolAction[] = [];
  let offset = 3;
  for (let index = 0; index < Number(count); index += 1) {
    const decoded = actionAt(calldata, offset);
    if (!decoded) return null;
    actions.push(decoded.action);
    offset = decoded.next;
  }
  return offset === calldata.length ? actions : null;
};
