/**
 * Shared steps of the QSB vault and withdrawal E2E specs: a copy of `dist/`
 * granted the coordinator's origin at install (a test cannot click the
 * runtime grant through), the coordinator answered by Playwright routes over
 * the suite's stand-in (tests/support), a writer QSB account, and a deposit
 * funded and confirmed. Every request body the routes see is kept, so a spec
 * can show what never left the worker.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  QSB_COORDINATOR_ORIGIN,
  QSB_COORDINATOR_PERMISSION,
} from "@bramble/wallet-model/qsb-vaults";
import type { Page, Route } from "@playwright/test";
import { answerQsbRequest, type FakeCoordinatorState } from "../support/qsb-coordinator-fake";
import { distPath, type LoadedExtension, launchExtension } from "./extension-fixture";
import { sendRuntimeMessage, VAULT_PASSPHRASE } from "./wallet-helpers";

/** The coordinator's origin. */
export const COORDINATOR = QSB_COORDINATOR_ORIGIN;

/** A runtime reply: its fields, or an error. */
export type Reply = Record<string, unknown> & {
  readonly error?: string;
  readonly ok?: true;
};

/**
 * Runs `run` on a copy of `dist/` whose manifest grants the coordinator's
 * origin at install, as the user's runtime grant would.
 */
export const withCoordinatorGranted = async (
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

/** What the browser itself says about the coordinator's origin. */
export const coordinatorGranted = (page: Page): Promise<boolean> =>
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

/** Sends `message` and answers its reply, throwing on an error. */
export const send = async (page: Page, message: Record<string, unknown>): Promise<Reply> => {
  const reply = await sendRuntimeMessage<Reply>(page, message);
  if (!reply || reply.error !== undefined) {
    throw new Error(`${String(message["type"])} failed: ${reply?.error ?? "no reply"}`);
  }
  return reply;
};

/**
 * Answers the coordinator from whatever stand-in `current` returns now,
 * keeping every request body in `bodies` when given.
 */
export const routeCoordinator = async (
  page: Page,
  current: () => FakeCoordinatorState,
  bodies: string[] = [],
): Promise<void> => {
  await page.context().route(`${COORDINATOR}/**`, async (route: Route) => {
    const request = route.request();
    bodies.push(`${request.url()} ${request.postData() ?? ""}`);
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

/**
 * Creates a QSB account and confirms its backup with three words of the
 * phrase the vault reveals under the wallet password: a writer. Answers its
 * id and phrase.
 */
export const createWriterAccount = async (
  page: Page,
): Promise<{ readonly accountId: string; readonly mnemonic: string }> => {
  const created = await send(page, { type: "wallet.createQsbAccount" });
  const accountId = String((created["account"] as { readonly id: string }).id);
  const revealed = await send(page, {
    accountId,
    passphrase: VAULT_PASSPHRASE,
    type: "wallet.revealQsbPhrase",
  });
  const mnemonic = String(revealed["mnemonic"]);
  const words = mnemonic.split(" ");
  await send(page, {
    accountId,
    type: "wallet.confirmQsbBackup",
    words: [0, 11, 23].map((index) => ({ index, word: words[index] ?? "" })),
  });
  return { accountId, mnemonic };
};
