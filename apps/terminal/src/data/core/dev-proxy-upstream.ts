/**
 * Resolves a dev-server market-data proxy request onto its fixed upstream
 * (Sherlock 127). The remainder after the proxy prefix must be a path on the
 * upstream: one that starts with `//` or `/\` would be read by `new URL` as a
 * protocol-relative URL naming another host, so it is refused. URL parsing
 * also drops tabs and newlines, so `/\t/host` passes that test and still
 * names another host; the result is therefore checked to be on the upstream's
 * origin as well. Returns null for anything
 * that could leave it; the caller answers that with an error, never a fetch.
 */
export const devProxyUpstream = (path: string, prefix: string, target: string): URL | null => {
  if (!path.startsWith(prefix)) {
    return null;
  }
  const rest = path.slice(prefix.length);
  if (!/^\/(?![/\\])/.test(rest)) {
    return null;
  }
  const base = new URL(target);
  const upstream = new URL(rest, base);
  return upstream.origin === base.origin ? upstream : null;
};
