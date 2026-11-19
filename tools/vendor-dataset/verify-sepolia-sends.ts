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
 *   bun run verify:sepolia:sends
 * Exits non-zero when any check fails, so the nightly can gate on it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sameFelt } from "@bramble/wallet-model/networks";
import { expect } from "@playwright/test";
import { sendRuntimeMessage } from "../../tests/e2e/wallet-helpers";
import { installBroadcastFirewall } from "../../tests/live/broadcast-firewall";
import {
  defaultToken,
  readTokenBalance,
  receiptStrkFee,
  transferredToSelf,
  waitForSuccessfulReceipt,
} from "../../tests/live/chain";
import { expectActivity, selfTransfer } from "../../tests/live/send";
import { SELF_TRANSFER_AMOUNT, selfTransferRaw } from "../../tests/mainnet/local-mainnet-limits";
import { NETWORK, NODE, offLadderKeypair, provider } from "./matrix-lib";
import { guarded, redact, secret } from "./sepolia-redact";
import { sepoliaSecret } from "./sepolia-seeds";
import { openSession, pace, type Session } from "./verify-sepolia-ui";

if (NETWORK !== "sepolia") throw new Error("set BRAMBLE_DATASET_NETWORK=sepolia");
// Playwright's debug logs echo every value typed, secrets included, before any redaction.
if (process.env["DEBUG"] || process.env["PWDEBUG"]) throw new Error("unset DEBUG and PWDEBUG");

// ponytail: Sepolia's fee cap, fixed in code like mainnet's; a review above it is not confirmed.
const MAX_FEE_STRK = "0.5";
const STRK = defaultToken("SN_SEPOLIA", "STRK");
const AMOUNT_RAW = selfTransferRaw(STRK.decimals);
// The public node rate-limits bursts; one pause between sends keeps the run under it.
const BETWEEN_SENDS_MS = 10_000;

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

type Verdict = {
  readonly id: string;
  readonly verdict: "pass" | "fail" | "skip";
  readonly why: string;
};

const activate = async (session: Session, address: string): Promise<void> => {
  const status = await sendRuntimeMessage<{
    readonly accounts?: readonly { readonly address: string; readonly id: string }[];
  }>(session.panel, { type: "wallet.status" });
  const account = status?.accounts?.find((a) => sameFelt(a.address, address));
  if (!account) throw new Error("the account is not in the wallet");
  await sendRuntimeMessage(session.panel, {
    accountId: account.id,
    type: "wallet.setActiveAccount",
  });
  await session.panel.reload();
  await expect(session.panel.locator("#account-trigger")).toBeVisible({ timeout: 30_000 });
};

/**
 * What the wallet showed when a send stopped: the Home read-only notice, the
 * send form's message and the review's fee line, whichever are on screen.
 */
const shown = async (session: Session): Promise<string> => {
  const parts: string[] = [];
  for (const selector of [".read-only-notice", "#transfer-result", "#send-review-fee"]) {
    const locator = session.panel.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      const text = ((await locator.textContent()) ?? "").replace(/\s+/g, " ").trim();
      if (text) parts.push(`${selector}: ${text}`);
    }
  }
  return parts.length ? ` [wallet showed ${parts.join(" | ")}]` : "";
};

/** A read-only account: Home says so, and nothing reaches the chain from it. */
const refusedFor = async (session: Session, address: string): Promise<void> => {
  const nonce = await provider.getNonceForAddress(address);
  await activate(session, address);
  await expect(session.panel.locator(".read-only-notice")).toContainText("Read only", {
    timeout: 30_000,
  });
  if (BigInt(await provider.getNonceForAddress(address)) !== BigInt(nonce)) {
    throw new Error("the nonce moved");
  }
};

/** One dust self-transfer from `address`, checked on-chain and in Activity. */
const sendFrom = async (session: Session, address: string): Promise<string> => {
  await activate(session, address);
  const before = await readTokenBalance(NODE, address, STRK);
  const hash = await selfTransfer(session.panel, {
    amount: SELF_TRANSFER_AMOUNT,
    maxFeeStrk: MAX_FEE_STRK,
    recipient: address,
    symbol: "STRK",
  });
  const receipt = await waitForSuccessfulReceipt(NODE, hash);
  const fee = receiptStrkFee(receipt);
  const moved = transferredToSelf(receipt, STRK.address, address);
  if (moved !== AMOUNT_RAW) throw new Error(`moved ${moved} to self, not ${AMOUNT_RAW}`);
  await expect
    .poll(async () => before.raw - (await readTokenBalance(NODE, address, STRK)).raw, {
      intervals: [2_000, 4_000],
      timeout: 60_000,
    })
    .toBe(fee);
  await expectActivity(session.panel, hash);
  return hash;
};

const verdicts: Verdict[] = [];
const ok = await guarded(async () => {
  const mnemonic = secret(sepoliaSecret("S-TXN"));
  const allowed: string[] = [];
  let firewall: Awaited<ReturnType<typeof installBroadcastFirewall>> | undefined;
  const session = await openSession(mnemonic, async (context) => {
    firewall = await installBroadcastFirewall(context, allowed);
  });
  try {
    if (!firewall || firewall.inspected() === 0) {
      throw new Error("the broadcast firewall saw no wallet RPC traffic; nothing was sent");
    }
    const { page } = await session.scan(null);
    const scanned = CASES.filter((c) => c.via === "scan" && !c.skip).map((c) => addressOf(c.id));
    const unimported = await session.importRows(page, scanned);
    const key = offLadderKeypair(mnemonic, 0);
    secret(key.priv);
    await session.key({ type: "openzeppelin", key: key.priv });

    for (const c of CASES) {
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
      const blockedBefore = firewall.blocked.length;
      try {
        let why: string;
        if (c.readOnly) {
          await refusedFor(session, address);
          why = `read only, as expected: ${c.readOnly}`;
        } else {
          why = await sendFrom(session, address);
        }
        if (firewall.blocked.length > blockedBefore) {
          throw new Error("the wallet attempted a broadcast the firewall blocked");
        }
        verdicts.push({ id: c.id, verdict: "pass", why });
      } catch (error) {
        const blocked =
          firewall.blocked.length > blockedBefore ? " (firewall blocked a broadcast)" : "";
        const first = String(error).split("\n")[0] ?? "";
        verdicts.push({
          id: c.id,
          verdict: "fail",
          why: `${first}${blocked}${await shown(session)}`,
        });
      }
      allowed.length = 0;
      await pace(BETWEEN_SENDS_MS);
    }
  } finally {
    await session.close();
  }
});

for (const v of verdicts) console.log(redact(`${v.id} ${v.verdict}: ${v.why}`).slice(0, 700));
const count = (verdict: Verdict["verdict"]): number =>
  verdicts.filter((v) => v.verdict === verdict).length;
console.log(`\n${count("pass")} pass · ${count("fail")} fail · ${count("skip")} skip`);
// Exit explicitly: a failed run can leave the browser open.
process.exit(ok && count("fail") === 0 ? 0 : 1);
