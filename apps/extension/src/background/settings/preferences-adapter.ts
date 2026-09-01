/** Fail-closed adapter for the asynchronously initialized preferences store. */

import type {
  ApprovalSurfacePreference,
  WalletPreferencesStore,
} from "@mc-wallet/settings/preferences";

type PreferencesAdapterOptions = {
  readonly onApprovalSurface: (preference: ApprovalSurfacePreference) => void;
  readonly onProductAnalytics: (enabled: boolean) => void;
  readonly onReliabilityDiagnostics: (enabled: boolean) => void;
  readonly store: Promise<WalletPreferencesStore | null>;
};

/**
 * Exposes the complete preferences capability while initialization is pending.
 * Every operation fails closed when trusted browser storage is unavailable.
 */
export const createBackgroundPreferences = ({
  onApprovalSurface,
  onProductAnalytics,
  onReliabilityDiagnostics,
  store,
}: PreferencesAdapterOptions): WalletPreferencesStore => {
  const required = async (): Promise<WalletPreferencesStore> => {
    const resolved = await store;
    if (!resolved) throw new Error("preferences unavailable");
    return resolved;
  };
  return {
    addCustomNetwork: async (input) => (await required()).addCustomNetwork(input),
    addNft: async (input) => (await required()).addNft(input),
    createGroup: async (input) => (await required()).createGroup(input),
    async importPreferences(input) {
      const next = await (await required()).importPreferences(input);
      onApprovalSurface(next.approvalSurface ?? "side-panel");
      onProductAnalytics(next.productAnalytics ?? true);
      onReliabilityDiagnostics(next.reliabilityDiagnostics ?? false);
      return next;
    },
    read: async () => (await required()).read(),
    removeAddress: async (input) => (await required()).removeAddress(input),
    removeGroup: async (input) => (await required()).removeGroup(input),
    removeNft: async (input) => (await required()).removeNft(input),
    renameGroup: async (input) => (await required()).renameGroup(input),
    saveAddress: async (input) => (await required()).saveAddress(input),
    setAccountInGroup: async (input) => (await required()).setAccountInGroup(input),
    setAccountLabel: async (input) => (await required()).setAccountLabel(input),
    setActiveNetwork: async (input) => (await required()).setActiveNetwork(input),
    async setDisplay(input) {
      const next = await (await required()).setDisplay(input);
      if (input.approvalSurface !== undefined) onApprovalSurface(input.approvalSurface);
      if (input.productAnalytics !== undefined) onProductAnalytics(input.productAnalytics);
      if (input.reliabilityDiagnostics !== undefined) {
        onReliabilityDiagnostics(input.reliabilityDiagnostics);
      }
      return next;
    },
    // The explorer read lane is a disclosure decision (MCW-V09-129), so it is
    // delegated through the same fail-closed gate: with storage unavailable the
    // choice is refused rather than recorded against a half-built store.
    setExplorerFallback: async (input) => (await required()).setExplorerFallback(input),
    setGroupIcon: async (input) => (await required()).setGroupIcon(input),
    setNftIndexerUrl: async (input) => (await required()).setNftIndexerUrl(input),
    setNostrRelayUrl: async (input) => (await required()).setNostrRelayUrl(input),
    setNftSpam: async (input) => (await required()).setNftSpam(input),
    setRpcOverride: async (input) => (await required()).setRpcOverride(input),
    setStrk20NetworkConfig: async (input) => (await required()).setStrk20NetworkConfig(input),
    setTokenHidden: async (input) => (await required()).setTokenHidden(input),
    upsertToken: async (input) => (await required()).upsertToken(input),
  };
};
