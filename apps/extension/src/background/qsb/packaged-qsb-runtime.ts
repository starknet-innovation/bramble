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
 * Nothing here runs until a caller asks: the runtime is lazy, and no wallet
 * message, page, or account reaches it.
 */
import "/dependencies/pyodide/pyodide.asm.js";
import { loadPyodide } from "/dependencies/pyodide/pyodide.mjs";
import { resolveExtensionApi } from "../../extension-api";
import type { BackgroundBrowser } from "../runtime/background-browser";
import { createQsbRuntime, type QsbRuntime, refuseRipemd160 } from "./qsb-runtime";

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
 * The worker's QSB runtime (spike). Lazy and unreachable from every extension
 * message; `scripts/check-qsb-runtime.ts` pins the packaged files it reads.
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
  ripemd160: refuseRipemd160,
});
