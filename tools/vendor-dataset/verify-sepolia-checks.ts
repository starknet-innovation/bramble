/**
 * The Sepolia verification checks (verify-sepolia.ts): one card per TA and
 * import path, each holding the scope doc's "Now" expectation as fields that
 * are scored (listed, hint, selectable, message, imported) and its "Desired"
 * line as unscored context. Groups share one scan per phrase, so P4 pastes and
 * P5 indices run on the scan they belong to. Errors are redacted of every
 * secret the run types.
 */
import { braavosKeypair, brambleKeypair, loadManifest, readyKeypair } from "./matrix-lib";
import { type SepoliaSecret, sepoliaSecret } from "./sepolia-seeds";
import type { Row, Session } from "./verify-sepolia-ui";

const manifest = loadManifest();
const addressOf = (id: string): string => {
  const entry = manifest[id];
  if (!entry) throw new Error(`${id} is not in manifest/sepolia/`);
  return entry.address;
};
const same = (a: string, b: string): boolean => {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
};

// Every secret the run may type, so no error text can carry one out.
const secrets = (
  [
    "S-BRM",
    "S-SCR",
    "S-BRV",
    "S-RDY",
    "S-XVS",
    "S-W15",
    "S-W18",
    "S-W21",
    "K-OZ",
    "K-ROT-A",
    "K-SNC",
  ] as const
).flatMap((name) => {
  try {
    return [sepoliaSecret(name)];
  } catch {
    return [];
  }
});
const redact = (message: string): string =>
  secrets.reduce((m, s) => m.split(s).join("[redacted]"), message).slice(0, 300);
const have = (name: SepoliaSecret): boolean => {
  try {
    sepoliaSecret(name);
    return true;
  } catch {
    return false;
  }
};

/** What the scope doc says v0.10.8 does; each field present is scored. */
type Expect = {
  readonly listed?: boolean;
  readonly hint?: RegExp;
  readonly selectable?: boolean;
  readonly message?: RegExp;
  readonly imported?: boolean;
};
type Observed = {
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
type Card = {
  readonly ta: string;
  readonly path: string;
  readonly now: string;
  readonly desired?: string;
  readonly expect: Expect;
};

let results: Result[] = [];

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
    `${verdict.toUpperCase().padEnd(6)} ${card.ta.padEnd(15)} ${card.path.padEnd(4)} ${shown}`,
  );
};

const fromRows = (rows: readonly Row[], address: string): Observed => {
  const row = rows.find((r) => same(r.address, address));
  return row ? { listed: true, hint: row.hint, selectable: row.selectable } : { listed: false };
};

/** Runs `step`, scoring its observation, or records the error against every card it covers. */
const attempt = async (cards: readonly Card[], step: () => Promise<Observed[]>): Promise<void> => {
  try {
    const observed = await step();
    for (const [i, card] of cards.entries()) score(card, observed[i] ?? {});
  } catch (error) {
    for (const card of cards) {
      const message = redact(String(error));
      results.push({ ...card, observed: { message }, verdict: "error", mismatches: [] });
      console.log(`ERROR  ${card.ta.padEnd(15)} ${card.path.padEnd(4)} ${message.slice(0, 120)}`);
    }
  }
};

type RowCard = Card & { readonly id: string };

/** P2/P3 rows for one phrase, then its P4 pastes and P5 manual indices on the same scan. */
const phraseGroup = async (
  session: Session,
  phrase: string | null,
  rows: readonly RowCard[],
  pastes: readonly RowCard[] = [],
  manual: readonly (RowCard & { readonly index: number })[] = [],
): Promise<void> => {
  // A pause between phrases keeps the run under the public node's rate limit.
  await new Promise((done) => setTimeout(done, 15_000));
  let scan: Awaited<ReturnType<Session["scan"]>> | null = null;
  await attempt(rows, async () => {
    scan = await session.scan(phrase);
    console.log(`   scan: ${scan.status}`);
    const found = scan.rows;
    return rows.map((card) => fromRows(found, addressOf(card.id)));
  });
  for (const card of manual) {
    await attempt([card], async () => {
      if (!scan) throw new Error("scan failed");
      const { rows: after } = await session.manualIndex(scan.page, card.index);
      return [fromRows(after, addressOf(card.id))];
    });
  }
  for (const card of pastes) {
    await attempt([card], async () => {
      if (!scan) throw new Error("scan failed");
      const { message } = await session.paste(scan.page, addressOf(card.id));
      return [{ message }];
    });
  }
};

const row = (id: string, path: string, now: string, expect: Expect, desired?: string): RowCard => ({
  id,
  ta: id,
  path,
  now,
  expect,
  ...(desired && { desired }),
});

const FOUND = /^Found/;

