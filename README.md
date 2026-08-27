# PR Review Panel

A lightweight web panel for reviewing GitHub pull requests across an organization.
It surfaces the three things the stock GitHub UI makes awkward to track:

- **My Open PRs** — your own open PRs and, per PR, where each requested reviewer stands.
- **To Review (Open)** — open PRs where you (or one of your teams) are a requested
  reviewer, with your current review state. Optionally hide the ones you've approved.
- **Missing Approve** — recently **merged** PRs (last 30/60/90 days) that were
  requested from you but never got your approval. You can approve straight from the
  table, or hide PRs you don't care about.

Built with React 19, TypeScript, Vite and MUI. All data is fetched client-side
directly from the GitHub REST API using a token you provide — there is no backend.

## Prerequisites

- Node.js 20+ and npm.
- A **GitHub token** with read access to the organization's pull requests
  (and `write` if you want to approve PRs from the panel).

### Which token / scopes

- **Fine-grained personal access token** (recommended): grant it access to
  **every configured org's** repos with **Pull requests: Read and write** and
  **Contents: Read-only**. If the panel lists several orgs, the token must
  cover all of them — otherwise the unreachable org's PRs silently stay empty.
- **Classic PAT**: the `repo` scope covers private repositories. `read:org` helps
  team-based review requests resolve correctly.

The token is entered in the UI and stored in your browser (`sessionStorage` by
default, or `localStorage` if you tick **Remember**). It is **never** committed,
bundled, or sent anywhere except `api.github.com`.

## Setup

```bash
npm install
npm run dev          # start the dev server (Vite)
```

Open the printed URL, paste your GitHub token, and you're in.

### Configuration

Configuration is optional — copy `.env.example` to `.env` to override defaults:

| Variable          | Purpose                                              | Default       |
| ----------------- | ---------------------------------------------------- | ------------- |
| `VITE_GITHUB_ORG` | Organization(s) whose PRs the panel shows — one name or a comma-separated list (e.g. `geek-soft-pl,integrationsgeeksoft`). | `geek-soft-pl`|

> `VITE_*` variables are **baked into the built bundle**, so only put non-secret
> values here. There is intentionally no token env var — every user supplies their
> own token in the UI.

For GitHub Actions deployments, configure the repository variable
`VITE_GITHUB_ORG` under **Settings → Secrets and variables → Actions → Variables**.
Its value is a comma-separated list, for example
`geek-soft-pl,integrationsgeeksoft`. The deploy workflow passes this variable to
Vite during the production build.

The deployment also requires `AWS_DEPLOY_ROLE_ARN`, set to the
`pr_review_panel_deploy_role_arn` output from the `03-workload-dev` stack in
`geeksoft_org_aws`. The workflow fails before building if either repository
variable is missing.

## Build & deploy

```bash
npm run build        # type-check (tsc -b) + production build into dist/
npm run preview      # serve the build locally for a final check
```

> **Base path:** the app is built to be served under **`/pr/`** (see `base` in
> `vite.config.ts`). `npm run preview` honors this; a plain static file server
> pointed at `dist/` at the domain root will 404 on assets. Serve `dist/` under a
> `/pr/` path (or change `base` to `'/'` if you deploy at the root).

## Scripts

| Script            | What it does                                  |
| ----------------- | --------------------------------------------- |
| `npm run dev`     | Vite dev server with HMR.                     |
| `npm run build`   | Type-check and produce a production build.    |
| `npm run preview` | Preview the production build (respects base). |
| `npm run lint`    | Run ESLint over the project.                  |

## How it works (notes for maintainers)

- `src/api/` — thin wrappers over the GitHub REST API. `githubClient` is a singleton
  that holds the token, paginates, and transparently retries on secondary rate limits.
- `src/state/` — small hooks backed by `localStorage`/`sessionStorage`
  (token, theme, hidden PRs, history window).
- `src/pages/Dashboard.tsx` — orchestrates the three tabs, throttles per-PR requests
  through a small concurrency-limited queue, and caches review/timeline lookups for
  5 minutes to stay within GitHub's rate limits.

GitHub's **Search API** is rate-limited separately and only exposes the first 1000
results per query, so the panel scopes queries by org and, for the history tab, asks
you to pick the repos to check before doing per-PR lookups.
