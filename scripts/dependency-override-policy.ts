/**
 * The reviewed security pins for transitive dependencies used by build/terminal tooling, held in
 * `package.json` `overrides`. Each is the first release without the advisory it closes.
 */
import { isDeepStrictEqual } from "node:util";

// source-map-js (postcss via vite, jsdom, web-ext's addons-linter, and madge):
// 1.2.2 is the first release without GHSA-68fv-2mgg-jv7q. sharp (wrangler/miniflare):
// 0.35.5 is the first release without GHSA-wq5f-xc86-pv6w. shell-quote (web-ext via
// fx-runner, which pins 1.10.0): 1.11.0 is the first release without GHSA-pqg4-j6r4-53mv.
// moment (terminal private-swap route via @avnu/avnu-sdk ^2.30.1): 2.31.0 is the first
// release without GHSA-4p3w-j4w9-5jqw (moderate, so the high-level audit gate would not
// catch it). happy-dom (vitest optional peer and @happy-dom/global-registrator): 21.0.4
// is the first release without GHSA-834v-8h66-3h79. vite (vitest, Storybook, Vite plugins;
// ^8 ranges had kept 8.2.2): 8.3.3, the direct pin, is the first 8.3 release without
// GHSA-587h-7wmj-h5pm. zod (starknet, @avnu/avnu-sdk, knip; ^4 ranges): 4.6.6 is the
// first release without GHSA-mrhx-c7xc-m3w5. undici (miniflare exact 7.29.1; also jsdom's
// already-patched ^8.10.2): 7.30.1 is the first 7.x without GHSA-xjj6-f33q-929c. An 8.x
// pin would move miniflare off 7.x. Drop it once miniflare no longer pins 7.29.1.
const REVIEWED_OVERRIDES = {
  "happy-dom": "21.0.4",
  moment: "2.31.0",
  qs: "6.16.0",
  sharp: "0.35.5",
  "shell-quote": "1.11.0",
  "source-map-js": "1.2.2",
  undici: "7.30.1",
  vite: "8.3.3",
  zod: "4.6.6",
} as const;

/**
 * Failures when `package.json` `overrides` is anything but exactly the reviewed pins: a missing,
 * extra, or changed entry fails, so a new override cannot land without review here.
 */
export const dependencyOverrideFailures = (overrides: unknown): string[] =>
  isDeepStrictEqual(overrides, REVIEWED_OVERRIDES)
    ? []
    : ["package.json must retain the reviewed security overrides"];
