/**
 * Boots the installed Pyodide in Bun for the QSB gate (`check:qsb`) and the
 * QSB runtime's known-answer unit test, configured as the worker configures
 * it: no JavaScript globals for Python's `import js`, and output discarded.
 *
 * The loader is imported by path — the very `pyodide.mjs` `check:qsb`
 * digest-checks, not whatever the package's export map resolves — and only
 * when called, so the gate can verify the bytes first. It is narrowed like
 * the worker's own type shim, since the package's declarations need
 * Emscripten's globals. Rejects if the file no longer exports `loadPyodide`.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { QsbInterpreter } from "../apps/extension/src/background/qsb/qsb-runtime";

/** Loads Pyodide from the package directory `pyodideRoot`, offline. */
export const loadPinnedPyodide = async (pyodideRoot: string): Promise<QsbInterpreter> => {
  const root = resolve(pyodideRoot);
  const loader = (await import(pathToFileURL(resolve(root, "pyodide.mjs")).href)) as {
    readonly loadPyodide?: unknown;
  };
  if (typeof loader.loadPyodide !== "function") {
    throw new Error("Pyodide runtime no longer exports loadPyodide");
  }
  const loadPyodide = loader.loadPyodide as (options: {
    readonly indexURL: string;
    readonly jsglobals: object;
    readonly stderr: (line: string) => void;
    readonly stdout: (line: string) => void;
  }) => Promise<QsbInterpreter>;
  return loadPyodide({
    indexURL: `${root}/`,
    jsglobals: Object.create(null),
    stderr: () => undefined,
    stdout: () => undefined,
  });
};
