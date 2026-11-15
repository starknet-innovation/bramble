/**
 * QSB withdrawals in the built extension, end to end through the real
 * background: a funded, confirmed deposit is quoted and started, the
 * coordinator's job is followed from searching to ready, and then — because
 * no GPU search can solve a Bramble-derived vault here — the solved result
 * is a solution the pinned SDK cannot assemble. The review must
 * refuse it as `bindingRefused` and the release must disclose nothing: the
 * journal keeps the vault `allocated`, no request reaches `…/submit`, and
 * none of the 17 preimages and selected signatures that solution would disclose, derived offline through Krusty from
 * the account's own phrase, appears in any request.
 *
 * The coordinator is the suite's stand-in (tests/support), answered by
 * Playwright routes, on a copy of `dist/` granted its origin at install.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { type QsbSolution, qsbWithdrawalTransaction } from "@bramble/qsb/withdrawal-binding";
import { readQsbManifest } from "@bramble/qsb/withdrawal-manifest";
import { QSB_WITHDRAWAL_REFUSALS } from "@bramble/wallet-model/qsb-withdrawals";
import * as krusty from "@starknetfoundation/krusty-kms-wasm";
import { fakeCoordinatorState, paymentToAddress } from "../support/qsb-coordinator-fake";
import { solveFakeJob } from "../support/qsb-withdrawal-fake";
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

// Structurally valid, deliberately unsolved public hits. The built SDK must refuse them.
const FAKE_SOLUTION: QsbSolution = {
  sequence: 0x80000000,
  locktime: 500000000,
  round1: [0, 1, 2, 3, 4, 5, 6, 7],
  round2: [8, 9, 10, 11, 12, 13, 14, 15, 16],
  pqb: {
    pinning: "500000000 2147483648 0 0 0 0",
    round0: "0,1,2,3,4,5,6,7 0 0 0 0",
    round1: "0,1,2,3,4,5,6,7,8 0 0 0 0",
  },
};
krusty.initSync({
  module: new Uint8Array(
    readFileSync("node_modules/@starknetfoundation/krusty-kms-wasm/krusty_kms_wasm_bg.wasm"),
  ),
});
const kms = createKrustyKms(krusty);

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
  state.config["solverProtocol"] = "pqb-v1";
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
  const pqb = kms.pqb;
  const job = state.jobs.get(String(jobId));
  const manifest = readQsbManifest(job?.manifest);
  if (!pqb || !manifest) throw new Error("PQB fixture missing");
  const material = await pqb.material(mnemonic, 0);
  const transaction = qsbWithdrawalTransaction(manifest, FAKE_SOLUTION);
  if (!transaction) throw new Error("invalid fixture transaction");
  // Offline test-only disclosure: independently identify what must never have left the browser.
  const witness = await pqb.authorize(mnemonic, 0, {
    transaction,
    scriptHash: material.scriptSha256,
    round0: FAKE_SOLUTION.round1,
    round1: FAKE_SOLUTION.round2,
    menus: [0, 0, 0],
  });
  const secrets = [...witness.round0, ...witness.round1, ...witness.menus, witness.cosignature];
  const sent = bodies.join("\n");
  expect(secrets.filter((secret) => sent.includes(secret))).toEqual([]);
  expect(bodies.some((body) => body.includes("/v1/jobs "))).toBe(true);
};

test("follows a withdrawal to ready and refuses a solution that does not check out", async () => {
  test.setTimeout(300_000);
  await withCoordinatorGranted(journey);
});
