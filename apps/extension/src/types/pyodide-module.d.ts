/**
 * Structural type shims for the packaged Pyodide 0.29.3 runtime statically
 * imported by the MV3 worker. A module service worker cannot `import()` or
 * `importScripts`, so the Emscripten loader is imported for its side effect
 * (it defines the global `_createPyodideModule`, which `loadPyodide` then uses
 * instead of loading the script itself). The surface is kept to the options and
 * interpreter members the QSB adapter uses; `scripts/check-qsb-runtime.ts` pins
 * the files these declarations describe.
 */
declare module "*pyodide.asm.js" {}

declare module "*pyodide.mjs" {
  export const loadPyodide: (options: {
    readonly indexURL: string;
    readonly jsglobals: object;
    readonly stderr: (line: string) => void;
    readonly stdout: (line: string) => void;
  }) => Promise<{
    readonly FS: { readonly writeFile: (path: string, data: Uint8Array) => void };
    readonly registerJsModule: (name: string, module: object) => void;
    readonly runPythonAsync: (code: string) => Promise<unknown>;
  }>;
}
