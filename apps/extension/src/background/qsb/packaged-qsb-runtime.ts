/**
 * Worker wiring for the QSB runtime spike: Pyodide 0.29.3 and the pinned QSB
 * pipeline sources, every byte read from this extension's own package.
 *
 * A module service worker may not `import()` (the HTML specification forbids it
 * on `ServiceWorkerGlobalScope`) and `importScripts` throws in module workers,
 * so Pyodide's own loader cannot fetch `pyodide.asm.js` here. The Emscripten
 * module is therefore imported statically for its side effect: it defines
 * the global `_createPyodideModule`, and `loadPyodide` uses that instead of
 * loading the script. Everything else Pyodide reads (`pyodide.asm.wasm`,
 * `python_stdlib.zip`, `pyodide-lock.json`) is fetched from `indexURL`, which is
 * the packaged `dependencies/pyodide/` directory — never a CDN.
 *
 * HASH160 needs RIPEMD-160, which Pyodide's `hashlib` lacks; it is the pinned
 * `@noble/hashes` implementation qsb-app wires, bundled into this worker. Only
 * its legacy-hash module and the helpers that module imports are bundled.
 *
 * Nothing here runs until a caller asks: the runtime is lazy, and only the QSB
 * vault flows reach it, with commitments Krusty derived.
 */
import "/dependencies/pyodide/pyodide.asm.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { loadPyodide } from "/dependencies/pyodide/pyodide.mjs";
import { resolveExtensionApi } from "../../extension-api";
import type { BackgroundBrowser } from "../runtime/background-browser";
import { createQsbRuntime, type QsbRuntime } from "./qsb-runtime";

const runtime = resolveExtensionApi<BackgroundBrowser>()?.runtime;

const packagedUrl = (path: string): string => {
  const url = runtime?.getURL?.(path);
  if (url === undefined) {
    throw new Error("QSB runtime cannot resolve the extension package URL");
  }
  return url;
};

// The pipeline prints progress; production wallet code never logs.
const ignorePythonOutput = (): void => undefined;

/**
 * The worker's QSB runtime. Lazy: it boots on the first QSB vault or withdrawal
 * message that needs it; only `setupFromCommitments`, `prepare` and `finish`
 * are reachable from one, and `finish` drops its interpreter afterwards;
 * `scripts/check-qsb-runtime.ts` pins the packaged files it reads.
 */
export const qsbRuntime: QsbRuntime = createQsbRuntime({
  loadInterpreter: () =>
    loadPyodide({
      indexURL: packagedUrl("dependencies/pyodide/"),
      // The pipeline needs no JavaScript globals. An empty object keeps Python's
      // `import js` from reaching this worker's `fetch` and `chrome.*` APIs.
      jsglobals: Object.create(null),
      stderr: ignorePythonOutput,
      stdout: ignorePythonOutput,
    }),
  readFile: async (file) => {
    const response = await fetch(packagedUrl(`vendor/qsb/${file}`));
    if (!response.ok) {
      throw new Error("QSB runtime cannot read a packaged file");
    }
    return new Uint8Array(await response.arrayBuffer());
  },
  ripemd160,
});
