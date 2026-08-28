/** Bounded extraction of the wallet-facing slice from a signed score artifact. */
import { HTTP_BODY_LIMITS } from "@mc-wallet/core/http-json";
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import { isStarkFieldElement, sameFelt } from "@mc-wallet/wallet-model/networks";
import { STRK20_MAINNET_POOL } from "../config";
import {
  isPrivacyScoreDigest,
  isPrivacyScoreIsoDate,
  isPrivacyScoreSafeInteger,
  type PrivacyScoreEnvelope,
  readPrivacyScoreSignature,
  readWithdrawalScore,
  type SnapshotSignature,
} from "./score-schema";

const MAX_CONTAINER_DEPTH = 32;
const MAX_SMALL_VALUE_CHARS = 8 * 1024;
const MAX_WITHDRAWAL_CHARS = 8 * 1024;
const MAX_WITHDRAWALS = 100_000;
const STRK20_DEPLOYMENT_BLOCK = 8_978_970;

const PAYLOAD_KEYS = [
  "chainId",
  "completeness",
  "generatedAt",
  "model",
  "poolAddress",
  "poolMetrics",
  "publicEvents",
  "schemaVersion",
  "snapshotBlockHash",
  "snapshotBlockNumber",
  "withdrawals",
] as const;

type JsonMember = {
  readonly end: number;
  readonly key: string;
  readonly start: number;
};

/**
 * Exact raw payload bytes and the small metadata needed to verify them.
 */
export type PrivacyScoreArtifact = {
  readonly payloadJson: string;
  readonly payloadSha256: string;
  readonly signature: SnapshotSignature;
};

const stringEnd = (text: string, start: number): number | null => {
  if (text[start] !== '"') return null;
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
    else if (character === '"') return index + 1;
    else if ((character?.charCodeAt(0) ?? 0) < 0x20) return null;
  }
  return null;
};

const closerFor = (character: string | undefined): string | null => {
  if (character === "{") return "}";
  if (character === "[") return "]";
  return null;
};

const isCloser = (character: string | undefined): boolean => character === "}" || character === "]";

type ContainerStep = {
  readonly completeAt?: number;
  readonly next: number;
};

const advanceContainer = (text: string, index: number, closers: string[]): ContainerStep | null => {
  const character = text[index];
  if (character === '"') {
    const end = stringEnd(text, index);
    return end ? { next: end } : null;
  }
  const nestedCloser = closerFor(character);
  if (nestedCloser) {
    if (closers.length >= MAX_CONTAINER_DEPTH) return null;
    closers.push(nestedCloser);
    return { next: index + 1 };
  }
  if (!isCloser(character)) return { next: index + 1 };
  if (closers.pop() !== character) return null;
  return closers.length === 0 ? { completeAt: index + 1, next: index + 1 } : { next: index + 1 };
};

const containerEnd = (text: string, start: number): number | null => {
  const rootCloser = closerFor(text[start]);
  if (!rootCloser) return null;
  const closers = [rootCloser];
  let index = start + 1;
  while (index < text.length) {
    const step = advanceContainer(text, index, closers);
    if (!step) return null;
    if (step.completeAt) return step.completeAt;
    index = step.next;
  }
  return null;
};

const hasObjectBounds = (text: string): boolean => text[0] === "{" && text.at(-1) === "}";

const valueEnd = (text: string, start: number): number | null => {
  const character = text[start];
  if (character === '"') return stringEnd(text, start);
  if (character === "{" || character === "[") return containerEnd(text, start);
  let index = start;
  while (index < text.length && text[index] !== "," && text[index] !== "}" && text[index] !== "]") {
    index += 1;
  }
  return index === start ? null : index;
};

const parseString = (text: string, start: number, end: number): string | null => {
  try {
    const value = JSON.parse(text.slice(start, end)) as unknown;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
};

const objectMemberAt = (text: string, index: number): JsonMember | null => {
  const keyEnd = stringEnd(text, index);
  if (!keyEnd || text[keyEnd] !== ":") return null;
  const key = parseString(text, index, keyEnd);
  const start = keyEnd + 1;
  const end = valueEnd(text, start);
  return key === null || !end ? null : { end, key, start };
};

const objectMembers = (text: string): readonly JsonMember[] | null => {
  if (!hasObjectBounds(text)) return null;
  const members: JsonMember[] = [];
  let index = 1;
  if (text[index] === "}") return members;
  while (index < text.length - 1) {
    const member = objectMemberAt(text, index);
    if (!member) return null;
    members.push(member);
    if (text[member.end] === "}") return member.end === text.length - 1 ? members : null;
    if (text[member.end] !== ",") return null;
    index = member.end + 1;
  }
  return null;
};

const parseSmall = (text: string, member: JsonMember): unknown => {
  if (member.end - member.start > MAX_SMALL_VALUE_CHARS) return undefined;
  try {
    return JSON.parse(text.slice(member.start, member.end)) as unknown;
  } catch {
    return undefined;
  }
};

const keysMatch = (members: readonly JsonMember[], expected: readonly string[]): boolean =>
  members.length === expected.length &&
  members.every((member, index) => member.key === expected[index]);

const isArrayMember = (text: string, member: JsonMember): boolean =>
  text[member.start] === "[" && text[member.end - 1] === "]";

type WithdrawalItem = {
  readonly end: number;
  readonly value: PrivacyScoreEnvelope["withdrawals"][number];
};

const arrayContinuation = (
  text: string,
  itemEnd: number,
  arrayEnd: number,
): number | "done" | null => {
  if (text[itemEnd] === "]") return itemEnd === arrayEnd - 1 ? "done" : null;
  return text[itemEnd] === "," ? itemEnd + 1 : null;
};

const withdrawalAt = (text: string, start: number): WithdrawalItem | null => {
  const end = valueEnd(text, start);
  if (!end || end - start > MAX_WITHDRAWAL_CHARS) return null;
  let input: unknown;
  try {
    input = JSON.parse(text.slice(start, end)) as unknown;
  } catch {
    return null;
  }
  const value = readWithdrawalScore(input);
  return value ? { end, value } : null;
};

const readWithdrawals = (
  text: string,
  member: JsonMember,
): PrivacyScoreEnvelope["withdrawals"] | null => {
  if (!isArrayMember(text, member)) return null;
  const withdrawals: Array<PrivacyScoreEnvelope["withdrawals"][number]> = [];
  let index = member.start + 1;
  if (text[index] === "]") return withdrawals;
  while (index < member.end - 1) {
    if (withdrawals.length >= MAX_WITHDRAWALS) return null;
    const item = withdrawalAt(text, index);
    if (!item) return null;
    withdrawals.push(item.value);
    const next = arrayContinuation(text, item.end, member.end);
    if (next === "done") return withdrawals;
    if (next === null) return null;
    index = next;
  }
  return null;
};

const validCompleteness = (value: unknown): boolean =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["completeFromDeployment", "deploymentBlock"]) &&
  value["completeFromDeployment"] === true &&
  value["deploymentBlock"] === STRK20_DEPLOYMENT_BLOCK;

