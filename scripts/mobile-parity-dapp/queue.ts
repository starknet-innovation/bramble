/**
 * The `queue` block: the extension's approval queue (`createApprovalQueue`) with its signature
 * waiters (`createSignatureWaiters`, `releaseWaitersOnApprovalDrop`) over a hand-moved clock, as
 * the background drives them for a page's request: `connect` is `request` then `register`, as
 * `handleRequestAccounts` does; `switch` is `requestSwitchChain` then `register`. Approval ids are
 * random, so each is written as the label of the card it named (`c0`, `c1`, ..., in order of
 * first appearance), and a reservation as `r0`, `r1`, .... After each step: its result, and
 * every card the queue dropped (expired or evicted) during it.
 */

import { createApprovalQueue } from "../../apps/extension/src/background/approvals/approvals";
import {
  createSignatureWaiters,
  releaseWaitersOnApprovalDrop,
} from "../../apps/extension/src/background/approvals/signature-waiters";
import { OTHER_SITE, SITE, thrownMessage } from "./shared";

type Step =
  | { readonly op: "connect"; readonly origin: string }
  | { readonly op: "switch"; readonly origin: string; readonly chainId: string }
  | { readonly op: "reserve"; readonly origin: string }
  | { readonly op: "release"; readonly reservation: string }
  | { readonly op: "canAdmit"; readonly origin: string }
  | { readonly op: "claim"; readonly card: string }
  | { readonly op: "advance"; readonly ms: number }
  | { readonly op: "list" };

const site = (n: number) => `https://site${n}.example`;
const connect = (origin: string): Step => ({ op: "connect", origin });
const switchTo = (origin: string, n: number): Step => ({
  chainId: `0x${n.toString(16)}`,
  op: "switch",
  origin,
});
const LIST: Step = { op: "list" };

/** Fifty cards from ten sites, five each: the queue's global cap. */
const fullQueue: readonly Step[] = Array.from({ length: 10 }, (_, s) =>
  Array.from({ length: 5 }, (_, n) => switchTo(site(s), n + 1)),
).flat();

const CASES: readonly { readonly name: string; readonly steps: readonly Step[] }[] = [
  {
    name: "a site's connect requests share one card",
    steps: [connect(SITE), connect(SITE), connect(OTHER_SITE), LIST],
  },
  {
    name: "eight requests may wait on one card, a ninth is refused",
    steps: [...Array.from({ length: 9 }, () => connect(SITE)), LIST],
  },
  {
    name: "a switch dedupes per chain id",
    steps: [switchTo(SITE, 1), switchTo(SITE, 1), switchTo(SITE, 2), connect(SITE), LIST],
  },
  {
    name: "five cards per site",
    steps: [
      ...[1, 2, 3, 4, 5, 6].map((n) => switchTo(SITE, n)),
      connect(SITE),
      connect(OTHER_SITE),
    ],
  },
  {
    name: "a card expires five minutes after it was queued",
    steps: [
      connect(SITE),
      { ms: 120_000, op: "advance" },
      connect(OTHER_SITE),
      { ms: 179_999, op: "advance" },
      LIST,
      { ms: 1, op: "advance" },
      LIST,
      connect(SITE),
      { ms: 120_000, op: "advance" },
      LIST,
    ],
  },
  {
    name: "reservations count against a site's cap",
    steps: [
      ...Array.from({ length: 4 }, () => ({ op: "reserve", origin: SITE }) as const),
      connect(SITE),
      { op: "reserve", origin: SITE },
      { op: "canAdmit", origin: SITE },
      { op: "canAdmit", origin: OTHER_SITE },
      { op: "release", reservation: "r0" },
      { op: "release", reservation: "r0" },
      { op: "canAdmit", origin: SITE },
      { op: "reserve", origin: SITE },
    ],
  },
  {
    name: "a claimed card is gone, and a new request queues a new one",
    steps: [
      connect(SITE),
      { card: "c0", op: "claim" },
      { card: "c0", op: "claim" },
      { card: "c9", op: "claim" },
      connect(SITE),
      LIST,
    ],
  },
  {
    name: "at the global cap a new site evicts the busiest site's oldest card",
    steps: [
      ...fullQueue,
      { op: "canAdmit", origin: SITE },
      connect(SITE),
      connect(site(3)),
      switchTo(site(1), 9),
      LIST,
    ],
  },
  {
    name: "at the global cap with one card per site, nobody gets in",
    steps: [
      ...Array.from({ length: 50 }, (_, s) => connect(site(s))),
      { op: "canAdmit", origin: SITE },
      connect(SITE),
      { op: "reserve", origin: SITE },
    ],
  },
];

const START = 1_000_000;

/** Runs every case over a fresh queue at a fixed start time. */
export const computeQueue = async (): Promise<readonly object[]> => {
  const cases: object[] = [];
  for (const { name, steps } of CASES) {
    let now = START;
    const approvals = createApprovalQueue({ now: () => now });
    const waiters = createSignatureWaiters();
    let dropped: string[] = [];
    const labels = new Map<string, string>();
    const label = (id: string) => {
      const known = labels.get(id);
      if (known) return known;
      const next = `c${labels.size}`;
      labels.set(id, next);
      return next;
    };
    const idOf = (card: string) =>
      [...labels].find(([, known]) => known === card)?.[0] ??
      "00000000-0000-4000-8000-00000000dead";
    releaseWaitersOnApprovalDrop(
      {
        observeDrops: (observe) =>
          approvals.observeDrops((ids) => {
            dropped.push(...ids.map(label));
            observe(ids);
          }),
      },
      waiters,
      () => undefined,
    );
    const reservations: { release: () => void }[] = [];
    const ask = (queue: () => { readonly id: string }) => {
      const known = new Set(labels.keys());
      const { id } = queue();
      const joined = known.has(id);
      // The held reply; a refusal here leaves the card queued, as in the background.
      void waiters.register(id);
      return { card: label(id), joined };
    };
    const results: object[] = [];
    for (const step of steps) {
      dropped = [];
      let result: unknown;
      try {
        switch (step.op) {
          case "connect":
            result = ask(() => approvals.request(step.origin));
            break;
          case "switch":
            result = ask(() =>
              approvals.requestSwitchChain({
                chainId: step.chainId,
                networkId: "SN_MAIN",
                origin: step.origin,
                summary: "Switch network",
              }),
            );
            break;
          case "reserve":
            reservations.push(approvals.reserve(step.origin));
            result = { reservation: `r${reservations.length - 1}` };
            break;
          case "release":
            reservations[Number(step.reservation.slice(1))]?.release();
            result = null;
            break;
          case "canAdmit":
            result = { refusal: approvals.canAdmit(step.origin) };
            break;
          case "claim":
            result = { claimed: approvals.claim(idOf(step.card)) !== null };
            break;
          case "advance":
            now += step.ms;
            result = null;
            break;
          case "list":
            result = {
              cards: approvals.list().map((approval) => ({
                card: label(approval.id),
                origin: approval.origin,
              })),
            };
            break;
        }
      } catch (error) {
        result = { refused: thrownMessage(error) };
      }
      results.push({ dropped, result, step });
    }
    cases.push({ name, start: START, steps: results });
  }
  return cases;
};
