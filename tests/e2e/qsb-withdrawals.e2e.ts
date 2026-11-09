/**
 * QSB withdrawals in the built extension, end to end through the real
 * background: a funded, confirmed deposit is quoted and started, the
 * coordinator's job is followed from searching to ready, and then — because
 * no GPU search can solve a Bramble-derived vault here — the solved result
 * is a solution the pinned Pyodide pipeline cannot assemble. The review must
 * refuse it as `bindingRefused` and the release must disclose nothing: the
 * journal keeps the vault `allocated`, no request reaches `…/submit`, and
 * none of the 15 secrets that solution would disclose, recomputed here from
 * the account's own phrase with the BIP's equations, appears in any request.
 *
 * The coordinator is the suite's stand-in (tests/support), answered by
 * Playwright routes, on a copy of `dist/` granted its origin at install.
 */
import { createHash, createHmac, pbkdf2Sync } from "node:crypto";
import { QSB_WITHDRAWAL_REFUSALS } from "@bramble/wallet-model/qsb-withdrawals";
import { fakeCoordinatorState, paymentToAddress } from "../support/qsb-coordinator-fake";
import { FAKE_SOLUTION, solveFakeJob } from "../support/qsb-withdrawal-fake";
import type { LoadedExtension } from "./extension-fixture";
import { expect, test } from "./fixtures";
import {
  coordinatorGranted,
  createWriterAccount,
  routeCoordinator,
  send,
  withCoordinatorGranted,
} from "./qsb-e2e-support";
import {
  IMPORT_MNEMONIC,
  importWalletFromPhrase,
  sendRuntimeMessage,
  VAULT_PASSPHRASE,
} from "./wallet-helpers";

const DESTINATION = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";

// QSB-HORS-v1 (BIP "QSB Wallet Secret Management"): the BIP-39 seed, its
// SLIP-0021 key at "QSB-HORS", and one secret, net 0. Independent of Krusty.
const horsKey = (mnemonic: string): Buffer => {
  const seed = pbkdf2Sync(mnemonic.normalize("NFKD"), "mnemonic", 2048, 64, "sha512");
  const master = createHmac("sha512", "Symmetric key seed").update(seed).digest();
  const node = createHmac("sha512", master.subarray(0, 32))
    .update(Buffer.concat([Buffer.from([0]), Buffer.from("QSB-HORS")]))
    .digest();
  return node.subarray(32, 64);
};
const horsSecret = (key: Buffer, v: number, r: number, i: number): string => {
  const message = Buffer.alloc(20);
  message.write("QSB-HORS-v1", 0, "ascii");
  message.writeUInt32BE(v, 13);
  message.writeUInt8(r, 17);
  message.writeUInt16BE(i, 18);
  return createHmac("sha256", key).update(message).digest("hex").slice(0, 40);
};

type Withdrawal = { readonly state: string; readonly withdrawal: Record<string, unknown> };

const journey = async (extension: LoadedExtension): Promise<void> => {
  const sidepanel = await extension.openExtensionPage("sidepanel.html");
  await importWalletFromPhrase(sidepanel, IMPORT_MNEMONIC);
  expect(await coordinatorGranted(sidepanel)).toBe(true);
  const bodies: string[] = [];
  let state = fakeCoordinatorState("");
  await routeCoordinator(sidepanel, () => state, bodies);
  const { accountId, mnemonic } = await createWriterAccount(sidepanel);
  const owner = String((await send(sidepanel, { accountId, type: "wallet.qsbVaults" }))["address"]);
  state = fakeCoordinatorState(owner, paymentToAddress(owner, [300_000], "qsb e2e funds"));
  const vault0 = async (): Promise<Withdrawal> =>
    (
      (await send(sidepanel, { accountId, type: "wallet.qsbVaults" }))["vaults"] as Withdrawal[]
    )[0] as Withdrawal;

  // A deposit, funded and confirmed; the listing records it.
  await send(sidepanel, { accountId, type: "wallet.createQsbVault" });
  const deposit = { accountId, amountSat: 100_000, v: 0 } as const;
  const quoted = await send(sidepanel, { ...deposit, type: "wallet.quoteQsbDeposit" });
  const feeSat = (quoted["quote"] as { readonly feeSat: number }).feeSat;
  const deposited = await send(sidepanel, { ...deposit, feeSat, type: "wallet.depositQsbVault" });
  state.confirmed.add(String((deposited["vault"] as { deposit: { txid: string } }).deposit.txid));
  expect((await vault0()).withdrawal).toMatchObject({ status: "none" });
  state.utxos = paymentToAddress(owner, [2_000], "qsb e2e helper");

  // Quote, start, then follow the job from searching to ready.
  const withdrawal = { accountId, destination: DESTINATION, v: 0 } as const;
  const quote = (await send(sidepanel, { ...withdrawal, type: "wallet.quoteQsbWithdrawal" }))[
    "quote"
  ] as { readonly feeSat: number; readonly outputSat: number };
  expect(quote).toMatchObject({ destination: DESTINATION, fundingSat: 100_000, helperSat: 2_000 });
  const started = await send(sidepanel, {
    ...withdrawal,
    feeSat: quote.feeSat,
    type: "wallet.startQsbWithdrawal",
  });
  expect(started["vault"]).toMatchObject({
    withdrawal: { destination: DESTINATION, feeSat: quote.feeSat, status: "searching" },
  });
  expect((await vault0()).withdrawal).toMatchObject({ status: "searching", txid: null });
  const [jobId] = state.jobs.keys();
  solveFakeJob(state, String(jobId), { ...FAKE_SOLUTION });
  expect((await vault0()).withdrawal).toMatchObject({
    outputSat: quote.outputSat,
    status: "ready",
  });

  // The pinned pipeline cannot assemble that solution: nothing is disclosed.
  const refused = { error: QSB_WITHDRAWAL_REFUSALS.bindingRefused };
  expect(
    await sendRuntimeMessage(sidepanel, { accountId, type: "wallet.reviewQsbWithdrawal", v: 0 }),
  ).toEqual(refused);
  expect(
    await sendRuntimeMessage(sidepanel, {
      accountId,
      digest: createHash("sha256").update("not reviewed").digest("hex"),
      emergency: false,
      passphrase: VAULT_PASSPHRASE,
      type: "wallet.releaseQsbWithdrawal",
      v: 0,
    }),
  ).toEqual(refused);
  expect(await vault0()).toMatchObject({ state: "allocated", withdrawal: { status: "ready" } });
  expect(state.calls).not.toContain("POST /jobs/:id/submit");
  const key = horsKey(mnemonic);
  const sorted = (values: readonly number[]) => [...values].sort((a, b) => a - b);
  const secrets = [
    ...sorted(FAKE_SOLUTION.round1)
      .slice(0, 8)
      .map((i) => horsSecret(key, 0, 0, i)),
    ...sorted(FAKE_SOLUTION.round2)
      .slice(0, 7)
      .map((i) => horsSecret(key, 0, 1, i)),
  ];
  const sent = bodies.join("\n");
  expect(secrets.filter((secret) => sent.includes(secret))).toEqual([]);
  expect(bodies.some((body) => body.includes("/v1/jobs "))).toBe(true);
};

test("follows a withdrawal to ready and refuses a solution that does not check out", async () => {
  test.setTimeout(300_000);
  await withCoordinatorGranted(journey);
});
