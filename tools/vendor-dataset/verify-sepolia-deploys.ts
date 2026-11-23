/**
 * Sepolia deploy run (issue 976): a first deploy of every account type the
 * wallet deploys, through the built extension, on a throwaway phrase made for
 * this run. The phrase is generated in memory, registered with the redactor,
 * and never printed or written; S-TXN's bank (TX-00) funds its accounts and
 * gets what is left back at the end, so no ladder grows night after night.
 *
 *   D7  a new account from Add account → Regular account, unfunded: it is one
 *       of the phrase's derived OZ addresses, and its Deploy screen asks for
 *       STRK; nothing is sent
 *   D1  OZ (Bramble account 0): the first send also deploys it
 *   D2  Argent 0.4 on Bramble's ladder (account 1): the first send deploys it
 *   D3  Argent 0.4 on Ready's ladder (index 0): the first send deploys it
 *   D4  OZ (Bramble account 2): explicit Deploy; sponsored when the relay
 *       offers it (the account's STRK stays put), otherwise self-paid
 *   D5  Braavos (index 1): "Not deployed" and refused until its explicit
 *       Deploy, then a send
 *
 * Every deployed address must equal an independent derivation (matrix-lib),
 * and its live class the class it was meant to deploy. The broadcast firewall
 * lets each check broadcast for its one account only.
 *
 * Run from the repository root after `bun run build`:
 *   bun run verify:sepolia:deploys
 * Spends testnet STRK only; exits non-zero when any check fails.
 */
import { isContractNotFoundError, parseTokenAmount } from "@bramble/starknet/rpc";
import { STRK_TOKEN_DECIMALS, sameFelt } from "@bramble/wallet-model/networks";
import { expect } from "@playwright/test";
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { Account, hash, uint256 } from "starknet";
import { sendRuntimeMessage } from "../../tests/e2e/wallet-helpers";
import { readTokenBalance, waitForSuccessfulReceipt } from "../../tests/live/chain";
import {
  argentAddress,
  braavosKeypair,
  brambleKeypair,
  CLASSES,
  NODE,
  provider,
  readyKeypair,
  TOKENS,
  tokenBalance,
  transfer,
} from "./matrix-lib";
import { guarded, redact, secret } from "./sepolia-redact";
import { sepoliaSecret } from "./sepolia-seeds";
import {
  activate,
  expectDeployedAs,
  failure,
  MAX_FEE_STRK,
  openGuardedSession,
  refusedFor,
  report,
  STRK,
  sendFrom,
  type Verdict,
} from "./verify-sepolia-live";
import { pace, type Session } from "./verify-sepolia-ui";

// Each case account's float: enough for a deploy and a send, swept back after.
const FUND = 10n ** 18n;
const BETWEEN_CASES_MS = 10_000;

/** One throwaway account: how to sign for it, its address, and the class a deploy leaves. */
type Throwaway = {
  readonly id: string;
  readonly priv: string;
  readonly address: string;
  readonly classHash: string;
};

const norm = (a: string): string => `0x${BigInt(a).toString(16)}`;
const oz = (kp: { priv: string; pub: string }, id: string): Throwaway => ({
  id,
  priv: kp.priv,
  address: norm(hash.calculateContractAddressFromHash("0x0", CLASSES.oz300, [kp.pub], 0)),
  classHash: CLASSES.oz300,
});
const argent = (kp: { priv: string; pub: string }, id: string): Throwaway => ({
  id,
  priv: kp.priv,
  address: argentAddress(kp.pub, CLASSES.argent040),
  classHash: CLASSES.argent040,
});
// A Braavos account deploys through its deployment class and lives on the
// current implementation, which is what its live class reads afterwards.
const braavos = (kp: { priv: string; pub: string }, id: string): Throwaway => ({
  id,
  priv: kp.priv,
  address: norm(hash.calculateContractAddressFromHash(kp.pub, CLASSES.braavosDeploy, [kp.pub], 0)),
  classHash: CLASSES.braavosImpl,
});

/** The Deploy screen of the active account, opened from Settings. */
const openDeploy = async (session: Session): Promise<void> => {
  const { panel } = session;
  await panel.locator('[data-view="settings"]').first().click({ timeout: 30_000 });
  await panel.locator('[data-view="deploy-account"]').first().click({ timeout: 30_000 });
  await expect(panel.locator("#deploy-review-stage")).toBeVisible({ timeout: 30_000 });
};