const validModel = (value: unknown): boolean =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "addressReuseBoost",
    "amountLogSigma",
    "exactAmountBoost",
    "id",
    "lookbackDays",
    "recencyHalfLifeDays",
    "sameTransactionBoost",
    "targetEffectiveSet",
  ]) &&
  value["addressReuseBoost"] === 25 &&
  value["amountLogSigma"] === 1.5 &&
  value["exactAmountBoost"] === 4 &&
  value["id"] === "effective-min-entropy-v1" &&
  value["lookbackDays"] === 180 &&
  value["recencyHalfLifeDays"] === 30 &&
  value["sameTransactionBoost"] === 100 &&
  value["targetEffectiveSet"] === 100;

/**
 * Extracts the exact canonical payload substring covered by the publisher's
 * digest and signature. It never parses or walks the embedded payload tree.
 */
export const readPrivacyScoreArtifact = (text: string): PrivacyScoreArtifact | null => {
  if (text.length > HTTP_BODY_LIMITS.privacyScore) return null;
  const members = objectMembers(text);
  if (!members || !keysMatch(members, ["payload", "payloadSha256", "signature"])) return null;
  const [payload, digest, signatureMember] = members;
  if (!payload || !digest || !signatureMember || text[payload.start] !== "{") return null;
  const payloadSha256 = parseSmall(text, digest);
  const signatureInput = parseSmall(text, signatureMember);
  const signature = readPrivacyScoreSignature(signatureInput);
  if (!isPrivacyScoreDigest(payloadSha256) || !signature) return null;
  if (text.slice(signatureMember.start, signatureMember.end) !== JSON.stringify(signature)) {
    return null;
  }
  return {
    payloadJson: text.slice(payload.start, payload.end),
    payloadSha256,
    signature,
  };
};

/**
 * Reads the wallet-facing fields after {@link readPrivacyScoreArtifact}'s raw
 * payload has passed digest and signature verification. Unused signed arrays
 * are framed but never parsed, copied, or retained.
 */
export const readVerifiedPrivacyScorePayload = (
  artifact: PrivacyScoreArtifact,
): PrivacyScoreEnvelope | null => {
  const text = artifact.payloadJson;
  const members = objectMembers(text);
  if (!members || !keysMatch(members, PAYLOAD_KEYS)) return null;
  const chainId = parseSmall(text, members[0] as JsonMember);
  const completeness = parseSmall(text, members[1] as JsonMember);
  const generatedAt = parseSmall(text, members[2] as JsonMember);
  const model = parseSmall(text, members[3] as JsonMember);
  const poolAddress = parseSmall(text, members[4] as JsonMember);
  const schemaVersion = parseSmall(text, members[7] as JsonMember);
  const snapshotBlockHash = parseSmall(text, members[8] as JsonMember);
  const snapshotBlockNumber = parseSmall(text, members[9] as JsonMember);
  const withdrawalsMember = members[10];
  if (
    chainId !== "SN_MAIN" ||
    !validCompleteness(completeness) ||
    !isPrivacyScoreIsoDate(generatedAt) ||
    !validModel(model) ||
    typeof poolAddress !== "string" ||
    !sameFelt(poolAddress, STRK20_MAINNET_POOL) ||
    !isArrayMember(text, members[5] as JsonMember) ||
    !isArrayMember(text, members[6] as JsonMember) ||
    schemaVersion !== 1 ||
    typeof snapshotBlockHash !== "string" ||
    !isStarkFieldElement(snapshotBlockHash) ||
    !isPrivacyScoreSafeInteger(snapshotBlockNumber) ||
    !withdrawalsMember
  ) {
    return null;
  }
  const withdrawals = readWithdrawals(text, withdrawalsMember);
  return withdrawals
    ? {
        generatedAt,
        payloadSha256: artifact.payloadSha256,
        signature: artifact.signature,
        snapshotBlockHash,
        snapshotBlockNumber,
        withdrawals,
      }
    : null;
};
