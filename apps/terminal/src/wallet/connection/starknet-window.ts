/**
 * Types + discovery helpers for the injected Starknet wallet provider.
 *
 * The terminal is a dApp: it talks to the Bramble browser extension through
 * the wallet's injected `window.starknet_bramble` provider (a standard
 * Starknet Wallet API object). We prefer that provider specifically, but
 * fall back to any other injected Starknet wallet so the terminal is usable for
 * development against Argent/Braavos too.
 */
/**
 * Minimal injected-wallet shape consumed by the Terminal. Keeping this
 * structural avoids bundling wallet catalogs or dynamic module loaders into the
 * browser while preserving the standard Starknet Wallet API boundary.
 */
export type StarknetWindowObject = {
  readonly account?: unknown;
  readonly chainId?: string;
  readonly disconnect?: () => Promise<void> | void;
  readonly enable?: (options?: unknown) => Promise<unknown>;
  readonly id: string;
  readonly isPreauthorized?: () => Promise<boolean>;
  readonly name?: string;
  readonly off: (event: string, listener: (...args: never[]) => void) => void;
  readonly on: (event: string, listener: (...args: never[]) => void) => void;
  readonly request?: unknown;
  readonly selectedAddress?: string;
  readonly version?: string;
};

/**
 * The window key the Bramble extension injects its provider under.
 */
const BRAMBLE_WINDOW_KEY = "starknet_bramble" as const;

/**
 * Substring used to recognise the Bramble among discovered providers when the
 * exact injected key is unavailable.
 */
const BRAMBLE_NAME_MATCH = /bramble/i;

type StarknetWindow = Window & {
  readonly [BRAMBLE_WINDOW_KEY]?: StarknetWindowObject;
};

/**
 * How often, and for how long, we poll `window` for a wallet provider before
 * giving up. Browser extensions inject their provider asynchronously after the
 * page's first paint, so a synchronous read on click frequently loses the race
 * and returns nothing — which is why "Connect" sometimes did not prompt at all.
 */
const INJECTION_POLL_INTERVAL_MS = 50 as const;
export const INJECTION_TIMEOUT_MS = 3000 as const;

/**
 * Reads the Bramble provider directly off the window, if the extension has
 * injected it. Returns null in SSR or when the extension is absent.
 */
const readInjectedBramble = (): StarknetWindowObject | null => {
  if (typeof window === "undefined") {
    return null;
  }
  return (window as StarknetWindow)[BRAMBLE_WINDOW_KEY] ?? null;
};

/**
 * Picks the Bramble from a list of discovered providers, matching first on the
 * canonical id, then on a name substring. Returns null when none match.
 */
const pickBramble = (wallets: readonly StarknetWindowObject[]): StarknetWindowObject | null =>
  wallets.find(
    (wallet) => wallet.id === "bramble" || BRAMBLE_NAME_MATCH.test(wallet.name ?? ""),
  ) ?? null;

/**
 * Structural check that an arbitrary window value is a Starknet provider. We
 * accept either the modern `request` API or the legacy `enable` method so both
 * current and older wallets (and the test double) are recognised.
 */
const isStarknetWindowObject = (value: unknown): value is StarknetWindowObject => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.on === "function" &&
    typeof candidate.off === "function" &&
    (typeof candidate.request === "function" || typeof candidate.enable === "function")
  );
};

/**
 * Scans `window` for every injected Starknet provider (`starknet`,
 * `starknet_bramble`, `starknet_argentX`, `starknet_braavos`, ...). Used as a
 * development fallback so the terminal works against any wallet, not only Bramble.
 */
const scanInjectedStarknetWallets = (): readonly StarknetWindowObject[] => {
  if (typeof window === "undefined") {
    return [];
  }
  const found: StarknetWindowObject[] = [];
  for (const key of Object.keys(window)) {
    if (!key.startsWith("starknet")) {
      continue;
    }
    const candidate = (window as unknown as Record<string, unknown>)[key];
    if (isStarknetWindowObject(candidate) && !found.includes(candidate)) {
      found.push(candidate);
    }
  }
  return found;
};

/**
 * Resolves the injected Bramble provider, waiting for the extension to inject
 * it rather than reading `window` once. Resolves as soon as the provider
 * appears; on timeout, falls back to any injected Starknet provider (dev). This
 * fixes the "clicking Connect does nothing" race where the click beat injection.
 */
export const waitForInjectedBramble = async (
  timeoutMs: number = INJECTION_TIMEOUT_MS,
): Promise<StarknetWindowObject | null> => {
  const immediate = readInjectedBramble();
  if (immediate !== null) {
    return immediate;
  }
  if (typeof window === "undefined") {
    return null;
  }
  return new Promise<StarknetWindowObject | null>((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const interval = window.setInterval(() => {
      const bramble = readInjectedBramble();
      if (bramble !== null) {
        window.clearInterval(interval);
        resolve(bramble);
        return;
      }
      if (Date.now() >= deadline) {
        window.clearInterval(interval);
        const scanned = scanInjectedStarknetWallets();
        resolve(pickBramble(scanned) ?? scanned[0] ?? null);
      }
    }, INJECTION_POLL_INTERVAL_MS);
  });
};
