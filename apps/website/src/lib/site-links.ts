/** Owns validation for external destinations reached from the public website. */

/** The published Bramble extension listing — the default download destination. */
export const CHROME_STORE_LISTING =
  "https://chromewebstore.google.com/detail/bramble-starknet-wallet/jcfafpefcpcejehepoednnollpeenpop";

/** Safe fallback when a configured override is invalid or missing. */
export const CHROME_STORE_ROOT = "https://chromewebstore.google.com/";

/** Public source and support destination for Bramble. */
export const REPOSITORY_URL = "https://github.com/starknet-innovation/bramble";

/** Accepts only an HTTPS Chrome Web Store URL and otherwise fails to the store root. */
export const resolveChromeStoreUrl = (configuredUrl: string | undefined): string => {
  if (configuredUrl === undefined) {
    return CHROME_STORE_LISTING;
  }

  try {
    const url = new URL(configuredUrl);
    return url.protocol === "https:" && url.hostname === "chromewebstore.google.com"
      ? url.toString()
      : CHROME_STORE_ROOT;
  } catch {
    return CHROME_STORE_ROOT;
  }
};

/** Creates a bounded public issue URL and appends an explicit secret-material warning. */
export const createSupportIssueUrl = (question: string): string => {
  const value = question.trim().slice(0, 2_000);
  const url = new URL(`${REPOSITORY_URL}/issues/new`);
  url.searchParams.set("title", value === "" ? "Bramble support question" : value.slice(0, 120));
  url.searchParams.set(
    "body",
    value === ""
      ? "What do you need help with?\n\nPlease do not include recovery phrases, private keys, passwords, or other secret material."
      : `${value}\n\n---\nPlease do not include recovery phrases, private keys, passwords, or other secret material.`,
  );
  return url.toString();
};