/** Every card, run against one session. Returns the scored results in run order. */
export async function runChecks(session: Session): Promise<Result[]> {
  results = [];
  const scr = (i: number): string => readyKeypair(sepoliaSecret("S-SCR"), i).priv;

  console.log("\n## S-BRM: own-phrase rescan (P3), manual index (P5), pasted address (P4)");
  await phraseGroup(
    session,
    null,
    [
      row("s-brm/TA-01", "P3", "listed and signable", { listed: true }),
      row("s-brm/TA-02", "P3", "listed as funded, selectable", {
        listed: true,
        hint: /Funded/,
        selectable: true,
      }),
      row("s-brm/TA-03", "P3", "not reached by the default scan", { listed: false }),
      row("s-brm/TA-06", "P3", "not listed (salt = pk)", { listed: false }, "found"),
      row("s-brm/TA-08", "P3", "listed as a plain Bramble account, no label", {
        listed: true,
        hint: /^Deployed on Starknet$/,
      }),
    ],
    [
      row("s-brm/TA-01", "P4", "Bramble account: 'Use Find my accounts instead.'", {
        message: /Use Find my accounts instead/,
      }),
      row(
        "s-brm/TA-06",
        "P4",
        "brambleAccount dead end",
        {
          message: /Use Find my accounts instead/,
        },
        "found",
      ),
    ],
    [{ ...row("s-brm/TA-03", "P5", "found by manual index 25", { listed: true }), index: 25 }],
  );

  console.log("\n## S-SCR: phrase import (P2), pasted address (P4)");
  await phraseGroup(
    session,
    sepoliaSecret("S-SCR"),
    [
      row("s-scr/TA-15", "P2", "not listed (custom salt)", { listed: false }),
      row("s-scr/TA-16", "P2", "'unsupported release', view only", {
        listed: true,
        hint: /unsupported release · view only/,
      }),
      row("s-scr/TA-17", "P2", "listed (0.3.0 address, live 0.4.0)", { listed: true }),
      row("s-scr/TA-18", "P2", "'Funded, not deployed', view only for now", {
        listed: true,
        hint: /Funded/,
      }),
      row("s-scr/TA-19", "P2", "listed in the Ready group", { listed: true }),
      row("s-scr/TA-20", "P2", "owner changed, view only", {
        listed: true,
        hint: /owner key changed · view only/,
      }),
      row("s-scr/TA-21", "P2", "not listed (custom salt)", { listed: false }),
      row("s-scr/TA-22", "P2", "not listed (UDC)", { listed: false }),
      row("s-scr/TA-23", "P2", "invisible (custom-salt counterfactual)", { listed: false }),
      row("s-scr/TA-24", "P2", "not listed (index 250)", { listed: false }),
      row("s-scr/TA-26", "P2", "Xverse class, listed", { listed: true }),
      row("s-scr/TA-30", "P2", "Braavos base counterfactual, listed", { listed: true }),
    ],
    [
      row("s-scr/TA-15", "P4", "owner matched → guardian, view only (UNVERIFIED)", {
        message: FOUND,
      }),
      row("s-scr/TA-17", "P4", "stored with the live class", { message: FOUND }),
      row("s-scr/TA-21", "P4", "found (UNVERIFIED)", { message: FOUND }),
      row("s-scr/TA-22", "P4", "found (UNVERIFIED)", { message: FOUND }),
      row("s-scr/TA-23", "P4", "invisible: nothing deployed", { message: /No account found/ }),
      row("s-scr/TA-24", "P4", "'This recovery phrase doesn't control that account.'", {
        message: /doesn.t control that account/,
      }),
      row("key/TA-25", "P4", "'controlled by a signer Bramble can't use'", {
        message: /signer Bramble can.t use/,
      }),
    ],
  );

  console.log("\n## S-BRV: phrase import (P2)");
  await phraseGroup(session, sepoliaSecret("S-BRV"), [
    row("s-brv/TA-27", "P2", "listed", { listed: true }),
    row("s-brv/TA-28", "P2", "listed as funded", { listed: true, hint: /Funded/ }),
    row("s-brv/TA-29", "P2", "listed; 2FA restriction shown (no doc line)", { listed: true }),
  ]);

  if (have("S-RDY")) {
    console.log("\n## S-RDY: phrase import (P2)");
    await phraseGroup(session, sepoliaSecret("S-RDY"), [
      row("s-rdy/TA-09", "P2", "listed and signable", { listed: true, selectable: true }),
      row("s-rdy/TA-10", "P2", "listed as funded counterfactual", { listed: true, hint: /Funded/ }),
      row(
        "s-rdy/TA-11",
        "P2",
        "not listed (Sepolia probes only ETH/STRK)",
        { listed: false },
        "listed",
      ),
      row("s-rdy/TA-12", "P2", "'has a guardian', view only", {
        listed: true,
        hint: /guardian.*view only/,
      }),
      row("s-rdy/TA-13", "P2", "signable", { listed: true, selectable: true }),
    ]);
  }

  if (have("S-XVS")) {
    console.log("\n## S-XVS: phrase import (P2)");
    await phraseGroup(session, sepoliaSecret("S-XVS"), [
      row("s-xvs/TA-26", "P2", "Xverse account listed", { listed: true }),
    ]);
  }

  console.log("\n## 15/18/21-word phrases (P2 entry)");
  for (const [ta, name] of [
    ["phrase/TA-42", "S-W15"],
    ["phrase/TA-43", "S-W18"],
    ["phrase/TA-44", "S-W21"],
  ] as const) {
    const card = row(
      ta,
      "P2",
      "one cell, 'Enter all 12 words to continue.'",
      {
        message: /Enter all 12 words/,
      },
      "accepted",
    );
    await attempt([card], async () => {
      const { message, searchable } = await session.phraseEntry(sepoliaSecret(name));
      return [{ message: message || (searchable ? "accepted" : "not searchable") }];
    });
  }

  console.log("\n## Private keys (P6 Bramble, P7 Ready picker, P8 finder)");
  const p6 = async (card: Card, key: string, id: string): Promise<void> =>
    attempt([card], async () => {
      const { message, imported } = await session.key({ type: "openzeppelin", key });
      return [{ message, imported: imported.some((a) => same(a, addressOf(id))) }];
    });
  await p6(
    row("key/TA-05", "P6", "imports the OZ salt-0 address", { imported: true }),
    sepoliaSecret("K-OZ"),
    "key/TA-05",
  );
  await p6(
    row(
      "s-brm/TA-06",
      "P6",
      "imports the salt-0 address, which is wrong",
      { imported: false },
      "found",
    ),
    brambleKeypair(sepoliaSecret("S-BRM"), 2).priv,
    "s-brm/TA-06",
  );
  await p6(
    row("key/TA-07", "P6", "silently imports a different, empty address", { imported: false }),
    sepoliaSecret("K-SNC"),
    "key/TA-07",
  );

  const p7 = async (card: Card, key: string, id: string, salt?: string): Promise<void> =>
    attempt([card], async () => {
      const { message, rows } = await session.key({ type: "argent", key, ...(salt && { salt }) });
      const seen = fromRows(rows, addressOf(id));
      return [{ ...seen, ...(message && { message }) }];
    });
  await p7(
    row("s-scr/TA-16", "P7", "'Argent 0.3.1 / Deployed', pre-ticked, no reason", {
      listed: true,
      hint: /Deployed/,
    }),
    scr(0),
    "s-scr/TA-16",
  );
  await p7(
    row("s-scr/TA-21", "P7", "found with salt 0x5a17", { listed: true }),
    scr(6),
    "s-scr/TA-21",
    "0x5a17",
  );
  await p7(
    row("s-scr/TA-23", "P7", "'Not deployed · holds 1 STRK' with salt 0x5eed", {
      listed: true,
      hint: /Not deployed · holds 1 STRK/,
    }),
    scr(8),
    "s-scr/TA-23",
    "0x5eed",
  );
  if (have("S-RDY")) {
    await p7(
      row(
        "s-rdy/TA-12",
        "P7",
        "plain 'Deployed', pre-ticked",
        { listed: true, hint: /^Deployed/ },
        "shows the guardian reason",
      ),
      readyKeypair(sepoliaSecret("S-RDY"), 3).priv,
      "s-rdy/TA-12",
    );
  }

  const p8 = async (card: Card, key: string, id: string): Promise<void> =>
    attempt([card], async () => {
      const { finder } = await session.key({ type: "argent", key, address: addressOf(id) });
      return [{ message: finder ?? "" }];
    });
  await p8(
    row("s-scr/TA-20", "P8", "found with the new owner key", { message: /Found your account/ }),
    sepoliaSecret("K-ROT-A"),
    "s-scr/TA-20",
  );
  await p8(
    row("s-scr/TA-15", "P8", "found, view only", { message: /view only/ }),
    scr(5),
    "s-scr/TA-15",
  );
  if (have("S-RDY")) {
    await p8(
      row("s-rdy/TA-12", "P8", "'Found your account. It's view only until you recover it.'", {
        message: /view only until you recover it/,
      }),
      readyKeypair(sepoliaSecret("S-RDY"), 3).priv,
      "s-rdy/TA-12",
    );
  }
  await p8(
    row("s-brv/TA-27", "P8", "'can't import a Braavos account from a private key yet'", {
      message: /Braavos account from a private key/,
    }),
    braavosKeypair(sepoliaSecret("S-BRV"), 0).priv,
    "s-brv/TA-27",
  );

  console.log("\n## Multisig by address (P10)");
  for (const card of [
    // No "Now" line in the doc: pinned to what v0.10.8 did on 2026-11-05.
    row("multisig/TA-39", "P10", "added, watch-only (no seat in this wallet)", {
      message: /Multisig synced · watch-only/,
    }),
    row(
      "multisig/TA-40",
      "P10",
      "accepted as an undeployed multisig, with no config on chain to read",
      { message: /Undeployed multisig added/ },
      "review: should an address with nothing deployed be accepted?",
    ),
  ]) {
    await attempt([card], async () => [await session.multisig(addressOf(card.ta))]);
  }
  return results;
}
