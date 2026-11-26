/**
 * Writes the mobile wallet's generated design tokens, network catalog and in-app browser script.
 * Run after changing a skin, a scale token, the bundled networks or the in-page provider:
 * `bun run mobile:assets`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { readMobileAssetSources, renderMobileAssets } from "./mobile-assets";
import { MOBILE_PROVIDER_PATH, renderMobileProvider } from "./mobile-assets/provider";

const written = new Map(renderMobileAssets(await readMobileAssetSources()));
written.set(MOBILE_PROVIDER_PATH, await renderMobileProvider());
for (const [path, content] of written) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
console.log(`wrote ${written.size} generated mobile files`);
