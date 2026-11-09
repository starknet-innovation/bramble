/**
 * Scoring for the Sepolia verification run (verify-sepolia.ts): the TA cards,
 * how an observation is scored against a card's "Now" expectation, and the
 * run's results in order. Shared by the phrase/key checks
 * (verify-sepolia-checks.ts) and the opt-in Ledger checks
 * (verify-sepolia-ledger.ts). Every printed or recorded error is redacted.
 */
import { loadManifest } from "./matrix-lib";
import { redact } from "./sepolia-redact";
import type { Row } from "./verify-sepolia-ui";

const manifest = loadManifest();

/** The manifest address of fixture `id`; throws if manifest/sepolia/ lacks it. */
export const addressOf = (id: string): string => {
  const entry = manifest[id];
  if (!entry) throw new Error(`${id} is not in manifest/sepolia/`);
  return entry.address;
};
/** Numeric address equality; false for anything that is not a number. */
export const same = (a: string, b: string): boolean => {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
};

/** What the scope doc says v0.10.8 does; each field present is scored. */
export type Expect = {
  readonly listed?: boolean;
  readonly hint?: RegExp;
  readonly selectable?: boolean;
  readonly message?: RegExp;
  readonly imported?: boolean;
};
/** What the wallet showed for one card. */
export type Observed = {
  listed?: boolean;
  hint?: string;
  selectable?: boolean;
  message?: string;
  imported?: boolean;
};
export type Verdict = "pass" | "fail" | "review" | "error";
export type Result = {
  readonly ta: string;
  readonly path: string;
  readonly now: string;
  readonly desired?: string;
  readonly observed: Observed;
  readonly verdict: Verdict;
  readonly mismatches: string[];
};
/** One TA card on one import path, with what the scope doc expects. */
export type Card = {
  readonly ta: string;
  readonly path: string;
  readonly now: string;
  readonly desired?: string;
  readonly expect: Expect;
};

const results: Result[] = [];

/** Every result scored so far in this run, in run order. */
export const allResults = (): readonly Result[] => results;

const score = (card: Card, observed: Observed): void => {
  const mismatches: string[] = [];
  const { expect: want } = card;
  if (want.listed !== undefined && observed.listed !== want.listed) mismatches.push("listed");
  if (want.hint && !want.hint.test(observed.hint ?? "")) mismatches.push("hint");
  if (want.selectable !== undefined && observed.selectable !== want.selectable) {
    mismatches.push("selectable");
  }
  if (want.message && !want.message.test(observed.message ?? "")) mismatches.push("message");
  if (want.imported !== undefined && observed.imported !== want.imported)
    mismatches.push("imported");
  const verdict: Verdict =
    Object.keys(want).length === 0 ? "review" : mismatches.length ? "fail" : "pass";
  results.push({ ...card, observed, verdict, mismatches });
  const shown = observed.message ?? observed.hint ?? (observed.listed ? "listed" : "not listed");
  console.log(
    `${verdict.toUpperCase().padEnd(6)} ${card.ta.padEnd(15)} ${card.path.padEnd(4)} ${redact(shown)}`,
  );
};

/** What the rows show for `address`: listed (with hint and selectability) or not. */
export const fromRows = (rows: readonly Row[], address: string): Observed => {
  const row = rows.find((r) => same(r.address, address));
  return row ? { listed: true, hint: row.hint, selectable: row.selectable } : { listed: false };
};

/** Runs `step`, scoring its observation, or records the error against every card it covers. */
export const attempt = async (
  cards: readonly Card[],
  step: () => Promise<Observed[]>,
): Promise<void> => {
  try {
    const observed = await step();
    for (const [i, card] of cards.entries()) score(card, observed[i] ?? {});
  } catch (error) {
    for (const card of cards) {
      const message = redact(String(error)).slice(0, 300);
      results.push({ ...card, observed: { message }, verdict: "error", mismatches: [] });
      console.log(`ERROR  ${card.ta.padEnd(15)} ${card.path.padEnd(4)} ${message.slice(0, 120)}`);
    }
  }
};

/** A card keyed by its manifest fixture id. */
export type RowCard = Card & { readonly id: string };

/** A card for fixture `id` on import path `path`. */
export const row = (
  id: string,
  path: string,
  now: string,
  expect: Expect,
  desired?: string,
): RowCard => ({
  id,
  ta: id,
  path,
  now,
  expect,
  ...(desired && { desired }),
});
