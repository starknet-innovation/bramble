/**
 * What a co-owner is shown before signing a pool CallSet or a relay digest.
 * The CallSet digest covers the calls only, so a stored request or summary is
 * not rendered. A relay digest covers the typed data, so that is what is shown.
 */

import { isRecord } from "@bramble/core/json";
import { canonicalFelt, sameFelt } from "@bramble/wallet-model/networks";
import { hash, type TypedData, typedData } from "starknet";
import type { MultisigStrk20ActionRequest } from "./records";
import { restoreStrk20Calldata } from "./redaction";

/**
 * The summary this wallet writes for an action it proved. A co-owner's screen
 * does not render it; the calls do.
 */
export const multisigStrk20Summary = (kind: MultisigStrk20ActionRequest["kind"]): string =>
  kind === "register"
    ? "Register this multisig's private balance"
    : kind === "deposit"
      ? "Deposit into this multisig's private balance"
      : kind === "withdraw"
        ? "Withdraw from this multisig's private balance"
        : "Transfer from this multisig's private balance";

type TokenName = { readonly address: string; readonly symbol: string };

const labeledFelt = (felt: string, scalar: string, tokens: readonly TokenName[]): string | null => {
  if (sameFelt(felt, scalar)) return null;
  return tokens.find((candidate) => sameFelt(candidate.address, felt))?.symbol ?? felt;
};

/**
 * One CallSet as the signer should read it: the entrypoints, then every
 * restored felt except the shared scalar. A tracked token is named by its
 * symbol. Returns null when the scalar does not restore the calls.
 */
export const reviewMultisigStrk20Calls = (
  calls: readonly { readonly calldata: readonly string[]; readonly entrypoint: string }[],
  scalar: string,
  tokens: readonly TokenName[],
): { readonly lines: readonly string[]; readonly title: string } | null => {
  const restored = calls.map((call) => {
    const calldata = restoreStrk20Calldata(call.calldata, scalar);
    return calldata ? { calldata, entrypoint: call.entrypoint } : null;
  });
  if (restored.some((call) => call === null)) return null;
  const lines: string[] = [];
  for (const call of restored) {
    if (!call) continue;
    for (const felt of call.calldata) {
      const label = labeledFelt(felt, scalar, tokens);
      if (label) lines.push(label);
    }
  }
  const title = restored
    .map((call) => call?.entrypoint ?? "")
    .filter((entrypoint) => entrypoint.length > 0)
    .join(", ");
  return { lines, title: title.length > 0 ? title : "Calls" };
};

const typedCalls = (
  message: Record<string, unknown>,
):
  | readonly {
      readonly calldata: readonly string[];
      readonly selector: string;
      readonly to: string;
    }[]
  | null => {
  const calls = message["Calls"];
  if (!Array.isArray(calls)) return null;
  const rows = calls.map((call) => {
    if (!isRecord(call) || typeof call["To"] !== "string" || typeof call["Selector"] !== "string") {
      return null;
    }
    const calldata = call["Calldata"];
    if (!Array.isArray(calldata) || !calldata.every((felt) => typeof felt === "string"))
      return null;
    return { calldata, selector: call["Selector"], to: call["To"] };
  });
  return rows.every((row) => row !== null) ? rows : null;
};

const titleFor = (entrypoint: string | undefined, selectors: readonly string[]): string => {
  if (!entrypoint) return "Calls";
  try {
    const selector = hash.getSelectorFromName(entrypoint);
    return selectors.every((value) => sameFelt(value, selector)) ? entrypoint : "Calls";
  } catch {
    return "Calls";
  }
};

const typedDigest = (value: TypedData, accountAddress: string): string | null => {
  try {
    return canonicalFelt(typedData.getMessageHash(value, accountAddress));
  } catch {
    return null;
  }
};

const typedLines = (
  calls: readonly { readonly calldata: readonly string[]; readonly to: string }[],
  scalar: string,
  tokens: readonly TokenName[],
): readonly string[] => {
  const lines: string[] = [];
  for (const call of calls) {
    const to = labeledFelt(call.to, scalar, tokens);
    if (to) lines.push(to);
    for (const felt of call.calldata) {
      const label = labeledFelt(felt, scalar, tokens);
      if (label) lines.push(label);
    }
  }
  return lines;
};

/**
 * The relay typed data, once its digest matches `messageHash`. Lines are the
 * call addresses and calldata the digest covers. `entrypoint` is used as the
 * title only when every call selector is that name. Returns null when the
 * digest does not match, so a substituted label cannot be shown.
 */
export const reviewMultisigStrk20TypedData = (
  value: unknown,
  accountAddress: string,
  messageHash: string,
  scalar: string,
  tokens: readonly TokenName[],
  entrypoint?: string,
): { readonly lines: readonly string[]; readonly title: string } | null => {
  if (!isRecord(value)) return null;
  const digest = typedDigest(value as unknown as TypedData, accountAddress);
  if (!digest || !sameFelt(digest, messageHash)) return null;
  const message = value["message"];
  const calls = isRecord(message) ? typedCalls(message) : null;
  if (!calls) return { lines: [messageHash], title: "Calls" };
  return {
    lines: typedLines(calls, scalar, tokens),
    title: titleFor(
      entrypoint,
      calls.map((call) => call.selector),
    ),
  };
};
