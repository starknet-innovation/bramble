/**
 * QSB runtime spike: the pinned QSB pipeline loads and runs inside Bramble's
 * MV3 module service worker, every file read from the extension package —
 * the public probe, and the commitments-only setup of the QSB BIP test vault
 * to its known script hash — and what that costs.
 *
 * Each test loads a copy of `dist/` whose manifest names a small wrapper as the
 * worker. The wrapper imports the real `background/index.js` — the whole wallet
 * worker, unchanged, under the real manifest and CSP — and hands its
 * `qsbRuntime` export to the worker global so the spec can call it; nothing in
 * the shipped extension can reach that export. It also records every `fetch`
 * the worker makes after start-up, which is how the spec shows Pyodide read
 * nothing from off the package (the suite's DNS blackhole would make any such
 * request fail anyway).
 *
 * Only correctness is asserted. Timings are printed and attached to the test
 * as annotations: they depend on the machine, and on whether a visible
 * extension page keeps the worker's renderer process at foreground priority.
 */
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Worker } from "@playwright/test";
import {
  QSB_PUBLIC_PROBE_ANSWERS,
  QSB_TEST_VAULT_COMMITMENTS,
  QSB_TEST_VAULT_SETUP,
} from "../../scripts/qsb-known-answers";
import { distPath, type LoadedExtension, launchExtension } from "./extension-fixture";
import { expect, test } from "./fixtures";

const PROBE_SCRIPT = "background/qsb-probe.js";
const PROBE_WORKER = `import { qsbRuntime } from "./index.js";
const fetched = [];
const walletFetch = self.fetch;
self.fetch = (input, init) => {
  fetched.push(String(input instanceof Request ? input.url : input));
  return walletFetch(input, init);
};
self.qsbProbe = { evaluatedAt: performance.now(), fetched, runtime: qsbRuntime };
`;
// Stands in for Pyodide when measuring what the static import costs at every
// worker start: same module graph, minus the 1 MB Emscripten module's parse.
const STUBBED_PYODIDE = {
  "dependencies/pyodide/pyodide.asm.js": "",
  "dependencies/pyodide/pyodide.mjs":
    'export const loadPyodide = () => Promise.reject(new Error("stubbed"));\n',
} as const;
const PACKAGED_FILES = [
  "dependencies/pyodide/pyodide-lock.json",
  "dependencies/pyodide/pyodide.asm.wasm",
  "dependencies/pyodide/python_stdlib.zip",
  "vendor/qsb/bitcoin_tx.py",
  "vendor/qsb/bridge.py",
  "vendor/qsb/manifest.json",
  "vendor/qsb/qsb_pipeline.py",
  "vendor/qsb/secp256k1.py",
] as const;

type ProbeRun = {
  readonly evaluatedAt: number;
  readonly fetched: readonly string[];
  readonly ms: number;
  readonly result: unknown;
};

// A run of the commitments setup: the vault's three public fields.
type VaultRun = ProbeRun & {
  readonly result: {
    readonly publicStateJson: string;
    readonly scriptHash: string;
    readonly scriptHex: string;
  };
};

const composeProbeExtension = async (
  replacements: Readonly<Record<string, string>> = {},
): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "bramble-qsb-probe-"));
  await cp(distPath, directory, { recursive: true });
  const manifestPath = join(directory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  manifest["background"] = { service_worker: PROBE_SCRIPT, type: "module" };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await writeFile(join(directory, PROBE_SCRIPT), PROBE_WORKER);
  for (const [path, contents] of Object.entries(replacements)) {
    await writeFile(join(directory, path), contents);
  }
  return directory;
};

const withProbeExtension = async (
  run: (extension: LoadedExtension) => Promise<void>,
  replacements: Readonly<Record<string, string>> = {},
): Promise<void> => {
  const directory = await composeProbeExtension(replacements);
  const extension = await launchExtension({
    extensionPath: directory,
    serviceWorkerScript: PROBE_SCRIPT,
  });
  try {
    await run(extension);
  } finally {
    await extension.close();
    await rm(directory, { force: true, recursive: true });
  }
};

const probeReady = async (worker: Worker): Promise<void> => {
  await expect
    .poll(() => worker.evaluate(() => "qsbProbe" in self), { timeout: 15_000 })
    .toBe(true);
};

const fetchCount = (worker: Worker): Promise<number> =>
  worker.evaluate(
    () =>
      (self as unknown as { readonly qsbProbe: { readonly fetched: string[] } }).qsbProbe.fetched
        .length,
  );

// The wallet worker refreshes its own feeds as it starts. Let that settle so
// the probe's window holds only what the QSB runtime itself fetched.
const networkSettled = async (worker: Worker): Promise<void> => {
  let previous = -1;
  await expect
    .poll(
      async () => {
        const count = await fetchCount(worker);
        const settled = count === previous;
        previous = count;
        return settled;
      },
      { intervals: [1_000], timeout: 15_000 },
    )
    .toBe(true);
};

