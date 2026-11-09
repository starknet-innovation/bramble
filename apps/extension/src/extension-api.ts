/**
 * The one place the extension reads its browser API object off the global
 * scope.
 *
 * Firefox implements the WebExtension APIs as promise-returning functions under
 * `browser`, and keeps `chrome` only as a callback-style compatibility alias.
 * Every adapter in this extension awaits its browser calls, so on Firefox
 * reading `chrome` would hand back functions whose results resolve to
 * `undefined` — storage would read empty, and a wallet that reads an empty
 * vault looks to the user like a wallet that lost their accounts. Chrome has
 * exposed `browser` as an alias of `chrome` since 148 and `chrome` alone before
 * that, so preferring `browser` is correct on both and changes nothing about
 * which implementation Chromium runs.
 *
 * The caller names the shape it needs, exactly as each composition root already
 * did against `globalThis.chrome`; this module only decides *which* global
 * object that shape is read from. It returns `undefined` outside an extension
 * page — tests and UI Lab both run there — so callers keep their existing
 * "no browser API available" branch.
 */

/**
 * Resolves the extension API object, preferring Firefox's promise-based
 * `browser` namespace over the `chrome` alias. `Api` is the structural slice
 * the caller uses; nothing here validates that the runtime actually provides
 * it, so callers must keep treating every member as optional.
 */
export const resolveExtensionApi = <Api>(): Api | undefined => {
  const scope = globalThis as typeof globalThis & {
    readonly browser?: Api;
    readonly chrome?: Api;
  };
  return scope.browser ?? scope.chrome;
};
