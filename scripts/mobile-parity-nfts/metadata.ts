/**
 * The metadata blocks: `metadata` (`resolveNftMetadataUri` over a URI and a recording HTTP
 * transport: data URIs decoded locally, https and IPFS fetched under the request options
 * recorded, every field normalised, and each refusal, null) and `image` (`normalizeImageUrl`,
 * `normalizeAnimationUri` and `normalizeNftHttpsUrl` alone, every input beside its output).
 */
import {
  normalizeAnimationUri,
  normalizeImageUrl,
  normalizeNftHttpsUrl,
} from "@bramble/portfolio/nft-metadata";
import { resolveNftMetadataUri } from "@bramble/portfolio/nft-token-metadata";
import { type HttpExchange, type HttpReply, plain, recordingHttp, thrownMessage } from "./shared";

const json = (value: unknown) => JSON.stringify(value);
const base64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const HTML = "<html><body><canvas></canvas></body></html>";
const SVG = "<svg xmlns='http://www.w3.org/2000/svg'><rect width='1' height='1'/></svg>";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==";

const FULL = {
  animation_url: `data:text/html;base64,${base64(HTML)}`,
  attributes: [
    { trait_type: "Eyes", value: "Laser" },
    { display_type: "number", trait_type: "Level", value: 5 },
    { trait_type: "Rare", value: true },
    { trait_type: "", value: "dropped" },
    { trait_type: "Null", value: null },
    "not a record",
  ],
  collection: { name: "Punks" },
  description: "  A punk.  ",
  external_url: "https://punks.example/7",
  image: "ipfs://bafybeigdyrzt/7.png",
  name: "Punk #7",
};

type MetadataCase = {
  readonly name: string;
  readonly uri: string;
  readonly reply?: HttpReply;
};

const META_CASES: readonly MetadataCase[] = [
  {
    name: "data: JSON, percent-encoded",
    uri: `data:application/json,${encodeURIComponent(json(FULL))}`,
  },
  { name: "data: JSON, base64", uri: `data:application/json;base64,${base64(json(FULL))}` },
  {
    name: "data: JSON, utf-8 base64, mixed-case header",
    uri: `DATA:Application/JSON;Charset=UTF-8;Base64,${base64(json({ name: "Ünï" }))}`,
  },
  {
    name: "data: JSON, utf-8 percent-encoded",
    uri: `data:application/json;charset=utf-8,${encodeURIComponent(json({ name: "x" }))}`,
  },
  { name: "data: another media type", uri: `data:text/plain,${encodeURIComponent(json(FULL))}` },
  { name: "data: no comma", uri: "data:application/json" },
  { name: "data: bad base64", uri: "data:application/json;base64,%%%" },
  { name: "data: bad percent-encoding", uri: "data:application/json,%E0%A4%A" },
  {
    name: "data: decoded past 32 KiB",
    uri: `data:application/json;base64,${base64(json({ name: "x", pad: "y".repeat(32_768) }))}`,
  },
  {
    name: "data: JSON that is not an object",
    uri: `data:application/json,${encodeURIComponent("[1]")}`,
  },
  {
    name: "data: an object with nothing usable",
    uri: `data:application/json,${encodeURIComponent(json({ name: 7 }))}`,
  },
  { name: "data: malformed JSON", uri: "data:application/json,%7Bname" },
  {
    name: "data: fields clamped",
    uri: `data:application/json,${encodeURIComponent(
      json({
        attributes: Array.from({ length: 40 }, (_, n) => ({ trait_type: `t${n}`, value: n })),
        collection: "  Flat collection  ",
        description: "d".repeat(1_100),
        name: "n".repeat(140),
      }),
    )}`,
  },
  {
    name: "data: art variants",
    uri: `data:application/json,${encodeURIComponent(
      json({
        animation_url: "https://anim.example/7.html",
        external_url: "http://punks.example",
        image: `data:image/svg+xml;utf8,${SVG}`,
        name: "svg",
      }),
    )}`,
  },
  {
    name: "data: raster image and raw html animation",
    uri: `data:application/json,${encodeURIComponent(
      json({
        animation_url: `data:text/html,${encodeURIComponent(HTML)}`,
        image: `data:image/png;base64,${PNG}`,
      }),
    )}`,
  },
  {
    name: "data: refused image and animation types",
    uri: `data:application/json,${encodeURIComponent(
      json({
        animation_url: `data:image/svg+xml,${SVG}`,
        image: `data:text/html;base64,${base64(HTML)}`,
        name: "refused art",
      }),
    )}`,
  },
  { name: "a URI past 32 KiB", uri: `https://meta.example/${"a".repeat(32_768)}` },
  { name: "https", reply: { body: FULL }, uri: "https://meta.example/7.json" },
  {
    name: "ipfs through the gateway",
    reply: { body: { name: "ipfs" } },
    uri: "ipfs://bafy/7.json",
  },
  {
    name: "ipfs://ipfs/ through the gateway",
    reply: { body: { name: "ipfs" } },
    uri: "ipfs://ipfs/bafy/7.json",
  },
  { name: "plain http is refused", uri: "http://meta.example/7.json" },
  { name: "localhost is refused", uri: "https://localhost/7.json" },
  { name: "a private IPv4 is refused", uri: "https://192.168.1.10/7.json" },
  { name: "an IPv6 literal is refused", uri: "https://[::1]/7.json" },
  { name: "credentials are refused", uri: "https://user:pass@meta.example/7.json" },
  { name: "a .local host is refused", uri: "https://nas.local/7.json" },
  { name: "another scheme is refused", uri: "ar://abc" },
  { name: "an HTTP error", reply: { body: {}, status: 404 }, uri: "https://meta.example/7.json" },
  {
    name: "a response from another (http) URL",
    reply: { body: { name: "moved" }, url: "http://meta.example/7.json" },
    uri: "https://meta.example/7.json",
  },
  {
    name: "a declared body past 64 KiB",
    reply: { body: { name: "big" }, headers: { "content-length": "65537" } },
    uri: "https://meta.example/7.json",
  },
  {
    name: "a body past 64 KiB",
    reply: { body: { name: "big", pad: "p".repeat(65_536) } },
    uri: "https://meta.example/7.json",
  },
  {
    name: "a body that is not JSON",
    reply: { body: "<html>", raw: true },
    uri: "https://meta.example/7.json",
  },
  { name: "a transport failure", reply: "transport", uri: "https://meta.example/7.json" },
];