const SPONSORED = /Network fee: paid by the /u;
const SELF_PAID = /Maximum network fee: ([0-9]+(?:\.[0-9]+)?) STRK/u;

/**
 * Activates `account` and deploys it from its Deploy screen. Returns whether
 * the wallet sponsored it, and the transaction hash; a self-paid fee above the
 * cap is never confirmed.
 */
const deployFrom = async (session: Session, account: Throwaway): Promise<string> => {
  await activate(session, account.address);
  await openDeploy(session);
  const { panel } = session;
  const cost = panel.locator("#deploy-review");
  await expect
    .poll(async () => (await cost.textContent()) ?? "", { timeout: 90_000 })
    .toMatch(new RegExp(`${SPONSORED.source}|${SELF_PAID.source}`, "u"));
  const line = (await cost.textContent()) ?? "";
  const sponsored = SPONSORED.test(line);
  const quoted = line.match(SELF_PAID)?.[1];
  if (!sponsored) {
    if (!quoted) throw new Error("the Deploy screen showed no STRK fee; nothing was sent");
    if (
      parseTokenAmount(quoted, STRK_TOKEN_DECIMALS) >
      parseTokenAmount(MAX_FEE_STRK, STRK_TOKEN_DECIMALS)
    ) {
      throw new Error(`the deploy fee ${quoted} STRK is above the cap; nothing was sent`);
    }
  }
  const before = await readTokenBalance(NODE, account.address, STRK);
  await panel.locator("#deploy-button").click({ timeout: 30_000 });
  const hashCell = panel.locator("#deploy-success-hash");
  await expect
    .poll(async () => (await hashCell.getAttribute("title")) ?? "", { timeout: 180_000 })
    .toMatch(/^0x/u);
  const txHash = (await hashCell.getAttribute("title")) ?? "";
  await waitForSuccessfulReceipt(NODE, txHash);
  await expectDeployedAs(account.address, account.classHash);
  const after = await readTokenBalance(NODE, account.address, STRK);
  if (sponsored && after.raw !== before.raw) {
    throw new Error("a sponsored deploy changed the account's STRK balance");
  }
  return `${sponsored ? "sponsored" : "self-paid"} deploy ${txHash}`;
};

/** The active network's accounts the wallet holds. */
const sepoliaAccounts = async (session: Session): Promise<string[]> => {
  const status = await sendRuntimeMessage<{
    readonly accounts?: readonly { readonly address: string; readonly networkId?: string }[];
    readonly networkId?: string;
  }>(session.panel, { type: "wallet.status" });
  return (status?.accounts ?? [])
    .filter((a) => (a.networkId ?? status?.networkId) === status?.networkId)
    .map((a) => norm(a.address));
};

/**
 * D7: Add account → Regular account makes a new, unfunded account. It must be
 * one of the phrase's own OZ addresses, and its Deploy screen must ask for
 * STRK; nothing is clicked.
 */
