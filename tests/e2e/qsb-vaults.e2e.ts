/**
 * Quantum-safe Bitcoin vaults in the built extension, end to end through the
 * real background: Krusty derives the owner key and the commitments, the
 * pinned Pyodide pipeline builds the vault script in the service worker, the
 * journal and the pending deposit live in their own encrypted keys, and every
 * coordinator request goes to qsb-app's origin, answered here by Playwright
 * routes over the suite's stand-in coordinator (tests/support).
 *
 * The stand-in checks what the deployment's edge checks — the body hash on
 * every POST, the session header, a registration whose script hash is the
 * SHA-256 of its script and whose owner signed in, a deposit whose output 0
 * pays the vault script — and holds a real previous transaction paying the
 * owner address the background reports. The five vault messages are driven with
 * `sendRuntimeMessage`; the spec then shows the journal recorded the funding
 * and that the worker fetched nothing but the coordinator and its own package.
 *
 * The coordinator's origin is an optional host permission the user grants at
 * runtime, which a test cannot click through, so the funded journey loads a
 * copy of `dist/` whose manifest grants it at install. The shipped `dist/`
 * does not, and there every vault action refuses with `accessNeeded` and
 * nothing is allocated or sent.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  QSB_COORDINATOR_ORIGIN,
  QSB_COORDINATOR_PERMISSION,
  QSB_VAULT_REFUSALS,
} from "@bramble/wallet-model/qsb-vaults";
import type { Page, Request, Route } from "@playwright/test";
import {
  answerQsbRequest,
  type FakeCoordinatorState,
  fakeCoordinatorState,
  paymentToAddress,
} from "../support/qsb-coordinator-fake";
import { distPath, type LoadedExtension, launchExtension } from "./extension-fixture";
import { expect, test } from "./fixtures";
import {
  IMPORT_MNEMONIC,
  importWalletFromPhrase,
  sendRuntimeMessage,
  VAULT_PASSPHRASE,
} from "./wallet-helpers";

const COORDINATOR = QSB_COORDINATOR_ORIGIN;

type Reply = Record<string, unknown> & {
  readonly error?: string;
  readonly ok?: true;
};

// Runs `run` on a copy of `dist/` whose manifest grants the coordinator's
// origin at install, as the user's runtime grant would.
const withCoordinatorGranted = async (
  run: (extension: LoadedExtension) => Promise<void>,
): Promise<void> => {
  const directory = await mkdtemp(join(tmpdir(), "bramble-qsb-granted-"));
  await cp(distPath, directory, { recursive: true });
  const manifestPath = join(directory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    host_permissions: string[];
  };
  manifest.host_permissions = [...manifest.host_permissions, QSB_COORDINATOR_PERMISSION];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  const extension = await launchExtension({ extensionPath: directory });
  try {
    await run(extension);
  } finally {
    await extension.close();
    await rm(directory, { force: true, recursive: true });
  }
};

// What the browser itself says about the coordinator's origin.
const coordinatorGranted = (page: Page): Promise<boolean> =>
  page.evaluate(
    (origins) =>
      (
        globalThis as typeof globalThis & {
          readonly chrome: {
            readonly permissions: {
              readonly contains: (query: { origins: string[] }) => Promise<boolean>;
            };
          };
        }
      ).chrome.permissions.contains({ origins }),
    [QSB_COORDINATOR_PERMISSION],
  );

const send = async (page: Page, message: Record<string, unknown>): Promise<Reply> => {
  const reply = await sendRuntimeMessage<Reply>(page, message);
  if (!reply || reply.error !== undefined) {
    throw new Error(`${String(message["type"])} failed: ${reply?.error ?? "no reply"}`);
  }
  return reply;
};

// The coordinator, answered from whatever stand-in `current` returns now.
const routeCoordinator = async (page: Page, current: () => FakeCoordinatorState): Promise<void> => {
  await page.context().route(`${COORDINATOR}/**`, async (route: Route) => {
    const request = route.request();
    const answer = answerQsbRequest(
      current(),
      {
        body: request.postData(),
        headers: request.headers(),
        method: request.method(),
        url: request.url(),
      },
      Date.now(),
    );
    await route.fulfill({ json: answer.body, status: answer.status });
  });
};

// Creates a QSB account and confirms its backup with three words of the
// phrase the vault reveals under the wallet password: a writer.
const createWriterAccount = async (page: Page): Promise<string> => {
  const created = await send(page, { type: "wallet.createQsbAccount" });
  const accountId = String((created["account"] as { readonly id: string }).id);
  const revealed = await send(page, {
    accountId,
    passphrase: VAULT_PASSPHRASE,
    type: "wallet.revealQsbPhrase",
  });
  const words = String(revealed["mnemonic"]).split(" ");
  await send(page, {
    accountId,
    type: "wallet.confirmQsbBackup",
    words: [0, 11, 23].map((index) => ({ index, word: words[index] ?? "" })),
  });
  return accountId;
};

test("refuses every vault action, and allocates nothing, until the coordinator is granted", async ({
  extension,
}) => {
  test.setTimeout(120_000);
  const fetched: string[] = [];
  extension.context.on("request", (request: Request) => {
    fetched.push(request.url());
  });
  const sidepanel = await extension.openExtensionPage("sidepanel.html");
  await importWalletFromPhrase(sidepanel, IMPORT_MNEMONIC);
  expect(await coordinatorGranted(sidepanel)).toBe(false);
  const state = fakeCoordinatorState("");
  await routeCoordinator(sidepanel, () => state);
  const accountId = await createWriterAccount(sidepanel);

  const listed = await send(sidepanel, { accountId, type: "wallet.qsbVaults" });
  expect(String(listed["address"])).toMatch(/^bc1q[02-9ac-hj-np-z]{38}$/);
  expect(listed).toMatchObject({ funds: null, vaults: [] });
  const refused = { error: QSB_VAULT_REFUSALS.accessNeeded };
  expect(await sendRuntimeMessage(sidepanel, { accountId, type: "wallet.createQsbVault" })).toEqual(
    refused,
  );
  expect(
    await sendRuntimeMessage(sidepanel, {
      accountId,
      amountSat: 100_000,
      type: "wallet.quoteQsbDeposit",
      v: 0,
    }),
  ).toEqual(refused);
  // Nothing was allocated: the journal still holds no vault.
  expect(await send(sidepanel, { accountId, type: "wallet.qsbVaults" })).toMatchObject({
    funds: null,
    vaults: [],
  });
  expect(state.calls).toEqual([]);
  expect(fetched.filter((url) => url.startsWith(COORDINATOR))).toEqual([]);
});

const fundedJourney = async (extension: LoadedExtension): Promise<void> => {
  const fetched: string[] = [];
  extension.context.on("request", (request: Request) => {
    fetched.push(request.url());
  });
  const sidepanel = await extension.openExtensionPage("sidepanel.html");
  await importWalletFromPhrase(sidepanel, IMPORT_MNEMONIC);
  expect(await coordinatorGranted(sidepanel)).toBe(true);
  // First with the chain unreachable: the listing still names the owner.
  let state = fakeCoordinatorState("");
  state.refusals.set("GET /payment-utxos", { code: "chain_unavailable", status: 503 });
  await routeCoordinator(sidepanel, () => state);
  const accountId = await createWriterAccount(sidepanel);
  const offlineFirst = await send(sidepanel, { accountId, type: "wallet.qsbVaults" });
  const owner = String(offlineFirst["address"]);
  expect(owner).toMatch(/^bc1q[02-9ac-hj-np-z]{38}$/);
  expect(offlineFirst).toMatchObject({ funds: null, vaults: [] });

  // Then funded: one confirmed 300,000-sat output paying the owner.
  state = fakeCoordinatorState(owner, paymentToAddress(owner, [300_000], "qsb e2e funds"));
  fetched.length = 0;
  const listed = await send(sidepanel, { accountId, type: "wallet.qsbVaults" });
  expect(listed).toMatchObject({
    address: owner,
    funds: { totalSat: 300_000, utxoCount: 1 },
    vaults: [],
  });

  // The pinned pipeline builds the script in the worker: this boots Pyodide.
  const created = await send(sidepanel, { accountId, type: "wallet.createQsbVault" });
  expect(created["vault"]).toEqual({
    deposit: { amountSat: null, confirmations: null, status: "none", txid: null },
    registered: true,
    state: "allocated",
    v: 0,
  });
  const [registered] = [...state.vaults.values()];
  expect(String(registered?.vault["scriptHex"]).length).toBe(9_923 * 2);

  const quoted = await send(sidepanel, {
    accountId,
    amountSat: 100_000,
    type: "wallet.quoteQsbDeposit",
    v: 0,
  });
  const quote = quoted["quote"] as { readonly feeSat: number; readonly inputCount: number };
  expect(quoted["quote"]).toMatchObject({ amountSat: 100_000, feeRate: "2", inputCount: 1 });

  const deposited = await send(sidepanel, {
    accountId,
    amountSat: 100_000,
    feeSat: quote.feeSat,
    type: "wallet.depositQsbVault",
    v: 0,
  });
  expect(deposited["submission"]).toBe("submitted");
  const txid = String(
    (deposited["vault"] as { readonly deposit: { readonly txid: string } }).deposit.txid,
  );
  expect(txid).toMatch(/^[0-9a-f]{64}$/);
  expect(registered?.raw).toBeTruthy();

  // A resend with nothing kept here asks the coordinator to resend its bytes.
  const resent = await send(sidepanel, { accountId, type: "wallet.resendQsbDeposit", v: 0 });
  expect(resent).toMatchObject({
    submission: "submitted",
    vault: { deposit: { status: "submitted", txid } },
  });

  // Mined: the listing records the deposit in the journal.
  state.confirmed.add(txid);
  const confirmed = await send(sidepanel, { accountId, type: "wallet.qsbVaults" });
  expect(confirmed["vaults"]).toEqual([
    {
      deposit: { amountSat: 100_000, confirmations: 1, status: "confirmed", txid },
      registered: true,
      state: "allocated",
      v: 0,
    },
  ]);
  // The journal holds it now: confirmed even with the coordinator unreachable.
  state.refusals.set("GET /payment-utxos", { code: "chain_unavailable", status: 503 });
  const offline = await send(sidepanel, { accountId, type: "wallet.qsbVaults" });
  expect(offline).toMatchObject({
    funds: null,
    vaults: [{ deposit: { status: "confirmed", txid }, registered: null }],
  });

  // The worker reached the coordinator and its own package, nothing else.
  const origins = new Set(fetched.map((url) => new URL(url).origin));
  expect([...origins].filter((origin) => !origin.startsWith("chrome-extension://"))).toEqual([
    COORDINATOR,
  ]);
  expect(state.calls).toEqual(
    expect.arrayContaining([
      "POST /auth/challenge",
      "POST /auth/verify",
      "POST /vaults",
      "POST /payment-input",
      "GET /rates",
      "POST /vaults/:id/fund/submit",
      "GET /vaults/:id/funding",
    ]),
  );
};

test("creates, funds and confirms a quantum-safe Bitcoin vault", async () => {
  test.setTimeout(240_000);
  await withCoordinatorGranted(fundedJourney);
});
