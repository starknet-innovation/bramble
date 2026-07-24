const BASE_URL =
  typeof import.meta.env?.BASE_URL === "string" && import.meta.env.BASE_URL.length > 0
    ? import.meta.env.BASE_URL
    : "/";

/**
 * Resolves a directory under Vite's public asset base. Non-browser validation
 * scripts fall back to the root base rather than depending on Vite globals.
 */
export const publicAssetRoot = (directory: string): string =>
  `${BASE_URL.replace(/\/?$/, "/")}${directory.replace(/^\/+|\/+$/g, "")}`;