const asksForStrk = async (session: Session, derived: readonly string[]): Promise<string> => {
  const before = await sepoliaAccounts(session);
  await session.openAdd(["regular"]);
  let created: string | undefined;
  await expect
    .poll(
      async () => {
        created = (await sepoliaAccounts(session)).find((a) => !before.includes(a));
        return created !== undefined;
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  const address = created ?? "";
  if (!derived.some((d) => sameFelt(d, address))) {
    throw new Error(`the new account ${address} is not one of the phrase's OZ addresses`);
  }
  await activate(session, address);
  await openDeploy(session);
  await expect(session.panel.locator("#deploy-review-stage")).toContainText(
    "Add STRK to this account to deploy it.",
    { timeout: 30_000 },
  );
  return `new account ${address} asks for STRK before deploying, as expected`;
};

/** Returns what is left on `account` to the bank; best effort, never fails the run. */
const sweep = async (account: Throwaway, bank: string): Promise<void> => {
  try {
    try {
      await provider.getClassHashAt(account.address);
    } catch (error) {
      if (isContractNotFoundError(error)) return;
      throw error;
    }
    const balance = await tokenBalance("STRK", account.address);
    const signer = new Account({
      provider,
      address: account.address,
      signer: account.priv,
      cairoVersion: "1",
    });
    const u = uint256.bnToUint256(1n);
    const estimate = await signer.estimateInvokeFee({
      contractAddress: TOKENS.STRK.address,
      entrypoint: "transfer",
      calldata: [bank, u.low, u.high],
    });
    // ponytail: three times the estimate covers the bounds starknet.js signs
    // for; the rest of that reserve stays behind as dust.
    const amount = balance - BigInt(estimate.overall_fee) * 3n;
    if (amount > 0n) await transfer(signer, "STRK", bank, amount);
  } catch (error) {
    console.log(redact(`sweep of ${account.id} skipped: ${String(error).split("\n")[0]}`));
  }
};

const verdicts: Verdict[] = [];
const ok = await guarded(async () => {
  const txn = secret(sepoliaSecret("S-TXN"));
  const bankKeys = brambleKeypair(txn, 0);
  secret(bankKeys.priv);
  const bankAddress = norm(
    hash.calculateContractAddressFromHash("0x0", CLASSES.oz300, [bankKeys.pub], 0),
  );
  const bank = new Account({
    provider,
    address: bankAddress,
    signer: bankKeys.priv,
    cairoVersion: "1",
  });

  const phrase = secret(generateMnemonic(wordlist));
  const keys = [
    brambleKeypair(phrase, 0),
    brambleKeypair(phrase, 1),
    readyKeypair(phrase, 0),
    brambleKeypair(phrase, 2),
    braavosKeypair(phrase, 1),
  ];
  for (const kp of keys) secret(kp.priv);
  const [d1Keys, d2Keys, d3Keys, d4Keys, d5Keys] = keys as [
    (typeof keys)[0],
    (typeof keys)[0],
    (typeof keys)[0],
    (typeof keys)[0],
    (typeof keys)[0],
  ];
  const d1 = oz(d1Keys, "D1");
  const d2 = argent(d2Keys, "D2");
  const d3 = argent(d3Keys, "D3");
  const d4 = oz(d4Keys, "D4");
  const d5 = braavos(d5Keys, "D5");
  const all = [d1, d2, d3, d4, d5];

  const { session, allowed, firewall } = await openGuardedSession(phrase);
  // One check at a time may broadcast, for its own account only; `null`
  // means it may broadcast nothing at all.
  const check = async (id: string, sender: string | null, run: () => Promise<string>) => {
    allowed.splice(0, allowed.length, ...(sender ? [sender] : []));
    const blocked = firewall.blocked.length;
    try {
      const why = await run();
      if (firewall.blocked.length > blocked) {
        throw new Error("the wallet attempted a broadcast the firewall blocked");
      }
      verdicts.push({ id, verdict: "pass", why });
    } catch (error) {
      verdicts.push({ id, verdict: "fail", why: await failure(error, session) });
    }
    allowed.length = 0;
    await pace(BETWEEN_CASES_MS);
  };
  try {
    // OZ addresses Bramble's ladder derives for this phrase, for D7's check.
    const derivedOz = [0, 1, 2, 3, 4, 5].map((i) => oz(brambleKeypair(phrase, i), "").address);
    await check("D7", null, () => asksForStrk(session, derivedOz));

    for (const account of all) await transfer(bank, "STRK", account.address, FUND);
    // Import what the wallet does not hold yet on Sepolia (Regular account may
    // already have made D1's address); a funded counterfactual is listed.
    const held = await sepoliaAccounts(session);
    const wanted = all.filter((a) => !held.some((h) => sameFelt(h, a.address)));
    const { page } = await session.scan(null);
    const missed = await session.importRows(
      page,
      wanted.map((a) => a.address),
    );
    for (const account of all.filter((a) => missed.some((m) => sameFelt(m, a.address)))) {
      verdicts.push({
        id: account.id,
        verdict: "fail",
        why: "the scan did not list it at its derived address",
      });
    }
    const imported = (a: Throwaway): boolean => !missed.some((m) => sameFelt(m, a.address));

    for (const account of [d1, d2, d3].filter(imported)) {
      await check(account.id, account.address, async () => {
        const txHash = await sendFrom(session, account.address, { classHash: account.classHash });
        return `first send deployed it: ${txHash}`;
      });
    }
    if (imported(d4)) await check("D4", d4.address, () => deployFrom(session, d4));
    if (imported(d5)) {
      await check("D5", d5.address, async () => {
        allowed.length = 0;
        await refusedFor(session, d5.address, "Not deployed");
        allowed.push(d5.address);
        const deployed = await deployFrom(session, d5);
        const sent = await sendFrom(session, d5.address);
        return `refused until deployed; ${deployed}; then sent ${sent}`;
      });
    }
  } finally {
    await session.close();
    for (const account of all) await sweep(account, bankAddress);
  }
});

report(ok, verdicts);
