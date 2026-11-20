/**
 * What the Sepolia live runs share (issue 976): the send run
 * (verify-sepolia-sends.ts) and the deploy run (verify-sepolia-deploys.ts).
 * Opening a session behind the broadcast firewall, switching accounts through
 * the drawer, a checked dust self-transfer, the read-only check, what the
 * wallet showed when a step stopped, and the verdict report. Everything
 * printed passes through the Sepolia redactor.
 */

import { isContractNotFoundError } from "@bramble/starknet/rpc";
import { sameFelt } from "@bramble/wallet-model/networks";
import { expect } from "@playwright/test";
import { sendRuntimeMessage } from "../../tests/e2e/wallet-helpers";
import {
  type BroadcastFirewall,
  installBroadcastFirewall,
} from "../../tests/live/broadcast-firewall";
import {
  defaultToken,
  readTokenBalance,
  receiptStrkFee,
  transferredToSelf,
  waitForSuccessfulReceipt,
} from "../../tests/live/chain";
import { expectActivity, selfTransfer } from "../../tests/live/send";
import { SELF_TRANSFER_AMOUNT, selfTransferRaw } from "../../tests/mainnet/local-mainnet-limits";
import { NETWORK, NODE, provider } from "./matrix-lib";
import { redact } from "./sepolia-redact";
import { openSession, type Session } from "./verify-sepolia-ui";

if (NETWORK !== "sepolia") throw new Error("set BRAMBLE_DATASET_NETWORK=sepolia");
// Playwright's debug logs echo every value typed, secrets included, before any redaction.
if (process.env["DEBUG"] || process.env["PWDEBUG"]) throw new Error("unset DEBUG and PWDEBUG");

// ponytail: Sepolia's fee cap, fixed in code like mainnet's; a review above it is not confirmed.
export const MAX_FEE_STRK = "0.5";
export const STRK = defaultToken("SN_SEPOLIA", "STRK");
const AMOUNT_RAW = selfTransferRaw(STRK.decimals);
/** Home's Send action; the wallet disables it for an account it will not sign for. */
export const SEND_TILE = '.action-tile[data-view="send"]';
/** One check's outcome, as the report prints it. */
export type Verdict = {
  readonly id: string;
  readonly verdict: "pass" | "fail" | "skip";
  readonly why: string;
};

/**
 * Makes `address` the active account the way a person does: Home's account
 * button, then the account's row in the drawer. Only finding the row's id and
 * confirming the switch read the wallet's status; the send's review then shows
 * the account on screen as From.
 */
export const activate = async (session: Session, address: string): Promise<void> => {
  type Status = {
    readonly accounts?: readonly {
      readonly address: string;
      readonly id: string;
      readonly networkId?: string;
    }[];
    readonly activeAccountId?: string | null;
    readonly networkId?: string;
  };
  const status = await sendRuntimeMessage<Status>(session.panel, { type: "wallet.status" });
  // Accounts are per network: the onboarded one is a mainnet account at the
  // same address, and the drawer lists only the active network's.
  const account = status?.accounts?.find(
    (a) => sameFelt(a.address, address) && (a.networkId ?? status.networkId) === status.networkId,
  );
  if (!account) throw new Error("the account is not in the wallet");
  const { panel } = session;
  await panel.reload();
  await panel.locator("#account-trigger").click({ timeout: 30_000 });
  await panel.locator(`.account-drawer [data-switch-account="${account.id}"]`).click({
    timeout: 30_000,
  });
  await expect
    .poll(
      async () =>
        (await sendRuntimeMessage<Status>(panel, { type: "wallet.status" }))?.activeAccountId,
      { timeout: 30_000 },
    )
    .toBe(account.id);
  await expect(panel.locator(".account-drawer")).toBeHidden({ timeout: 30_000 });
};

/**
 * What the wallet showed when a send stopped: the Home read-only notice, the
 * send form's message and the review's fee line, whichever are on screen.
 */