/**
 * Calls the runtime once — the probe, or the setup of `commitments` — and
 * returns its duration and the fetches made while it ran. Measured inside the
 * worker, so the CDP round trip is not counted.
 */
const timedCall = async (
  worker: Worker,
  commitments: readonly (readonly string[])[] | null,
): Promise<ProbeRun> => {
  await probeReady(worker);
  await networkSettled(worker);
  return worker.evaluate(async (vault) => {
    const probe = (
      self as unknown as {
        readonly qsbProbe: {
          readonly evaluatedAt: number;
          readonly fetched: string[];
          readonly runtime: {
            readonly publicProbe: () => Promise<unknown>;
            readonly setupFromCommitments: (
              commitments: readonly (readonly string[])[],
            ) => Promise<unknown>;
          };
        };
      }
    ).qsbProbe;
    const before = probe.fetched.length;
    const started = performance.now();
    const result =
      vault === null
        ? await probe.runtime.publicProbe()
        : await probe.runtime.setupFromCommitments(vault);
    return {
      evaluatedAt: probe.evaluatedAt,
      fetched: probe.fetched.slice(before),
      ms: performance.now() - started,
      result,
    };
  }, commitments);
};

const timedProbe = (worker: Worker): Promise<ProbeRun> => timedCall(worker, null);

const timedSetup = async (worker: Worker): Promise<VaultRun> =>
  (await timedCall(worker, QSB_TEST_VAULT_COMMITMENTS)) as VaultRun;

// The test vault's known answers: script hash, script length, public state.
const expectTestVault = (run: VaultRun): void => {
  expect(Object.keys(run.result).sort()).toEqual(["publicStateJson", "scriptHash", "scriptHex"]);
  expect(run.result.scriptHash).toBe(QSB_TEST_VAULT_SETUP.scriptHash);
  expect(run.result.scriptHex).toHaveLength(QSB_TEST_VAULT_SETUP.scriptBytes * 2);
  expect(createHash("sha256").update(run.result.publicStateJson).digest("hex")).toBe(
    QSB_TEST_VAULT_SETUP.publicStateSha256,
  );
};

const collectWorkerErrors = (extension: LoadedExtension): string[] => {
  const errors: string[] = [];
  extension.serviceWorker.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      errors.push(message.text());
    }
  });
  return errors;
};

const extensionPage = async (extension: LoadedExtension, path: string) => {
  const url = `chrome-extension://${extension.extensionId}/${path}`;
  const open = extension.context.pages().find((page) => page.url().startsWith(url));
  return open ?? extension.context.waitForEvent("page", (page) => page.url().startsWith(url));
};

const report = (label: string, ms: number): void => {
  const description = `${label}: ${Math.round(ms)} ms`;
  test.info().annotations.push({ description, type: "qsb-measurement" });
  console.log(`[qsb] ${description}`);
};

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
};

test("the pinned pipeline loads and runs in the wallet worker from packaged files only", async () => {
  test.setTimeout(120_000);
  await withProbeExtension(async (extension) => {
    const workerErrors = collectWorkerErrors(extension);
    // The install-time onboarding tab: the visible extension page a user would
    // have open (the side panel, in practice) when starting a QSB operation.
    await extensionPage(extension, "onboarding.html");

    const cold = await timedProbe(extension.serviceWorker);
    const warm = await timedProbe(extension.serviceWorker);

    expect(cold.result).toEqual(QSB_PUBLIC_PROBE_ANSWERS);
    expect(warm.result).toEqual(QSB_PUBLIC_PROBE_ANSWERS);
    const origin = `chrome-extension://${extension.extensionId}/`;
    expect(cold.fetched.filter((url) => !url.startsWith(origin))).toEqual([]);
    for (const file of PACKAGED_FILES) {
      expect(cold.fetched).toContain(`${origin}${file}`);
    }
    // The warm call reads nothing: one verified interpreter serves the worker.
    expect(warm.fetched).toEqual([]);
    expect(workerErrors).toEqual([]);

    report("worker module graph evaluated (fresh profile)", cold.evaluatedAt);
    report("cold Pyodide load + integrity check + pipeline import + probe", cold.ms);
    report("warm probe", warm.ms);
  });
});

