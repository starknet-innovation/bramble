/**
 * The browser API surface the background entrypoint expects, assembled from
 * the slices each background module declares for itself. Kept as types only:
 * the entrypoint resolves the live API through `resolveExtensionApi`, and
 * every member is optional so a runtime missing one degrades that feature
 * rather than failing to boot. Split from `./index` so the entrypoint stays a
 * wiring list.
 */

import type { DataConsentPermissions } from "../analytics/data-consent";
import type { ApprovalSurfaceBrowser } from "../approvals/approval-surface";
import type { OnboardingSurfaceBrowser } from "../onboarding/onboarding-surface";
import type { RuntimeSender } from "../routing/senders";
import type { AlarmsApi } from "../transactions/tx-monitor";
import type { SessionAlarmsApi } from "./session-expiry-alarm";
import type { UpdateRuntime } from "./update-ready";

type RuntimeApi = UpdateRuntime & {
  readonly getManifest?: () => { readonly version?: string };
  readonly getPlatformInfo?: () => Promise<unknown>;
  readonly getURL?: (path: string) => string;
  readonly id: string;
  readonly onInstalled: {
    readonly addListener: (listener: (details: { readonly reason?: string }) => void) => void;
  };
  readonly onMessage: {
    readonly addListener: (
      listener: (
        message: unknown,
        sender: RuntimeSender,
        sendResponse: (response: unknown) => void,
      ) => true,
    ) => void;
  };
  readonly sendMessage?: (message: unknown) => Promise<unknown>;
};

// Two alarm consumers, one API: recurring reconciliation cadences
// (./transactions/tx-monitor) and the one-shot unlock deadline
// (./privacy/session-expiry-alarm).
type AlarmsGlobal = { readonly alarms?: AlarmsApi & SessionAlarmsApi };

type TabsApi = {
  readonly query: (
    queryInfo: Record<string, never>,
  ) => Promise<readonly { readonly id?: number }[]>;
  readonly sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
};

/**
 * Everything the entrypoint reads from the extension API, each member absent
 * where the browser does not provide it.
 */
export type BackgroundBrowser = ApprovalSurfaceBrowser &
  OnboardingSurfaceBrowser &
  AlarmsGlobal & {
    readonly permissions?: DataConsentPermissions;
    readonly runtime?: RuntimeApi;
    readonly tabs?: TabsApi;
  };
