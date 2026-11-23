/**
 * Firefox smoke (`bun run test:firefox:smoke`): runs the built Gecko package
 * (`dist-firefox/`, from `bun run build:firefox`) in a real headless Firefox.
 *
 * `check:firefox` lints that package; nothing else ever starts it. The risks
 * this covers are the ones only a running Gecko shows: the scripts-based
 * event-page background (Firefox has no extension service worker) and Krusty's
 * WASM under Firefox's engine and CSP. So it walks the one path that needs
 * both: install, background answers, first-run import of the public test
 * phrase (Krusty derives the account), lock, unlock (Krusty opens the vault),
 * and the home shows the account an independent derivation expects.
 *
 * Offline, like the Chromium suite: Firefox's only route out is a loopback
 * proxy that answers the wallet's mainnet RPC hosts as an empty chain and
 * refuses everything else (`offline-network.ts`). The smoke proves that path
 * by fetching an outside host and requiring the proxy to have refused it;
 * prefs switch off the direct paths (DNS checks, WebRTC, HTTP/3) untested.
 *
 * Not a Playwright suite (Playwright cannot load Firefox add-ons) and not a
 * `bun test` file: it is a script, so neither runner picks it up. Exits
 * non-zero on the first failed step, printing geckodriver's log tail.
 */

import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addressText } from "@bramble/wallet-model/networks";
import { FIREFOX_EXTENSION_ID } from "../../apps/extension/firefox-manifest";
import { EXPECTED_IMPORT_ACCOUNT, IMPORT_MNEMONIC, VAULT_PASSPHRASE } from "../e2e/test-wallet";
import { resolveBrowser } from "./browser";
import { offlinePrefs, startOfflineNetwork } from "./offline-network";
import { openSession, type Session, waitFor } from "./webdriver";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const distPath = resolve(repoRoot, "dist-firefox");
// moz-extension origins are random per install; this pref fixes ours so page
// URLs are known. Any UUID works; this one only has to be stable.
const EXTENSION_UUID = "3f0c6a8e-5d2b-4c71-9e4a-b1a7f2c0d5e9";
const BASE = `moz-extension://${EXTENSION_UUID}`;
// Cold Krusty compile plus a mainnet scan of every account shape per index.
const SCAN_TIMEOUT_MS = 60_000;
const OUTSIDE_URL = "https://example.com/";

type Status = { readonly locked?: unknown };

const step = async (name: string, body: () => Promise<string | undefined>): Promise<void> => {
  const started = performance.now();
  const detail = await body();
  const ms = Math.round(performance.now() - started);
  console.log(`ok   ${name} (${ms} ms)${detail ? ` — ${detail}` : ""}`);
};

const freePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  await new Promise<void>((done) => server.close(() => done()));
  if (typeof address !== "object" || address === null) throw new Error("no free port");
  return address.port;
};

const walletStatus = async (session: Session): Promise<Status | undefined> => {
  const status = await session.runAsync(
    `const done = arguments[arguments.length - 1];
     browser.runtime.sendMessage({ type: "wallet.status" }).then(done, () => done(null));`,
  );
  return typeof status === "object" && status !== null ? (status as Status) : undefined;
};

// The home names the account; its address is one tap away, in the accounts
// drawer, as a short label whose title is the full address. Opens the drawer,
// requires the expected account on screen, and closes it again.
const homeAddress = async (session: Session): Promise<string> => {
  await session.button("Lock wallet", 20_000);
  await session.click(await session.css(".account-trigger"));
  const expected = addressText(EXPECTED_IMPORT_ACCOUNT);
  const label = await session.css(`[title="${expected}"]`).catch(async (error: unknown) => {
    const shown = await session.run(
      `return [...document.querySelectorAll("[title^='0x']")].map((node) => node.title);`,
    );
    throw new Error(`${String(error)}; addresses on the page: ${JSON.stringify(shown)}`);
  });
  const shown = `${await session.text(label)} (${expected})`;
  await session.click(await session.button("Close accounts"));
  return shown;
};

