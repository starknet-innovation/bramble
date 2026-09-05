# Bramble website

Static public website for Bramble, the Starknet browser-extension wallet.

```bash
bun run --filter @mc-wallet/website dev
bun run --filter @mc-wallet/website check
```

The Vite build writes `apps/website/dist/` with real `/`, `/docs/`, `/support/`, and `/privacy/`
entry documents. Set `VITE_CHROME_STORE_URL` to the exact Bramble listing URL before deployment.
Until that URL is configured, download links lead to the Chrome Web Store root instead of guessing
an item identifier.

## Deployment

The site is served from the Cloudflare Worker `bramble`, configured by `wrangler.jsonc` in this
directory (assets-only, no server-side code, `workers.dev` and preview URLs disabled).
`.github/workflows/website-deploy.yml` deploys it on every push to the active release branch that
touches `apps/website/`, and on manual dispatch. Pull requests never deploy; they are checked by
`check:workspaces` in the main CI workflow.

The public hostname is `bramble.fi`. `bramble.money` was retired and is deliberately not declared
in `wrangler.jsonc`, which is what stops a deploy re-attaching it.

`bramble.fi` is registered through AWS Route 53, but a Workers custom domain requires the zone to be
served by **Cloudflare DNS**. The domain's nameservers therefore point at Cloudflare, not Route 53,
which stays the registrar only. A deploy fails at the domain-attach step while the zone is served
anywhere else, so the DNS move has to land before the first deploy on a new hostname.

### Configuration that lives outside this repository

Three things the deploy depends on are Cloudflare or GitHub settings, so no diff here shows them
changing. They are listed so a failure points somewhere rather than nowhere.

- **`bramble-production` environment** (GitHub) — holds `CLOUDFLARE_API_TOKEN` and a
  deployment-branch policy naming the active release branch. A job from any other ref is refused
  before it starts, which is the control that actually stops an unreviewed revision reaching the
  credential; the ref guard in the workflow is only an early, clearer failure.
- **Apex has no A or CNAME record.** Attaching the custom domain creates that record itself, and a
  pre-existing one on the apex blocks the attach.
- **`www` redirects to the apex** rather than serving the site. `www` is a proxied placeholder record
  with a Cloudflare Redirect Rule issuing a 301 to `bramble.fi`, preserving path and query. It is
  deliberately not a second Worker custom domain: two hostnames serving identical content give the
  site two canonical origins, which splits search indexing and widens the set of addresses a
  lookalike domain can imitate. The redirect is an edge rule so no server-side code is added — this
  Worker stays assets-only, with nothing executing on a wallet domain.
- **Security headers ship from `public/_headers`**, which Cloudflare Workers parses out of the
  deployed asset directory. `Strict-Transport-Security` and `X-Content-Type-Options` are the
  exception: those are set at the Cloudflare edge under SSL/TLS, so the file deliberately omits them
  rather than emitting each header from two sources. `src/lib/security-headers.test.ts` guards the
  file, because a plain text file with a typo in a directive name loses protection without failing
  anything.
- **The Content-Security-Policy is enforcing**, and same-origin throughout: `default-src`,
  `script-src`, `style-src`, `font-src` and `connect-src` are all `'self'`, `img-src` adds `data:`
  because Vite inlines assets below its size threshold, and `object-src`, `worker-src`,
  `manifest-src`, `frame-ancestors` and `base-uri` are `'none'`. There is no report-only header;
  carrying both would emit the same policy twice and make it ambiguous which one an edit changes.

  It shipped report-only first and was promoted only after its violations were read from a browser
  console on `/`, `/docs/`, `/support/` and `/privacy/`. **Anything added that loads from a new
  origin — an analytics script, an embedded video, a CDN webfont — is now blocked rather than
  reported.** Add the origin to the matching directive in the same change, and re-verify in a
  browser.

  `form-action` is `'self'` rather than `'none'`: the support page's form has no `action`
  attribute, so without JavaScript it submits to the current document, and `'none'` would block
  that path.

  One diagnostic worth knowing before reading a failure into it. Seven of the eight images measure
  as broken when the page is loaded in a browser that never renders it, because all but the first
  are `loading="lazy"` and the intersection observer never fires. That is not a CSP block: a
  blocked image reports `complete: true` with `naturalWidth: 0` **and** logs a violation, whereas a
  lazy image that never started reports `complete: false` and logs nothing. Do not loosen
  `img-src` on the strength of that measurement.
- **The deploy token needs two policies, not one.** `Account -> Workers Scripts -> Edit` uploads the
  assets, and `Zone -> Workers Routes -> Edit` is also required because `wrangler deploy` reconciles
  routes on **every** run against the zone-scoped `/zones/{zone}/workers/routes` endpoint, whether or
  not the route needs changing. Remove the zone policy and the failure is not clean: the asset
  upload succeeds first and only the route step fails, so the site updates while the run goes red.
  A pipeline that half-works is the kind people learn to ignore, so this is worth keeping.
- **Cloudflare's managed `robots.txt` and Content Signals Policy must stay off.** Both merge
  generated content into the served file, which produced two conflicting `User-agent: *` groups and
  meant editing the repository file could not fully control what crawlers saw. They are disabled
  under Security -> Settings (Bot traffic) and Control AI Crawlers on the zone overview. **If the
  served `robots.txt` ever stops matching `public/robots.txt`, check those two settings before
  anything else** — re-enabling either silently overrides the file in this repository.
- **Mail is denied, not merely absent.** A null `MX` (`.` at priority 0), `v=spf1 -all`, and a DMARC
  `p=reject` record are published even though the domain sends and receives no mail. Those records
  stop forged mail claiming to come from the wallet's domain, which is a phishing route that exists
  whether or not a mailbox does.

The workflow needs one secret, `CLOUDFLARE_API_TOKEN`, in the `bramble-production` GitHub
environment: a Cloudflare token with Account → Workers Scripts → Edit only. The account id is
public and lives in the workflow file.

To deploy by hand from an authenticated shell, run the same commands the workflow does:

```bash
bun run --filter @mc-wallet/website check
bun run --filter @mc-wallet/website deploy
```

Keep `name` in `wrangler.jsonc` as `bramble`: a different name deploys a new Worker and leaves the
live site unchanged.
