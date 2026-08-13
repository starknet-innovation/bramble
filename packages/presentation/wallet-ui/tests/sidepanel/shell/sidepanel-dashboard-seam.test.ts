/**
 * Integration-seam checks for the v0.5 umbrella merge. `dashboard()`'s two
 * trailing positional parameters were each appended by a different v0.5 feature
 * during the integration — `classHashVerification` (from class-hash verify,
 * #110) and `historyUnavailable` (from the on-chain activity feed, #111) — and
 * the merge kept both, ordered `classHashVerification` then `historyUnavailable`
 * in the signature and at the sole call site (`index.ts`). The leaf renderers
 * (`classHashVerificationBadge`, `homeTabs`, `activityScreen`) are unit-tested
 * elsewhere; these drive the FULL positional signature so a regression in the
 * call-site ordering, or a screen dropping / mis-routing its trailing argument,
 * is caught end-to-end rather than only where the leaf is exercised directly.
 *
 * The class-hash verification type is taken from `dashboard`'s own parameter
 * list (`Parameters<typeof dashboard>[24]`) rather than imported from
 * `starknet/class-hash-verify` directly: it keeps the seam objects bound to the
 * exact type `dashboard` accepts, and avoids a second module-resolver entry into
 * that subtree (the same subtree the pre-existing `biome check` bug trips on).
 */
import { describe, expect, test } from "bun:test";
import { account, preferences, secondAccount } from "@mc-wallet/testkit/sidepanel";
import type { WalletStatus } from "../../../src/popup/responses/responses";
import { dashboard, type WalletView } from "../../../src/sidepanel/app/screens/views";

// The class-hash verification shape `dashboard` accepts at its 25th positional
// parameter (0-indexed 24), non-null — i.e. a resolved ClassHashVerification.
type SeamVerification = NonNullable<Parameters<typeof dashboard>[24]>;

const status: WalletStatus = {
  accountCount: 2,
  accounts: [account, secondAccount],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [
    { id: "SN_MAIN", name: "Starknet Mainnet" },
    { id: "SN_SEPOLIA", name: "Starknet Sepolia" },
  ],
  ready: true,
};

// Renders through the REAL positional `dashboard()` signature, defaulting every
// argument up to the merge seam and overriding only the two trailing params the
// integration threaded in. Passing the full positional tail (not a shortcut) is
// the point: it exercises the exact ordering the manual conflict resolution
// produced, mirroring how `index.ts`'s `paint()` calls it.
const renderSeam = (
  view: WalletView,
  seam: {
    readonly classHashVerification?: SeamVerification | null;
    readonly historyUnavailable?: boolean;
  },
): string =>
  dashboard(
    view,
    status,
    [], // pending
    preferences,
    { balances: [] }, // balances
    null, // deployment
    [], // transactions
    [], // connectedSites
    {}, // prices
    [], // chart
    null, // selectedTokenId
    [], // allowances
    null, // selectedNftId
    {}, // changes
    [], // multisigs
    [], // multisigIntents
    null, // selectedMultisigId
    null, // multisigClassDeclared
    null, // drawerGroupFilter
    null, // expandedGroupId
    false, // priceStale
    null, // priceAsOf
    [], // discoveredNfts
    null, // openAssignId
    seam.classHashVerification ?? null,
    seam.historyUnavailable ?? false,
  );

const VERIFIED: SeamVerification = {
  onChainClassHash: account.classHash,
  status: "verified",
};
const MISMATCH: SeamVerification = {
  expectedClassHash: account.classHash,
  onChainClassHash: "0x5234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  status: "mismatch",
};

describe("dashboard umbrella-merge seam", () => {
  test("threads historyUnavailable through to the Activity screen notice", () => {
    const degraded = renderSeam("activity", { historyUnavailable: true });
    expect(degraded).toContain("load on-chain history");
    expect(degraded).toContain("No transactions recorded on this device yet.");

    const reachable = renderSeam("activity", { historyUnavailable: false });
    expect(reachable).not.toContain("load on-chain history");
  });

  test("keeps activity history state out of Home while preserving the Activity destination", () => {
    const degradedHome = renderSeam("home", { historyUnavailable: true });
    expect(degradedHome).not.toContain("On-chain history unavailable");
    expect(degradedHome).toMatch(/class="nav-item" data-view="activity"/);

    const reachableHome = renderSeam("home", { historyUnavailable: false });
    expect(reachableHome).not.toContain("On-chain history unavailable");
  });

  test("threads the class-hash verification through to the account flow badge", () => {
    const verified = renderSeam("account", { classHashVerification: VERIFIED });
    expect(verified).toContain("verify-status verified");
    expect(verified).toContain("Verified on-chain");

    const mismatch = renderSeam("account", { classHashVerification: MISMATCH });
    expect(mismatch).toContain("verify-status mismatch");
    expect(mismatch).toContain("On-chain mismatch");

    // null is the honest still-loading state — never a silent verified badge.
    const pending = renderSeam("account", { classHashVerification: null });
    expect(pending).toContain("verify-status pending");
    expect(pending).not.toContain("Verified on-chain");
  });

  test("routes the two seam params to distinct screens (no cross-contamination)", () => {
    // A swap or mis-route of the trailing pair would surface the wrong artifact
    // on the wrong screen. The account flow must show the verification badge but
    // never the activity history notice, even when historyUnavailable is set.
    const accountView = renderSeam("account", {
      classHashVerification: VERIFIED,
      historyUnavailable: true,
    });
    expect(accountView).toContain("Verified on-chain");
    expect(accountView).not.toContain("load on-chain history");

    // The activity screen must show the history notice but never the
    // verification badge, even when a verification result is threaded in.
    const activityView = renderSeam("activity", {
      classHashVerification: VERIFIED,
      historyUnavailable: true,
    });
    expect(activityView).toContain("load on-chain history");
    expect(activityView).not.toContain("verify-status verified");
  });
});