// WebDriver may not navigate to a moz-extension URL, so the smoke works in the
// tabs the extension opens itself and moves between them by handle.
const switchToPage = async (session: Session, path: string): Promise<void> => {
  await waitFor(`a tab on ${path}`, async () => {
    const handles = await session.call("GET", "/window/handles");
    for (const handle of Array.isArray(handles) ? handles : []) {
      await session.call("POST", "/window", { handle });
      if ((await session.call("GET", "/url")) === `${BASE}${path}`) return true;
    }
    return undefined;
  });
};

const importTestPhrase = async (session: Session): Promise<string> => {
  await session.click(await session.button("Add an existing wallet"));
  await session.click(await session.button("Recovery phrase"));
  await session.fill(await session.css('input[name="import-word-0"]'), IMPORT_MNEMONIC);
  await session.click(await session.button("Continue"));
  await session.fill(await session.css('input[name="vaultPassphrase"]'), VAULT_PASSPHRASE);
  await session.fill(await session.css('input[name="vaultPassphraseConfirm"]'), VAULT_PASSPHRASE);
  await session.click(await session.button("Find my accounts"));
  await session.heading("Find your accounts");
  const scanned = await waitFor(
    "the account scan to complete",
    async () => {
      const text = await session.text(await session.css("#recovery-scan-status", 1_000));
      return text.startsWith("Search complete") ? text : undefined;
    },
    SCAN_TIMEOUT_MS,
  );
  // The empty chain reports no activity, so nothing is preselected: open the
  // Bramble group and pick its first index, as the Chromium helper does.
  await session.click(await session.css('[data-recovery-group="openzeppelin"] summary'));
  await session.click(
    await session.css('[data-recovery-group="openzeppelin"] input[type="checkbox"]'),
  );
  await session.click(await session.button("Restore selected accounts"));
  // Completion either shows its done screen or hands off and closes the tab.
  await waitFor(
    "onboarding to finish",
    async () => {
      // Reading the current window throws once the tab has closed itself.
      if ((await session.call("GET", "/window").catch(() => undefined)) === undefined) return true;
      return (await session.heading("You’re all set", 500).catch(() => undefined)) && true;
    },
    20_000,
  );
  return scanned;
};

