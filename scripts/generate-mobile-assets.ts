/**
 * Writes the mobile wallet's generated design tokens and network catalog. Run after changing a
 * skin, a scale token, or the bundled networks: `bun run mobile:assets`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { readMobileAssetSources, renderMobileAssets } from "./mobile-assets";

const written = renderMobileAssets(await readMobileAssetSources());
for (const [path, content] of written) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
console.log(`wrote ${written.size} generated mobile files`);