test("the worker sets up the BIP test vault from its commitments to the known script hash", async () => {
  test.setTimeout(120_000);
  await withProbeExtension(async (extension) => {
    const workerErrors = collectWorkerErrors(extension);
    await extensionPage(extension, "onboarding.html");

    // Cold: the setup is this worker's first QSB call, so it boots Pyodide too.
    const cold = await timedSetup(extension.serviceWorker);
    const warm = await timedSetup(extension.serviceWorker);

    expectTestVault(cold);
    expectTestVault(warm);
    expect(warm.result).toEqual(cold.result);
    const origin = `chrome-extension://${extension.extensionId}/`;
    expect(cold.fetched.filter((url) => !url.startsWith(origin))).toEqual([]);
    for (const file of PACKAGED_FILES) {
      expect(cold.fetched).toContain(`${origin}${file}`);
    }
    // The warm call reads nothing: the verified interpreter serves it.
    expect(warm.fetched).toEqual([]);
    expect(workerErrors).toEqual([]);

    report("cold setupFromCommitments (Pyodide load + integrity check + setup)", cold.ms);
    report("warm setupFromCommitments", warm.ms);
  });
});

test("a worker restart drops the interpreter and the next call boots cold again", async () => {
  test.setTimeout(120_000);
  await withProbeExtension(async (extension) => {
    const page = await extensionPage(extension, "onboarding.html");
    const before = await timedProbe(extension.serviceWorker);
    expect(before.result).toEqual(QSB_PUBLIC_PROBE_ANSWERS);

    // DevTools' own "stop" for a worker: the same teardown as an idle timeout.
    // Chrome keeps the worker's target id across the restart, so the spec
    // marks the old global and waits for a worker that does not carry it.
    const cdp = await extension.context.newCDPSession(page);
    const statuses: { readonly runningStatus: string; readonly versionId: string }[] = [];
    cdp.on("ServiceWorker.workerVersionUpdated", ({ versions }) => {
      statuses.push(
        ...versions.filter((version) => version.scriptURL.endsWith(`/${PROBE_SCRIPT}`)),
      );
    });
    await cdp.send("ServiceWorker.enable");
    await expect.poll(() => statuses.at(-1)?.runningStatus).toBe("running");
    await extension.serviceWorker.evaluate(() => {
      (self as unknown as { qsbStoppedHere: boolean }).qsbStoppedHere = true;
    });
    await cdp.send("ServiceWorker.stopWorker", { versionId: statuses.at(-1)?.versionId ?? "" });
    await expect.poll(() => statuses.some((s) => s.runningStatus === "stopped")).toBe(true);
    await cdp
      .send("ServiceWorker.startWorker", {
        scopeURL: `chrome-extension://${extension.extensionId}/`,
      })
      .catch(() => undefined);
    const freshWorker = async (): Promise<Worker | undefined> => {
      for (const worker of extension.context.serviceWorkers()) {
        const fresh = await worker
          .evaluate(() => "qsbProbe" in self && !("qsbStoppedHere" in self))
          .catch(() => false);
        if (fresh && worker.url().endsWith(`/${PROBE_SCRIPT}`)) {
          return worker;
        }
      }
      return undefined;
    };
    await expect
      .poll(async () => (await freshWorker()) !== undefined, { timeout: 30_000 })
      .toBe(true);
    const restarted = await freshWorker();
    if (restarted === undefined) {
      throw new Error("the restarted wallet worker disappeared");
    }
    const after = await timedProbe(restarted);

    expect(after.result).toEqual(QSB_PUBLIC_PROBE_ANSWERS);
    // A fresh worker re-reads and re-verifies everything: nothing survived.
    expect(after.fetched).toEqual(before.fetched);
    report("cold Pyodide load after a worker restart (warm browser caches)", after.ms);
  });
});

test("with no extension page open the worker still completes, at background priority", async () => {
  test.setTimeout(180_000);
  await withProbeExtension(async (extension) => {
    const onboarding = await extensionPage(extension, "onboarding.html");
    await onboarding.close();
    const run = await timedProbe(extension.serviceWorker);
    expect(run.result).toEqual(QSB_PUBLIC_PROBE_ANSWERS);
    report("cold Pyodide load with no visible extension page", run.ms);
  });
});

test("measures what the static Pyodide import adds to each worker start", async () => {
  test.setTimeout(120_000);
  const startup = async (replacements: Readonly<Record<string, string>>): Promise<number> => {
    let evaluatedAt = Number.NaN;
    await withProbeExtension(async (extension) => {
      await probeReady(extension.serviceWorker);
      evaluatedAt = await extension.serviceWorker.evaluate(
        () =>
          (self as unknown as { readonly qsbProbe: { readonly evaluatedAt: number } }).qsbProbe
            .evaluatedAt,
      );
    }, replacements);
    return evaluatedAt;
  };
  const real: number[] = [];
  const stubbed: number[] = [];
  for (let round = 0; round < 3; round += 1) {
    real.push(await startup({}));
    stubbed.push(await startup(STUBBED_PYODIDE));
  }
  expect(real.every(Number.isFinite) && stubbed.every(Number.isFinite)).toBe(true);
  report("worker start, real Pyodide import (median of 3, fresh profiles)", median(real));
  report("worker start, stubbed Pyodide import (median of 3, fresh profiles)", median(stubbed));
});
