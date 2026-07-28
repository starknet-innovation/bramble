/**
 * Browser-level proof for the on-chain NFT animation trust boundary. Unit
 * tests validate the URI parser; these checks load the built manifest sandbox
 * in Chromium and verify the properties only the browser can enforce.
 */
import { createServer, type Server } from "node:http";
import { expect, test } from "./fixtures";

type ProbeServer = {
  readonly close: () => Promise<void>;
  readonly requests: () => number;
  readonly url: string;
};

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

const startProbeServer = async (): Promise<ProbeServer> => {
  let requestCount = 0;
  const server = createServer((_request, response) => {
    requestCount += 1;
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("unexpected network access");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("NFT sandbox probe did not receive a TCP address");
  }
  return {
    close: () => closeServer(server),
    requests: () => requestCount,
    url: `http://127.0.0.1:${address.port}/probe`,
  };
};

const animationUri = (probeUrl: string): string => {
  const html = `<!doctype html>
    <html>
      <body data-rendered="pending">
        <script>
          document.body.dataset.rendered = "yes";
          document.body.dataset.runtime = typeof globalThis.chrome?.runtime;
          document.body.dataset.storage = typeof globalThis.chrome?.storage;
          try {
            parent.document.body.dataset.sandboxBreach = "yes";
            document.body.dataset.parent = "allowed";
          } catch {
            document.body.dataset.parent = "blocked";
          }
          fetch(${JSON.stringify(probeUrl)}).then(
            () => { document.body.dataset.fetch = "allowed"; },
            () => { document.body.dataset.fetch = "blocked"; },
          );
          const image = new Image();
          image.onload = () => { document.body.dataset.image = "allowed"; };
          image.onerror = () => { document.body.dataset.image = "blocked"; };
          image.src = ${JSON.stringify(probeUrl)};
        </script>
      </body>
    </html>`;
  return `data:text/html;base64,${Buffer.from(html).toString("base64")}`;
};

test("confines an NFT animation to an isolated, egress-blocked sandbox", async ({ extension }) => {
  const probe = await startProbeServer();
  try {
    const uri = animationUri(probe.url);
    const sidepanel = await extension.openExtensionPage("sidepanel.html");
    const sandboxUrl = `chrome-extension://${extension.extensionId}/sandbox/render.html#${encodeURIComponent(uri)}`;
    await sidepanel.evaluate((url) => {
      const frame = document.createElement("iframe");
      frame.id = "nft-sandbox-probe";
      frame.src = url;
      document.body.append(frame);
    }, sandboxUrl);
    const body = sidepanel.frameLocator("#nft-sandbox-probe").locator("body");

    await expect(body).toHaveAttribute("data-rendered", "yes");
    await expect(body).toHaveAttribute("data-runtime", "undefined");
    await expect(body).toHaveAttribute("data-storage", "undefined");
    await expect(body).toHaveAttribute("data-parent", "blocked");
    await expect(sidepanel.locator("body")).not.toHaveAttribute("data-sandbox-breach", "yes");
    await expect(body).toHaveAttribute("data-fetch", "blocked");
    await expect(body).toHaveAttribute("data-image", "blocked");
    expect(probe.requests()).toBe(0);
  } finally {
    await probe.close();
  }
});

test("renders a static SVG data URI without scripts or remote subresources", async ({
  extension,
}) => {
  const probe = await startProbeServer();
  try {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2">
      <script>parent.document.body.dataset.svgScript = "ran"</script>
      <image href="${probe.url}" width="2" height="2"/>
      <rect width="2" height="2" fill="black"/>
    </svg>`;
    const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    const sidepanel = await extension.openExtensionPage("sidepanel.html");

    const loaded = await sidepanel.evaluate(
      (source) =>
        new Promise<boolean>((resolve) => {
          const image = new Image();
          image.onload = () => resolve(true);
          image.onerror = () => resolve(false);
          image.src = source;
          document.body.append(image);
        }),
      uri,
    );
    expect(loaded).toBe(true);
    await sidepanel.waitForTimeout(250);
    await expect(sidepanel.locator("body")).not.toHaveAttribute("data-svg-script", "ran");
    expect(probe.requests()).toBe(0);
  } finally {
    await probe.close();
  }
});

test("fails closed when the animation payload is malformed", async ({ extension }) => {
  const page = await extension.openExtensionPage(
    `sandbox/render.html#${encodeURIComponent("data:text/html;base64,%%%")}`,
  );

  await expect(page.getByText("This collectible's animation could not be rendered.")).toBeVisible();
});