export const shown = async (session: Session): Promise<string> => {
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

/**
 * The account's nonce including pre-confirmed transactions, so a send in
 * flight counts. An account with no class yet has sent nothing: 0. Any other
 * failed read throws: a flaky node must never look like "nothing was sent".
 */
export const nonceOf = async (address: string): Promise<bigint> => {
  try {
    await provider.getClassHashAt(address, "pre_confirmed");
  } catch (error) {
    if (isContractNotFoundError(error)) return 0n;
    throw error;
  }
  return BigInt(await provider.getNonceForAddress(address, "pre_confirmed"));
};

/**
 * Waits until `address` is live at `classHash`. A receipt can arrive while its
 * block is still pre-confirmed, before `latest` shows the deployed class.
 */
export const expectDeployedAs = async (address: string, classHash: string): Promise<void> => {
  let live: string | null = null;
  await expect
    .poll(
      async () => {
        live = await provider.getClassHashAt(address).catch(() => null);
        return live !== null && sameFelt(live, classHash);
      },
      { intervals: [2_000, 4_000], timeout: 90_000 },
    )
    .toBe(true)
    .catch(() => {
      throw new Error(`deployed class is ${live ?? "none"}, not ${classHash}`);
    });
};

/**
 * An account the wallet will not send from: Home's notice says why ("Read
 * only" for a release it does not sign for, "Not deployed" for a Braavos
 * counterfactual), Send is disabled, and nothing reaches the chain from it.
 */
export const refusedFor = async (
  session: Session,
  address: string,
  notice = "Read only",
): Promise<void> => {
  const nonce = await nonceOf(address);
  await activate(session, address);
  await expect(session.panel.locator(".read-only-notice")).toContainText(notice, {
    timeout: 30_000,
  });
  await expect(session.panel.locator(SEND_TILE)).toBeDisabled({ timeout: 30_000 });
  if ((await nonceOf(address)) !== nonce) {
    throw new Error("the nonce moved");
  }
};

// Home refreshes balances on an ambient poll (60 s) while the panel is open,
// and an ordinary poll may be answered from the background's snapshot, so a
// balance that arrives from elsewhere can take more than a minute to show.
const HOME_CATCH_UP_MS = 180_000;

/**
 * Waits, without reloading, until Home shows `formatted` STRK for the active
 * account, as a person would before sending. Logs how long it took when it was
 * not at once; failing to catch up within HOME_CATCH_UP_MS is a wallet bug.
 */
export const expectHomeBalance = async (
  session: Session,
  address: string,
  formatted: string,
): Promise<void> => {
  const row = session.panel.locator(`[data-live-key="token:${STRK.id}:balance"]`);
  const started = Date.now();
  let seen: string | null = null;
  await expect
    .poll(
      async () => {
        seen = await row.getAttribute("data-live-value", { timeout: 5_000 }).catch(() => null);
        return seen;
      },
      { intervals: [1_000, 2_000, 5_000], timeout: HOME_CATCH_UP_MS },
    )
    .toBe(formatted)
    .catch(() => {
      throw new Error(
        `Home still shows ${seen ?? "no STRK row"} STRK for ${address} after ${HOME_CATCH_UP_MS / 1000}s; the chain has ${formatted}`,
      );
    });
  const waited = Math.round((Date.now() - started) / 1000);
  if (waited > 5) console.log(`   Home showed the funded balance of ${address} after ${waited}s`);
};

/**
 * One dust self-transfer from `address`, checked on-chain and in Activity. With
 * `deploys`, the account is a counterfactual whose first send also deploys it:
 * the balance then drops by two fees, so the deployed class is checked instead.
 */
export const sendFrom = async (
  session: Session,
  address: string,
  deploys?: { readonly classHash: string },
): Promise<string> => {
  await activate(session, address);
  const before = await readTokenBalance(NODE, address, STRK);
  await expectHomeBalance(session, address, before.formatted);
  const hash = await selfTransfer(session.panel, {
    amount: SELF_TRANSFER_AMOUNT,
    maxFeeStrk: MAX_FEE_STRK,
    networkId: "SN_SEPOLIA",
    recipient: address,
    sender: address,
    symbol: "STRK",
  });
  const receipt = await waitForSuccessfulReceipt(NODE, hash);
  const fee = receiptStrkFee(receipt);
  const moved = transferredToSelf(receipt, STRK.address, address);
  if (moved !== AMOUNT_RAW) throw new Error(`moved ${moved} to self, not ${AMOUNT_RAW}`);
  if (deploys) {
    await expectDeployedAs(address, deploys.classHash);
  } else {
    await expect
      .poll(async () => before.raw - (await readTokenBalance(NODE, address, STRK)).raw, {
        intervals: [2_000, 4_000],
        timeout: 60_000,
      })
      .toBe(fee);
  }
  await expectActivity(session.panel, hash);
  return hash;
};

/** A timeout's first line does not name its element; the call log does, so keep both. */
export const failure = async (error: unknown, session: Session): Promise<string> => {
  const text = String(error);
  const waited = text.match(/waiting for (locator\(.+?\))/u)?.[1];
  return `${text.split("\n")[0] ?? ""}${waited ? ` waiting for ${waited}` : ""}${await shown(session)}`;
};

/**
 * Opens `mnemonic` in a fresh profile with the broadcast firewall installed
 * before any page, and fails before anything else if the firewall saw no
 * wallet traffic. `allowed` is the firewall's live allowlist: set it to the one
 * account a check may send from, and empty it after.
 */
export const openGuardedSession = async (
  mnemonic: string,
): Promise<{ session: Session; allowed: string[]; firewall: BroadcastFirewall }> => {
  const allowed: string[] = [];
  let firewall: BroadcastFirewall | undefined;
  const session = await openSession(mnemonic, async (context) => {
    firewall = await installBroadcastFirewall(context, allowed);
  });
  if (!firewall || firewall.inspected() === 0) {
    await session.close();
    throw new Error("the broadcast firewall saw no wallet RPC traffic; nothing was sent");
  }
  return { session, allowed, firewall };
};

/** Prints every verdict (redacted) and the tally, then exits non-zero on any failure. */
export const report = (ok: boolean, verdicts: readonly Verdict[]): never => {
  for (const v of verdicts) console.log(redact(`${v.id} ${v.verdict}: ${v.why}`).slice(0, 700));
  const count = (verdict: Verdict["verdict"]): number =>
    verdicts.filter((v) => v.verdict === verdict).length;
  console.log(`\n${count("pass")} pass · ${count("fail")} fail · ${count("skip")} skip`);
  // Exit explicitly: a failed run can leave the browser open.
  process.exit(ok && count("fail") === 0 ? 0 : 1);
};
