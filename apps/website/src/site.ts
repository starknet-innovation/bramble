/** Resolves public website configuration without exposing wallet or extension state. */
import { resolveChromeStoreUrl } from "./lib/site-links";

/** A validated external Chrome Web Store destination with a safe store-root fallback. */
export const chromeStoreUrl = resolveChromeStoreUrl(import.meta.env.VITE_CHROME_STORE_URL);
