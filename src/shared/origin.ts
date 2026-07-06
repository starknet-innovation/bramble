/**
 * Shared wallet origin policy for dapp requests and persisted grants.
 */
const LOCAL_HTTP_HOSTS = new Set(["127.0.0.1", "localhost"]);

/**
 * Checks whether an origin is safe to persist as a wallet permission grant.
 */
export const isWalletOrigin = (origin: string): boolean => {
  try {
    const url = new URL(origin);
    return (
      url.origin === origin &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && LOCAL_HTTP_HOSTS.has(url.hostname)))
    );
  } catch {
    return false;
  }
};

/**
 * Normalizes untrusted URL-like input to an allowed wallet origin.
 */
export const normalizeWalletOrigin = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.username || url.password) {
      return null;
    }
    return isWalletOrigin(url.origin) ? url.origin : null;
  } catch {
    return null;
  }
};
