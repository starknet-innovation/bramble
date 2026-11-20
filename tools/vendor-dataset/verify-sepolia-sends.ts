/**
 * Sepolia send run (issue 976): drives the built extension through a dust
 * STRK self-transfer from every S-TXN account (manifest/sepolia/s-txn.json),
 * one per signing shape the wallet imports, and checks each on-chain: a
 * successful receipt, the exact amount moved to self, a balance drop of
 * exactly the receipt fee, and the transaction in Activity.
 *
 * Spends testnet STRK only, from S-TXN alone: a broadcast firewall installed
 * before any page opens lets the wallet send from the one account each check
 * is about, and nothing else (tests/live/broadcast-firewall.ts). The import
 * fixtures are never sent from. Everything printed is redacted (sepolia-redact).
 *
 * Run from the repository root after `bun run build`:
 *   bun run verify:sepolia:sends [TX-xx]
 * The optional id checks that one account only. Exits non-zero when any check fails, so the nightly can gate on it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sameFelt } from "@bramble/wallet-model/networks";
import { offLadderKeypair } from "./matrix-lib";
import { guarded, secret } from "./sepolia-redact";
import { sepoliaSecret } from "./sepolia-seeds";
import {
  failure,
  nonceOf,
  openGuardedSession,
  refusedFor,
  report,
  sendFrom,
  type Verdict,
} from "./verify-sepolia-live";
import { pace } from "./verify-sepolia-ui";

// Optional: run one account only, e.g. `bun run verify:sepolia:sends TX-07`.
const ONLY = process.argv[2];
// The public node rate-limits bursts; one pause between sends keeps the run under it.
const BETWEEN_SENDS_MS = 10_000;
// Long enough for a send the node accepted to show in the pre-confirmed nonce.
const RETRY_PAUSE_MS = 20_000;

/** How each S-TXN account reaches the wallet, and what a send from it should do. */
type Case = {
  readonly id: string;
  readonly via: "scan" | "key";
  /** Set when the wallet cannot take the account yet; the case is reported, not run. */
  readonly skip?: string;
  /**
   * Set when the wallet must refuse to sign for the account (its live class is
   * not a release this wallet authorizes for): Home shows "Read only" and the
   * account's nonce does not move. Measured on the first live run.
   */
  readonly readOnly?: string;
};

const CASES: readonly Case[] = [
  { id: "TX-01", via: "scan" },
  { id: "TX-02", via: "scan" },
  { id: "TX-03", via: "scan" },
  { id: "TX-04", via: "scan" },
  { id: "TX-05", via: "scan", readOnly: "Argent 0.3.1 signs with the older stark-pair shape" },
  { id: "TX-06", via: "scan", readOnly: "Argent 0.5.0 is not a release this wallet signs for" },
  { id: "TX-07", via: "scan" },
  { id: "TX-08", via: "scan", readOnly: "Braavos 1.1.0 is not a release this wallet signs for" },
  { id: "TX-09", via: "key" },
  {
    id: "TX-10",
    via: "key",
    skip: "the wallet cannot import an sncast-shaped OZ account yet (see TA-07)",
  },
];

const manifest = JSON.parse(
  readFileSync(resolve(import.meta.dir, "manifest/sepolia/s-txn.json"), "utf8"),
) as Record<string, { readonly address: string }>;
const addressOf = (id: string): string => {
  const entry = manifest[`s-txn/${id}`];
  if (!entry) throw new Error(`${id} is not in manifest/sepolia/s-txn.json`);
  return entry.address;
};

const verdicts: Verdict[] = [];
const ok = await guarded(async () => {
  const mnemonic = secret(sepoliaSecret("S-TXN"));
  const { session, allowed, firewall } = await openGuardedSession(mnemonic);
  try {
    const { page } = await session.scan(null);
    const scanned = CASES.filter((c) => c.via === "scan" && !c.skip).map((c) => addressOf(c.id));
    const unimported = await session.importRows(page, scanned);
    const key = offLadderKeypair(mnemonic, 0);
    secret(key.priv);
    await session.key({ type: "openzeppelin", key: key.priv });

    for (const c of CASES.filter((c) => !ONLY || c.id === ONLY)) {
      const address = addressOf(c.id);
      if (c.skip) {
        verdicts.push({ id: c.id, verdict: "skip", why: c.skip });
        continue;
      }
      if (unimported.some((a) => sameFelt(a, address))) {
        verdicts.push({ id: c.id, verdict: "fail", why: "not selectable in the scan" });
        continue;
      }
      // A read-only account keeps the allowlist empty, so any broadcast it
      // attempts is blocked and counted rather than sent.
      if (!c.readOnly) allowed.splice(0, allowed.length, address);
      const fw = firewall;
      const attempt = async (): Promise<{ readonly ok: boolean; readonly why: string }> => {
        const blockedBefore = fw.blocked.length;
        try {
          let why: string;
          if (c.readOnly) {
            await refusedFor(session, address);
            why = `read only, as expected: ${c.readOnly}`;
          } else {
            why = await sendFrom(session, address);
          }
          if (fw.blocked.length > blockedBefore) {
            throw new Error("the wallet attempted a broadcast the firewall blocked");
          }
          return { ok: true, why };
        } catch (error) {
          const blocked =
            fw.blocked.length > blockedBefore ? " (firewall blocked a broadcast)" : "";
          return { ok: false, why: `${await failure(error, session)}${blocked}` };
        }
      };
      const blockedAtStart = fw.blocked.length;
      const nonce = await nonceOf(address);
      let result = await attempt();
      // The public node sometimes refuses a request or stalls a step. Retry a
      // sender once, and only when provably nothing went out: no blocked
      // broadcast, and after a pause the nonce (pre-confirmed included) has
      // not moved. The verdict keeps the first failure so flakiness shows.
      if (!result.ok && !c.readOnly && fw.blocked.length === blockedAtStart) {
        await pace(RETRY_PAUSE_MS);
        if ((await nonceOf(address)) === nonce) {
          const first = result.why;
          const second = await attempt();
          result = {
            ok: second.ok,
            why: second.ok
              ? `${second.why} (passed on retry; first try: ${first})`
              : `${second.why} (first try: ${first})`,
          };
        }
      }
      verdicts.push({ id: c.id, verdict: result.ok ? "pass" : "fail", why: result.why });
      allowed.length = 0;
      await pace(BETWEEN_SENDS_MS);
    }
  } finally {
    await session.close();
  }
});

report(ok, verdicts);
