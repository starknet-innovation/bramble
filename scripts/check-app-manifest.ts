/**
 * Dev-only admission check for the app directory (mc-wallet issue 749): fetches
 * each listed app's `/.well-known/starknet-app.json` from its own origin and
 * compares it with the bundled entry. Run by a maintainer reviewing a listing
 * PR (`bun run scripts/check-app-manifest.ts [app-id]`); never shipped, never in
 * `bun run check`, because CI must not depend on applicants' sites being up.
 * The schema half of admission runs in the test suite instead.
 */

import { LISTED_APPS } from "../packages/features/permissions/src/app-directory-data";
import type { ListedApp } from "../packages/features/permissions/src/app-directory-types";
import {
  APP_MANIFEST_PATH,
  appManifestMismatches,
} from "../packages/features/permissions/src/app-manifest";
import {
  HTTP_REQUEST_TIMEOUT_MS,
  readBoundedText,
  UNTRUSTED_REQUEST_INIT,
} from "../packages/foundation/core/src/http-json";

type CheckFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// A manifest names one app; anything near this size is not one.
const MAX_MANIFEST_BYTES = 64 * 1024;

/** One app's result: its id, and the mismatches or fetch failure found. */
export type AppManifestCheck = {
  readonly id: string;
  readonly problems: readonly string[];
};

/** Fetches one app's manifest without credentials or redirects, and compares it. */
export const checkAppManifest = async (
  app: ListedApp,
  options: { readonly fetch?: CheckFetch; readonly timeoutMs?: number } = {},
): Promise<AppManifestCheck> => {
  const deadline = AbortSignal.timeout(options.timeoutMs ?? HTTP_REQUEST_TIMEOUT_MS);
  try {
    const response = await (options.fetch ?? fetch)(`${app.origin}${APP_MANIFEST_PATH}`, {
      ...UNTRUSTED_REQUEST_INIT,
      signal: deadline,
    });
    if (!response.ok)
      return { id: app.id, problems: [`manifest answered HTTP ${response.status}`] };
    const body: unknown = JSON.parse(await readBoundedText(response, MAX_MANIFEST_BYTES, deadline));
    return { id: app.id, problems: appManifestMismatches(app, body) };
  } catch (error) {
    return {
      id: app.id,
      problems: [
        error instanceof SyntaxError ? "manifest is not JSON" : "manifest could not be fetched",
      ],
    };
  }
};

if (import.meta.main) {
  const only = process.argv[2];
  const apps = only === undefined ? LISTED_APPS : LISTED_APPS.filter((app) => app.id === only);
  if (only !== undefined && apps.length === 0) {
    console.error(`no listed app has id ${only}`);
    process.exitCode = 1;
  }
  for (const app of apps) {
    const result = await checkAppManifest(app);
    console.log(
      `${result.id}: ${result.problems.length === 0 ? "ok" : result.problems.join("; ")}`,
    );
    if (result.problems.length > 0) process.exitCode = 1;
  }
}