const main = async (): Promise<void> => {
  if (process.env["BRAMBLE_E2E_LIVE_NETWORK"]) {
    throw new Error("BRAMBLE_E2E_LIVE_NETWORK is set; the Firefox smoke runs offline only");
  }
  if (!existsSync(join(distPath, "manifest.json"))) {
    throw new Error("dist-firefox/ is missing; run `bun run build:firefox` first");
  }
  const work = await mkdtemp(join(tmpdir(), "bramble-firefox-smoke-"));
  const driverLog = join(work, "geckodriver.log");
  let closeNetwork = (): void => undefined;
  let logFd: number | undefined;
  let driverGroup: number | undefined;
  let session: Session | undefined;
  try {
    const network = await startOfflineNetwork(work);
    closeNetwork = network.close;
    const browser = await resolveBrowser(work);
    const port = await freePort();
    logFd = openSync(driverLog, "a");
    // Marionette treats moz-extension pages as privileged and refuses scripts,
    // clicks, and navigation there unless the driver allows system access.
    // That widens what this automation may touch, not what the add-on may do.
    const args = ["--allow-system-access", "--host", "127.0.0.1", "--port", String(port)];
    // Its own process group, so cleanup can take Firefox down with it even
    // when the session never closed.
    driverGroup = spawn(browser.geckodriver, args, {
      detached: true,
      stdio: ["ignore", logFd, logFd],
    }).pid;
    const driverUrl = `http://127.0.0.1:${port}`;
    await waitFor("geckodriver to listen", async () => {
      const status = await fetch(`${driverUrl}/status`, { signal: AbortSignal.timeout(2_000) });
      return status.ok ? true : undefined;
    });
    session = await openSession(driverUrl, {
      alwaysMatch: {
        acceptInsecureCerts: true,
        browserName: "firefox",
        "moz:firefoxOptions": {
          args: ["-headless"],
          binary: browser.firefox,
          prefs: {
            ...offlinePrefs(network.proxyPort),
            "extensions.webextensions.uuids": JSON.stringify({
              [FIREFOX_EXTENSION_ID]: EXTENSION_UUID,
            }),
          },
        },
      },
    });
    const wallet = session;

    await step("add-on installs", async () => {
      const id = await wallet.call("POST", "/moz/addon/install", {
        path: distPath,
        temporary: true,
      });
      if (id !== FIREFOX_EXTENSION_ID) throw new Error(`installed as ${String(id)}`);
      return String(id);
    });
    await step("background opens onboarding and answers", async () => {
      // The install handler opening this tab is the background's first sign of life.
      await switchToPage(wallet, "/onboarding.html");
      const status = await waitFor("wallet.status", () => walletStatus(wallet));
      // The wallet tab the home is read from later; onboarding may close its own.
      await wallet.run(`browser.tabs.create({ active: false, url: "/sidepanel.html" });`);
      return `wallet.status keys: ${Object.keys(status).sort().join(", ")}`;
    });
    await step("network is blackholed", async () => {
      const outcome = await wallet.runAsync(
        `const done = arguments[arguments.length - 1];
         fetch(arguments[0], { cache: "no-store" }).then(() => done("reached"), (e) => done(String(e)));`,
        OUTSIDE_URL,
      );
      const refused = network.events.some(
        (event) => event.verdict === "refused" && event.target === "CONNECT example.com:443",
      );
      if (outcome === "reached" || !refused) {
        throw new Error(`outside fetch: ${String(outcome)}; proxy refused it: ${refused}`);
      }
      return `fetch ${OUTSIDE_URL} → ${String(outcome)}; proxy refused CONNECT example.com:443`;
    });
    await step("onboarding imports the test phrase", async () => {
      const scanned = await importTestPhrase(wallet);
      const chainCalls = network.events.filter((event) => event.verdict === "chain").length;
      if (chainCalls === 0) throw new Error("the scan never reached the fake chain");
      return `${scanned} (${chainCalls} RPC connections to the fake chain)`;
    });
    await step("home shows the expected address", async () => {
      await switchToPage(wallet, "/sidepanel.html");
      await wallet.run("location.reload();");
      return homeAddress(wallet);
    });
    await step("lock", async () => {
      await wallet.click(await wallet.button("Lock wallet"));
      await wallet.heading("Welcome back");
      const status = await walletStatus(wallet);
      if (status?.locked !== true) throw new Error("wallet.status does not report locked");
      return undefined;
    });
    await step("unlock", async () => {
      await wallet.fill(await wallet.css('input[name="vaultPassphrase"]'), VAULT_PASSPHRASE);
      await wallet.click(await wallet.button("Unlock"));
      return homeAddress(wallet);
    });
    const refused = network.events.filter((event) => event.verdict === "refused");
    console.log(
      `Proxy: ${network.events.length - refused.length} chain connections, ${refused.length} refused (${[...new Set(refused.map((event) => event.target))].join(", ")})`,
    );
    console.log("Firefox smoke passed.");
  } catch (error) {
    if (existsSync(driverLog)) {
      const tail = readFileSync(driverLog, "utf8").split("\n").slice(-60).join("\n");
      console.error(`--- geckodriver log (tail) ---\n${tail}`);
    }
    throw error;
  } finally {
    await session?.call("DELETE", "").catch(() => undefined);
    if (driverGroup !== undefined) {
      try {
        process.kill(-driverGroup, "SIGKILL");
      } catch {
        // The group already exited with the session.
      }
    }
    if (logFd !== undefined) closeSync(logFd);
    closeNetwork();
    await rm(work, { force: true, recursive: true });
  }
};

try {
  await main();
} catch (error) {
  console.error(`FAIL Firefox smoke: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
