/**
 * "Send is refused" checks for the Sepolia import run (issue 976, PR 5): each
 * account the wallet must never sign for is imported, made active through the
 * drawer, and checked from Home. The run's broadcast firewall allows no sender
 * at all, so a send that gets as far as the wire is aborted and counted here,
 * and every account's nonce must not move.
 *
 * Runs after every import card (verify-sepolia-checks.ts), because importing
 * these accounts would change what the later key-import cards see.
 * TA-25 (secp256k1 owner) has no card here: no Starknet key signs for it, and
 * its P4 card already proves the wallet refuses to import it.
 */
import type { BroadcastFirewall } from "../../tests/live/broadcast-firewall";
import { selfTransfer } from "../../tests/live/send";
import { SELF_TRANSFER_AMOUNT } from "../../tests/mainnet/local-mainnet-limits";
import { redact } from "./sepolia-redact";
import { type SepoliaSecret, sepoliaSecret } from "./sepolia-seeds";
import { activate, MAX_FEE_STRK, nonceOf, SEND_TILE, shown } from "./verify-sepolia-live";
import { addressOf, attempt, type Observed, type RowCard, row } from "./verify-sepolia-score";
import { pace, type Session } from "./verify-sepolia-ui";

const READ_ONLY = /^Read only/u;

/**
 * What the wallet does when asked to send from `address`: Home's read-only
 * notice when it shows one with Send disabled, otherwise how a dust
 * self-transfer ended. A blocked broadcast leads the message, so a "Read only"
 * card cannot match it, unless `broadcasts` says the card expects one. Throws
 * if the account's nonce moved, which would mean something was sent.
 */
const refusal = async (
  session: Session,
  firewall: BroadcastFirewall,
  address: string,
  broadcasts: boolean,
): Promise<Observed> => {
  const nonce = await nonceOf(address);
  const blocked = firewall.blocked.length;
  await activate(session, address);
  const notice = session.panel.locator(".read-only-notice");
  const noticed = await notice
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  // A notice proves nothing while Send stays enabled, so then Send is tried.
  const sendOff = noticed && (await session.panel.locator(SEND_TILE).isDisabled());
  let message: string;
  if (sendOff) {
    message = ((await notice.textContent()) ?? "").replace(/\s+/gu, " ").trim();
  } else {
    try {
      await selfTransfer(session.panel, {
        amount: SELF_TRANSFER_AMOUNT,
        maxFeeStrk: MAX_FEE_STRK,
        networkId: "SN_SEPOLIA",
        recipient: address,
        sender: address,
        symbol: "STRK",
      });
      message = "the wallet went on to submit";
    } catch (error) {
      message = `send stopped: ${String(error).split("\n")[0] ?? ""}${await shown(session)}`;
    }
    if (noticed) message = `notice shown but Send enabled; ${message}`;
  }
  if (firewall.blocked.length > blocked) {
    const what = "the firewall blocked a broadcast";
    message = broadcasts ? `${message} · ${what}` : `${what} · ${message}`;
  }
  if ((await nonceOf(address)) !== nonce) throw new Error("the nonce moved: something was sent");
  return { message: redact(message) };
};

/** One phrase's scan, the import of its refusal accounts, then a refusal check on each. */
const group = async (
  session: Session,
  firewall: BroadcastFirewall,
  phrase: SepoliaSecret | null,
  cards: readonly RowCard[],
  broadcasts = false,
): Promise<void> => {
  // A pause between phrases keeps the run under the public node's rate limit.
  await pace(15_000);
  const addresses = cards.map((card) => addressOf(card.id));
  let missed: readonly string[] = addresses;
  let why = "not importable from the scan";
  // The public node sometimes stops a scan ("temporarily unavailable"); one
  // more try after a pause, since these imports come after a long run.
  for (let tries = 0; tries < 2 && missed.length > 0; tries += 1) {
    if (tries > 0) await pace(60_000);
    try {
      const { page } = await session.scan(phrase === null ? null : sepoliaSecret(phrase));
      missed = await session.importRows(page, missed);
    } catch (error) {
      why = `import failed: ${redact(String(error).split("\n")[0] ?? "")}`;
      console.log(`   ${why.slice(0, 200)}`);
    }
  }
  for (const card of cards) {
    await attempt([card], async () => {
      if (missed.includes(addressOf(card.id))) throw new Error(why);
      return [await refusal(session, firewall, addressOf(card.id), broadcasts)];
    });
  }
};

/**
 * Every refusal card, against one session behind a firewall that allows no
 * sender. `have` says whether an optional phrase is in the seed file.
 */
export async function runRefusalChecks(
  session: Session,
  firewall: BroadcastFirewall,
  have: (name: SepoliaSecret) => boolean,
): Promise<void> {
  console.log("\n## Send is refused (SEND), behind the broadcast firewall");
  await group(
    session,
    firewall,
    null,
    [
      // Measured 2026-11-20: the wallet does not see that this OZ account's
      // owner moved off the phrase's key, so it signs with the old key and goes
      // to broadcast; the firewall blocks it, and the node would reject the
      // signature anyway. Scored as "Now" so a fix shows up as a change.
      row(
        "s-brm/TA-08",
        "SEND",
        "signs with the stale key and tries to broadcast; the firewall blocks it",
        { message: /firewall blocked a broadcast/u },
        "Read only: owner key changed",
      ),
    ],
    true,
  );
  await group(session, firewall, "S-SCR", [
    row("s-scr/TA-20", "SEND", "owner changed: 'Read only', nothing sent", { message: READ_ONLY }),
  ]);
  await group(session, firewall, "S-BRV", [
    row("s-brv/TA-29", "SEND", "2FA: 'Read only', nothing sent", { message: READ_ONLY }),
  ]);
  if (have("S-RDY")) {
    await group(session, firewall, "S-RDY", [
      row("s-rdy/TA-12", "SEND", "guardian: 'Read only', nothing sent", { message: READ_ONLY }),
    ]);
  }
}
