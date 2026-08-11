/**
 * Shared network-service URL policy: HTTPS anywhere, HTTP only on loopback.
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

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
