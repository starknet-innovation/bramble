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
    close: () => {
      const closing = closeServer(server);
      server.closeAllConnections();
      return closing;
    },
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
          setTimeout(() => {
            window.location.assign(${JSON.stringify(probeUrl)});
          }, 1_000);
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
    await sidepanel.waitForTimeout(1_250);
    expect(probe.requests()).toBe(0);
  } finally {
    await probe.close();
  }
});

test("runs an animation through the embedding iframe sandbox", async ({ extension }) => {
  const parentOrigin = `chrome-extension://${extension.extensionId}`;
  const html = `<!doctype html><html><body><script>
    parent.postMessage({
      marker: "mc-nft-sandbox-ready",
      runtime: typeof globalThis.chrome?.runtime,
    }, ${JSON.stringify(parentOrigin)});
  </script></body></html>`;
  const uri = `data:text/html;base64,${Buffer.from(html).toString("base64")}`;
  const sidepanel = await extension.openExtensionPage("sidepanel.html");
  const sandboxUrl = `chrome-extension://${extension.extensionId}/sandbox/render.html#${encodeURIComponent(uri)}`;

  const result = await sidepanel.evaluate(
    (url) =>
      new Promise<{ readonly runtime: string }>((resolve, reject) => {
        const frame = document.createElement("iframe");
        frame.sandbox.add("allow-scripts");
        frame.referrerPolicy = "no-referrer";
        const timeout = window.setTimeout(() => {
          window.removeEventListener("message", onMessage);
          frame.remove();
          reject(new Error("sandbox animation did not start"));
        }, 5_000);
        const onMessage = (event: MessageEvent<unknown>): void => {
          if (
            event.source !== frame.contentWindow ||
            typeof event.data !== "object" ||
            event.data === null ||
            (event.data as { marker?: unknown }).marker !== "mc-nft-sandbox-ready"
          ) {
            return;
          }
          window.clearTimeout(timeout);
          window.removeEventListener("message", onMessage);
          const runtime = (event.data as { runtime?: unknown }).runtime;
          frame.remove();
          resolve({ runtime: typeof runtime === "string" ? runtime : "invalid" });
        };
        window.addEventListener("message", onMessage);
        frame.src = url;
        document.body.append(frame);
      }),
    sandboxUrl,
  );

  expect(result.runtime).toBe("undefined");
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
