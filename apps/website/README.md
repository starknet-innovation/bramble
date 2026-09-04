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

**The public hostname is being changed.** `bramble.money` has been retired and the Worker currently
serves an unbranded holding page there, so `routes` in `wrangler.jsonc` is deliberately empty — a
Worker with no trigger is deployable but unreachable. Declaring nothing also stops a deploy from
re-attaching the old hostname. When the replacement hostname is live, add it as a custom-domain
route. A Workers custom domain requires the zone to be on Cloudflare DNS, so the domain's
nameservers must point at Cloudflare even if it is registered elsewhere.

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
