/**
 * Shared network-service URL policy: HTTPS anywhere, HTTP only on loopback.
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

/**
 * Removes trailing URL separators in linear time without a backtracking regex.
 */
export const trimTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return value.slice(0, end);
};

/**
 * Checks a user-configured service endpoint without performing network access.
 */
export const isServiceUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      url.username === "" &&
      url.password === "" &&
      (url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)))
    );
  } catch {
    return false;
  }
};
