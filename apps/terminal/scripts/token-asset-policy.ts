/**
 * Acceptance rules for third-party token artwork pulled into the terminal's
 * same-origin asset packs by the sync scripts. The token lists and CDNs that
 * name and serve the artwork are untrusted: a logo URL may point anywhere, and
 * an SVG is a document that can carry script. Everything here fails closed — a
 * rejected asset is skipped and the UI falls back to the ticker glyph.
 */

/**
 * The largest SVG kept, in UTF-16 code units. The committed pack's largest
 * file is just under 2 MB; anything bigger is skipped rather than shipped.
 */
export const MAX_SVG_LENGTH = 2_097_152;

/** Redirect hops a logo download may follow, each re-checked by {@link safeLogoUrl}. */
export const MAX_LOGO_REDIRECTS = 3;

const COINGECKO_THUMBNAIL =
  /^(https:\/\/assets\.coingecko\.com\/coins\/images\/\d+)\/(?:small|standard)\//;

// Hostnames that name this machine or its private network rather than a
// public asset host. A logo URL from a token list has no reason to use one.
const isLocalHostname = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    !host.includes(".") ||
    /^\d+(?:\.\d+){3}$/.test(host) ||
    host.includes(":")
  );
};

/**
 * Parses a token list's logo URI (Sherlock 142). Returns the URL to fetch —
 * CoinGecko thumbnails upgraded to their 250 px form — or null unless it is a
 * plain `https:` URL on the default port, with no credentials, naming a public
 * hostname rather than an IP literal or a local name.
 */
export const safeLogoUrl = (uri: string): URL | null => {
  let url: URL;
  try {
    url = new URL(uri.replace(COINGECKO_THUMBNAIL, "$1/large/"));
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    isLocalHostname(url.hostname)
  ) {
    return null;
  }
  return url;
};

/**
 * Fetches a logo, following at most {@link MAX_LOGO_REDIRECTS} redirects by
 * hand so every hop passes {@link safeLogoUrl}, not only the first (Sherlock
 * 142). Resolves to the final non-redirect response, or to a reason string
 * when a hop is refused; transport errors reject.
 */
export const fetchLogo = async (
  fetcher: (url: URL, init: RequestInit) => Promise<Response>,
  first: URL,
  init: RequestInit,
): Promise<Response | string> => {
  let url = first;
  for (let hop = 0; hop <= MAX_LOGO_REDIRECTS; hop += 1) {
    const response = await fetcher(url, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) {
      return response;
    }
    const location = response.headers.get("location");
    let next: URL | null = null;
    try {
      next = location === null ? null : safeLogoUrl(new URL(location, url).href);
    } catch {
      next = null;
    }
    if (next === null) {
      return "redirect to a refused URL";
    }
    url = next;
  }
  return "too many redirects";
};

const SVG_ELEMENTS = new Set([
  "circle",
  "clippath",
  "defs",
  "desc",
  "ellipse",
  "feblend",
  "fecolormatrix",
  "fecomposite",
  "feflood",
  "fegaussianblur",
  "femerge",
  "femergenode",
  "feoffset",
  "filter",
  "g",
  "image",
  "line",
  "lineargradient",
  "mask",
  "path",
  "pattern",
  "polygon",
  "polyline",
  "radialgradient",
  "rect",
  "stop",
  "svg",
  "symbol",
  "title",
  "use",
]);

const SVG_ATTRIBUTES = new Set([
  "clip-path",
  "clip-rule",
  "clippathunits",
  "color-interpolation-filters",
  "cx",
  "cy",
  "d",
  "dx",
  "dy",
  "fill",
  "fill-opacity",
  "fill-rule",
  "filter",
  "filterunits",
  "flood-color",
  "flood-opacity",
  "fx",
  "fy",
  "gradienttransform",
  "gradientunits",
  "height",
  "href",
  "id",
  "in",
  "in2",
  "mask",
  "maskcontentunits",
  "maskunits",
  "mode",
  "offset",
  "opacity",
  "operator",
  "patterncontentunits",
  "patterntransform",
  "patternunits",
  "points",
  "preserveaspectratio",
  "r",
  "result",
  "rx",
  "ry",
  "spreadmethod",
  "stddeviation",
  "stop-color",
  "stop-opacity",
  "stroke",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
  "style",
  "transform",
  "type",
  "values",
  "version",
  "viewbox",
  "width",
  "x",
  "x1",
  "x2",
  "xlink:href",
  "xml:space",
  "xmlns",
  "xmlns:xlink",
  "y",
  "y1",
  "y2",
]);

const NAMESPACES = new Set(["http://www.w3.org/2000/svg", "http://www.w3.org/1999/xlink"]);
const LOCAL_OR_INLINE_HREF = /^(?:#[\w.-]+|data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+)$/;
const TAG = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTRIBUTE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const XML_DECLARATION = /^<\?xml\s[^?<>]*\?>\s*/;

// Values may reference only fragments in this document: url(#id), never a
// stylesheet, script or remote resource, and carry no character escapes that
// could spell one out.
const isSafeValue = (name: string, value: string): boolean => {
  const lower = value.toLowerCase();
  if (
    value.includes("&") ||
    value.includes("\\") ||
    lower.includes("javascript:") ||
    lower.includes("expression(") ||
    lower.includes("@import") ||
    /url\(\s*(?!["']?#)/.test(lower)
  ) {
    return false;
  }
  if (name === "href" || name === "xlink:href") {
    return LOCAL_OR_INLINE_HREF.test(value);
  }
  if (name === "xmlns" || name === "xmlns:xlink") {
    return NAMESPACES.has(value);
  }
  return true;
};

const hasSafeAttributes = (source: string): boolean => {
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = (match[1] ?? "").toLowerCase();
    const value = match[2] ?? match[3] ?? "";
    if (!SVG_ATTRIBUTES.has(name) || !isSafeValue(name, value)) {
      return false;
    }
  }
  return true;
};

/**
 * Accepts an SVG only when every element and attribute is on a fixed list of
 * drawing primitives (Sherlock 143). Event handlers, script and foreign
 * content in any namespace, external references, entities and markup
 * declarations are all refused, as is text outside the recognised tags, so no
 * construct the list does not name can reach the asset pack. Oversized
 * documents are refused too.
 */
export const isSafeSvg = (document: string): boolean => {
  if (document.length > MAX_SVG_LENGTH) {
    return false;
  }
  const body = document.trim().replace(XML_DECLARATION, "");
  if (!body.toLowerCase().startsWith("<svg") || body.includes("<!") || body.includes("<?")) {
    return false;
  }
  let tags = 0;
  for (const match of body.matchAll(TAG)) {
    tags += 1;
    if (!SVG_ELEMENTS.has((match[2] ?? "").toLowerCase()) || !hasSafeAttributes(match[3] ?? "")) {
      return false;
    }
  }
  // Every "<" must open a tag the pattern above checked; anything else is
  // markup this check did not read. Text between tags (titles) carries no
  // entity escapes either.
  const opened = body.split("<").length - 1;
  const text = body.replace(TAG, "");
  return tags > 0 && opened === tags && !text.includes("&") && !text.includes(">");
};
