/**
 * Worker-start composition for remote feature flags: builds the client from
 * the production collaborators and arms its refresh, so the background entry
 * point wires the whole feature with one call.
 *
 * Fails closed: if local storage cannot be opened, the router gets the
 * bundled-defaults reader and nothing is fetched.
 */
import { untrustedFetch } from "@bramble/core/http-json";
import type { KeyValueStore } from "@bramble/store/kv";
import { systemClock } from "@bramble/transactions/activity";
import type { AlarmsApi } from "../transactions/tx-monitor";
import { startFeatureFlagRefresh } from "./feature-flag-alarm";
import {
  bundledFeatureFlags,
  createFeatureFlagClient,
  type FeatureFlagReader,
} from "./feature-flag-client";
import { drawInstallBucket } from "./install-bucket";

/** The slice of the extension API this composition reads. */
type FeatureFlagBrowser = {
  readonly alarms?: AlarmsApi;
  readonly runtime?: { readonly getManifest?: () => { readonly version?: unknown } };
};

/**
 * Creates the flag client and starts its startup and periodic refresh.
 * `ready` gates network work on storage lockdown; `createStore` is the
 * entry point's local-storage adapter factory.
 */
export const startFeatureFlags = (
  browser: FeatureFlagBrowser | undefined,
  ready: Promise<void>,
  createStore: () => KeyValueStore,
): FeatureFlagReader => {
  let store: KeyValueStore;
  try {
    store = createStore();
  } catch {
    return bundledFeatureFlags;
  }
  const version = browser?.runtime?.getManifest?.().version;
  const client = createFeatureFlagClient({
    drawBucket: drawInstallBucket,
    fetch: untrustedFetch,
    now: systemClock,
    store,
    version: typeof version === "string" ? version : null,
  });
  startFeatureFlagRefresh({ alarms: browser?.alarms, client, ready });
  return client;
};