/** The `metadata` block. */
export const computeMetadata = async () => {
  const cases = [];
  for (const one of META_CASES) {
    const exchanges: HttpExchange[] = [];
    const http = recordingHttp(() => one.reply ?? "transport", exchanges);
    const result = await resolveNftMetadataUri(one.uri, http).catch((error: unknown) => ({
      error: thrownMessage(error),
    }));
    cases.push({ exchanges, name: one.name, result: plain(result), uri: one.uri });
  }
  return cases;
};

const IMAGES: readonly unknown[] = [
  "https://img.example/7.png",
  "  https://img.example/7.png  ",
  "https://IMG.example/a b.png",
  "http://img.example/7.png",
  "ipfs://bafy/7.png",
  "ipfs://ipfs/bafy/7.png",
  "ipfs://",
  "ipfs://ipfs/",
  "https://localhost/7.png",
  "https://app.localhost/7.png",
  "https://nas.local/7.png",
  "https://10.0.0.1/7.png",
  "https://172.16.0.1/7.png",
  "https://172.32.0.1/7.png",
  "https://169.254.1.1/7.png",
  "https://127.0.0.1/7.png",
  "https://0.0.0.0/7.png",
  "https://224.0.0.1/7.png",
  "https://8.8.8.8/7.png",
  "https://[::1]/7.png",
  "https://u:p@img.example/7.png",
  `https://img.example/${"a".repeat(2_048)}`,
  `https://img.example/${"a".repeat(2_000)}`,
  "javascript:alert(1)",
  `data:image/svg+xml,${SVG}`,
  `data:image/svg+xml;base64,${base64(SVG)}`,
  `data:image/png;base64,${PNG}`,
  `data:IMAGE/PNG;BASE64,${PNG}`,
  "data:image/png,rawbytes",
  "data:image/png;base64,",
  "data:image/png;base64,not base64!",
  "data:image/bmp;base64,Qk0=",
  `data:text/html;base64,${base64(HTML)}`,
  `data:image/png;base64,${"A".repeat(32_768)}`,
  "",
  7,
  null,
];

const ANIMATIONS: readonly unknown[] = [
  `data:text/html;base64,${base64(HTML)}`,
  `data:text/html,${encodeURIComponent(HTML)}`,
  `data:TEXT/HTML;charset=utf-8,${HTML}`,
  "data:text/html;base64,not base64!",
  "data:text/html,",
  "data:text/html",
  `data:image/svg+xml,${SVG}`,
  "https://anim.example/7.html",
  "ipfs://bafy/7.html",
  `data:text/html,${"a".repeat(32_768)}`,
  7,
];

const LINKS: readonly unknown[] = [
  "https://punks.example/7",
  " https://punks.example/7 ",
  "http://punks.example/7",
  "https://localhost/",
  "ipfs://bafy",
  "mailto:a@b.example",
  null,
];

/** The `image` block: one case per normaliser, every input beside its output. */
export const computeImages = () => [
  {
    name: "normalizeImageUrl",
    pairs: IMAGES.map((input) => ({ input, output: normalizeImageUrl(input) })),
  },
  {
    name: "normalizeAnimationUri",
    pairs: ANIMATIONS.map((input) => ({ input, output: normalizeAnimationUri(input) })),
  },
  {
    name: "normalizeNftHttpsUrl",
    pairs: LINKS.map((input) => ({ input, output: normalizeNftHttpsUrl(input) })),
  },
];
