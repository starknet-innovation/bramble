# Hosting the documentation

The documentation is deliberately compatible with GitHub Pages and adds no runtime or application
dependency.

After this documentation branch is merged:

1. Open the repository's **Settings → Pages**.
2. Select **Deploy from a branch**.
3. Select `main` and the `/docs` folder.
4. Save.

The site root will serve `docs/index.md`. The audit index has the stable route
`/security-audit/`, and the consolidated source review is available at
`/security-audit/src-package-audit/`. Relative links keep the same tree usable in GitHub's
Markdown renderer and in other Jekyll-compatible hosts.

Do not publish an unremediated vulnerability's exploit details. Put sensitive evidence in a
private GitHub Security Advisory and add only a sanitized placeholder to the public findings
ledger.
