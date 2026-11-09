/** Declares the website's public, build-time environment variables. */
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHROME_STORE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
