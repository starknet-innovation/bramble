/** Sanitized, local-only support diagnostics for trusted extension pages. */

import type { WalletPreferencesStore } from "@mc-wallet/settings/preferences";
import { type RpcDiagnosticRow, rpcDiagnosticsSnapshot } from "@mc-wallet/starknet/rpc-diagnostics";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import { statusResponse } from "../runtime/runtime-state";
import type { UnlockSession } from "../runtime/session";

/** Identifier-free diagnostic report a user may download and choose to share. */
type SupportDiagnostics = {
  readonly accountCount: number;
  readonly collectionEnabled: boolean;
  readonly hasVault: boolean;
  readonly locked: boolean;
  readonly networkId: string;
  readonly ready: boolean;
  readonly rpc: readonly RpcDiagnosticRow[];
};

/** Successful diagnostic response returned only to a trusted extension page. */
export type SupportDiagnosticsResponse = {
  readonly diagnostics: SupportDiagnostics;
  readonly ok: true;
};

/** Builds a report without addresses, origins, hashes, calldata, URLs, or raw errors. */
export const supportDiagnosticsResponse = async (
  wallet: WalletStatusReader,
  session: UnlockSession,
  preferencesStore: WalletPreferencesStore,
): Promise<SupportDiagnosticsResponse> => {
  const [status, preferences] = await Promise.all([
    statusResponse(wallet, session, preferencesStore),
    preferencesStore.read(),
  ]);
  return {
    diagnostics: {
      accountCount: status.accountCount,
      collectionEnabled: preferences.reliabilityDiagnostics ?? false,
      hasVault: status.hasVault,
      locked: status.locked,
      networkId: status.networkId,
      ready: status.ready,
      rpc: rpcDiagnosticsSnapshot(),
    },
    ok: true,
  };
};
