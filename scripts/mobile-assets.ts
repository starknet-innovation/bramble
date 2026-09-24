/**
 * Renders the mobile wallet's generated sources from the single-sourced TypeScript design system
 * and network catalog. The native apps and the Rust core never restate a colour, a scale step, an
 * icon, a chain id, or a token address by hand: they read the files this module renders, and
 * `tests/conformance/mobile-generated.test.ts` fails when a committed copy drifts from it.
 *
 * Rendering is pure; the only input read from disk is the side-panel stylesheet source the derived
 * colours are declared in (`readMobileAssetSources`). Elevation tiers, press scales, and layout
 * metrics are read from the rendered stylesheet constant (`SIDEPANEL_STYLES`). `scripts/generate-mobile-assets.ts` writes.
 */
import { readFile } from "node:fs/promises";
import { knownTokensForNetwork } from "@bramble/portfolio/token-registry";
import { BRAMBLE_MARK_PATH, BRAMBLE_MARK_VIEW_BOX } from "@bramble/ui-kit/brand-mark";
import { DEFAULT_TOKENS, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { SIDEPANEL_STYLES } from "../packages/presentation/wallet-ui/src/sidepanel/styles/index";
import { ACCOUNTS_JSON_PATH, renderAccountsCatalog } from "./mobile-assets/accounts";
import { renderAndroidTokenLogos } from "./mobile-assets/android-token-logos";
import { DERIVED_COLOR_SOURCES, parseDerivedColors } from "./mobile-assets/colors";
import { parseCss } from "./mobile-assets/css";
import { TOAST_SOURCE } from "./mobile-assets/feedback";
import { renderKotlin } from "./mobile-assets/kotlin";
import { MULTISIG_JSON_PATH, renderMultisigConstants } from "./mobile-assets/multisig";
import { RPC_FIXTURES_PATH, renderRpcFixtures } from "./mobile-assets/rpc-fixtures";
import { renderKotlinCopy, renderPolicyJson, renderSwiftCopy } from "./mobile-assets/security-copy";
import { HEADER } from "./mobile-assets/shared";
import { renderSwift, renderSwiftLayout } from "./mobile-assets/swift";
import { renderVectorAssets, tokenLogoAddresses } from "./mobile-assets/vectors";

/** Repository-relative path of the Swift design tokens consumed by the iOS app. */
export const SWIFT_TOKENS_PATH = "mobile/ios/Bramble/DesignSystem/BrambleTokens.generated.swift";
/** Repository-relative path of the Swift per-component layout read from the stylesheet. */
export const SWIFT_LAYOUT_PATH = "mobile/ios/Bramble/DesignSystem/BrambleLayout.generated.swift";
/** Repository-relative path of the Kotlin design tokens consumed by the Android app. */
export const KOTLIN_TOKENS_PATH =
  "mobile/android/app/src/main/java/org/bramble/wallet/design/BrambleTokens.generated.kt";
/** Repository-relative directory of the iOS brand-mark vector asset. */
export const IOS_MARK_DIR = "mobile/ios/Bramble/Resources/Assets.xcassets/BrandMark.imageset";
/** Repository-relative path of the Android brand-mark vector drawable. */
export const ANDROID_MARK_PATH = "mobile/android/app/src/main/res/drawable/brand_mark.xml";
/** Repository-relative path of the network catalog the Rust core embeds at compile time. */
export const NETWORKS_JSON_PATH = "mobile/core/generated/networks.json";
/** Repository-relative path of the security policy the Rust core asserts against. */
export const POLICY_JSON_PATH = "mobile/core/generated/policy.json";
/** Repository-relative path of the iOS security copy table. */
export const SWIFT_COPY_PATH = "mobile/ios/Bramble/DesignSystem/BrambleCopy.generated.swift";
/** Repository-relative path of the Android security copy table. */
export const KOTLIN_COPY_PATH =
  "mobile/android/app/src/main/java/org/bramble/wallet/design/BrambleCopy.generated.kt";
/** Repository-relative path of the token registry and bundled-logo set the Rust core embeds. */
export const TOKEN_REGISTRY_JSON_PATH = "mobile/core/generated/token-registry.json";

const MOBILE_NETWORK_IDS = ["SN_MAIN", "SN_SEPOLIA"] as const;

/**
 * Reads the source files rendering needs from disk: the stylesheet sources the derived colours are
 * declared in, then the toast implementation (`TOAST_SOURCE`), in that order.
 */
export const readMobileAssetSources = async (): Promise<readonly string[]> =>
  Promise.all([...DERIVED_COLOR_SOURCES, TOAST_SOURCE].map((path) => readFile(path, "utf8")));

const renderNetworks = (): string => {
  const networks = MOBILE_NETWORK_IDS.map((id) => ({
    chainId: STARKNET_NETWORKS[id].chainId,
    explorerBaseUrl: STARKNET_NETWORKS[id].explorerBaseUrl,
    id,
    name: STARKNET_NETWORKS[id].name,
    rpcUrls: STARKNET_NETWORKS[id].rpcUrls,
    tokens: DEFAULT_TOKENS.filter((token) => token.networkId === id).map((token) => ({
      address: token.address,
      decimals: token.decimals,
      name: token.name,
      symbol: token.symbol,
    })),
  }));
  return `${JSON.stringify({ generatedBy: HEADER, networks }, null, 2)}\n`;
};

// The curated discovery registry (`knownTokensForNetwork`, ids stripped: the core derives them
// through its own `tokenConfigId` port) and the addresses that ship a bundled logo.
const renderTokenRegistry = (): string => {
  const tokens = MOBILE_NETWORK_IDS.flatMap((id) =>
    knownTokensForNetwork(id).map((token) => ({
      address: token.address,
      decimals: token.decimals,
      name: token.name,
      networkId: token.networkId,
      symbol: token.symbol,
    })),
  );
  return `${JSON.stringify({ generatedBy: HEADER, logos: tokenLogoAddresses(), tokens }, null, 2)}\n`;
};

const markSize = (): readonly [string, string] => {
  const [, , width, height] = BRAMBLE_MARK_VIEW_BOX.split(" ");
  if (!width || !height) {
    throw new Error("Brand mark view box must be four numbers");
  }
  return [width, height];
};

const renderMarkSvg = (): string => {
  const [width, height] = markSize();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${BRAMBLE_MARK_VIEW_BOX}"><title>Bramble</title><path fill="#000000" d="${BRAMBLE_MARK_PATH}"/></svg>\n`;
};

// Template rendering: the platform tints the mark with the skin's text colour, as
// `currentColor` does in the extension.
const renderMarkContents = (): string =>
  `${JSON.stringify(
    {
      images: [{ filename: "mark.svg", idiom: "universal" }],
      info: { author: "xcode", version: 1 },
      properties: {
        "preserves-vector-representation": true,
        "template-rendering-intent": "template",
      },
    },
    null,
    2,
  )}\n`;

const renderMarkDrawable = (): string => {
  const [width, height] = markSize();
  return [
    `<!-- ${HEADER} -->`,
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
    `    android:width="${width}dp"`,
    `    android:height="${height}dp"`,
    `    android:viewportWidth="${width}"`,
    `    android:viewportHeight="${height}">`,
    "    <path",
    '        android:fillColor="#FF000000"',
    `        android:pathData="${BRAMBLE_MARK_PATH}" />`,
    "</vector>",
    "",
  ].join("\n");
};

/**
 * Every generated mobile source keyed by repository-relative path. Throws when a token no
 * longer has a shape the native platforms can express, rather than emitting a lossy value.
 */
export const renderMobileAssets = (sources: readonly string[]): ReadonlyMap<string, string> => {
  const mixes = parseDerivedColors(sources.slice(0, DERIVED_COLOR_SOURCES.length));
  const toastSource = sources[DERIVED_COLOR_SOURCES.length];
  if (toastSource === undefined) {
    throw new Error(`Missing ${TOAST_SOURCE}; read sources with readMobileAssetSources`);
  }
  const rules = parseCss(SIDEPANEL_STYLES);
  return new Map([
    [SWIFT_TOKENS_PATH, renderSwift(mixes, rules)],
    [SWIFT_LAYOUT_PATH, renderSwiftLayout(rules, toastSource)],
    [KOTLIN_TOKENS_PATH, renderKotlin(mixes)],
    [NETWORKS_JSON_PATH, renderNetworks()],
    [POLICY_JSON_PATH, renderPolicyJson()],
    [SWIFT_COPY_PATH, renderSwiftCopy()],
    [KOTLIN_COPY_PATH, renderKotlinCopy()],
    [RPC_FIXTURES_PATH, renderRpcFixtures()],
    [ACCOUNTS_JSON_PATH, renderAccountsCatalog()],
    [MULTISIG_JSON_PATH, renderMultisigConstants()],
    [TOKEN_REGISTRY_JSON_PATH, renderTokenRegistry()],
    [`${IOS_MARK_DIR}/mark.svg`, renderMarkSvg()],
    [`${IOS_MARK_DIR}/Contents.json`, renderMarkContents()],
    [ANDROID_MARK_PATH, renderMarkDrawable()],
    ...renderVectorAssets(),
    ...renderAndroidTokenLogos(),
  ]);
};
