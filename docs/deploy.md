# Deploying (Cloudflare Pages, free)

Deploys run from `.github/workflows/ci.yml` in the `deploy` job, only after `check` and `e2e` pass:

- push to `main` -> production at `https://peel-app.pages.dev`
- pull request -> preview at a per-branch URL, posted as a comment on the PR (open it on your phone)

The job creates the Pages project `peel-app` on first run. Until the two secrets below exist, the job is skipped with a notice.

## One-time setup

1. Create a free Cloudflare account (https://dash.cloudflare.com/sign-up).
2. Account ID: Workers & Pages -> the ID is shown in the right sidebar (or in the dashboard URL).
3. API token: My Profile -> API Tokens -> Create Token -> Custom token -> permission **Account / Cloudflare Pages / Edit**, scoped to your account.
4. Add both as repository secrets (GitHub repo -> Settings -> Secrets and variables -> Actions), or with the CLI:
   ```
   gh secret set CLOUDFLARE_API_TOKEN -R upl1nkcode/Peel-app
   gh secret set CLOUDFLARE_ACCOUNT_ID -R upl1nkcode/Peel-app
   ```
5. Re-run the latest CI run, or push to `main`.

If `peel-app.pages.dev` is taken, Cloudflare picks a suffixed name; the real URL is printed in the deploy job log.
