/**
 * The opt-in Ledger part of the Sepolia verification run (verify-sepolia.ts,
 * BRAMBLE_SEPOLIA_LEDGER=1): TA-32…TA-37 on the dedicated test Ledger, through
 * "Ledger account" (Bramble's path) and "Ready Ledger account" (Ready's).
 * The wallet reads public keys from the device itself, so a person connects it
 * when prompted; no seed is typed and nothing is signed. TA-38 (the first-run
 * Ledger screen) stays a manual check. "P9" is the scope doc's Ledger path.
 */
import { addressOf, attempt, fromRows, type RowCard, row } from "./verify-sepolia-score";
import type { Session } from "./verify-sepolia-ui";

const OWN: readonly RowCard[] = [
  row("s-ldg/TA-32", "P9", "Bramble Ledger OZ: listed by 'Ledger account'", { listed: true }),
];

const READY: readonly RowCard[] = [
  row("s-ldg/TA-33", "P9", "Ready Ledger 0.4.0: listed under 'Ready Ledger account'", {
    listed: true,
  }),
  row("s-ldg/TA-34", "P9", "Braavos on the argentx ladder: listed under 'Ready Ledger account'", {
    listed: true,
  }),
  // The doc's "Now" ("activity unproven on Sepolia") names no observable to score.
  row("s-ldg/TA-35", "P9", "Ready Ledger funded counterfactual: activity unproven (N11)", {}),
  row("s-ldg/TA-36", "P9", "Ready Ledger with a guardian: selectable, no restriction label", {
    listed: true,
    selectable: true,
  }),
  row("s-ldg/TA-37", "P9", "Ready Ledger on Argent 0.3.1: not found", { listed: false }),
];

/** Connects the test Ledger through both Ledger routes and scores TA-32…TA-37. */
export async function runLedgerChecks(session: Session): Promise<void> {
  console.log("\n## Test Ledger (opt-in): Ledger account and Ready Ledger account (P9)");
  for (const [route, cards] of [
    ["own", OWN],
    ["ready", READY],
  ] as const) {
    await attempt(cards, async () => {
      const rows = await session.ledger(route);
      return cards.map((card) => fromRows(rows, addressOf(card.id)));
    });
  }
}
