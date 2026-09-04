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
