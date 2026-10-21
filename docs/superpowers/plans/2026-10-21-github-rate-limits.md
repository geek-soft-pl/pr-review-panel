# GitHub rate limit recovery implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement and verify this change in the current checkout.

**Goal:** Prevent bursts of search requests and recover from GitHub secondary rate limits without misreporting permission errors.

**Architecture:** The existing GitHub client owns a shared request queue, search pacing, in-flight GET deduplication and rate-limit cooldown. REST and GraphQL use the same transport. The dashboard observes the client's cooldown and formats errors consistently.

**Tech Stack:** Existing React/TypeScript/Vite app; Node 24's built-in test runner and virtual timers, without new dependencies.

**Spec:** The user approved the diagnosis and four proposed changes in this conversation, and requested that Missing Approve load only on entering its tab. That tab already loads lazily; retain and verify that behavior.

## Global constraints

- Keep changes in this checkout for local testing and publish them as a pull request against `master`, as requested by the user. Do not deploy.
- Search starts are separated by at least 2,500 ms and requests are serialized.
- Detect secondary limits from HTTP 403/429, the message and Retry-After, independently of remaining primary quota.
- Retry a secondary limit at most twice, with a shared minimum 60-second cooldown and exponential backoff; honor longer Retry-After values.
- Surface primary exhaustion without automatically retrying the failed request; hold subsequent requests until its reset.
- Deduplicate identical pending GETs; never deduplicate review submissions.
- Do not send queued requests under a different token after an account change.
- Missing Approve must make no requests on initial dashboard load; Load Reviews remains explicit.

## Review focus

- Missing/malformed Retry-After and responses with remaining quota: recover with the minimum cooldown.
- Concurrent searches, ordinary REST and GraphQL: no requests slip through the shared cooldown.
- Repeated limits and primary exhaustion: bounded retries, correct reset semantics, no stuck queue.
- Credential changes and rejected requests: no cross-account responses or permanent queue blockage.
- Lazy history loading and permission errors: preserve normal UX and distinguish throttling from denied access.

### Task 1: Shared request scheduling and rate-limit recovery

**Files:** `src/api/githubClient.ts`, `tests/githubClient.test.ts`, `package.json`.

**Interfaces:** Preserve `fetch<T>`, `graphql<T>`, `setToken` and pagination. Extend GitHubError with `rateLimitKind` and `retryAt`; expose `getRateLimit`, `subscribeToRateLimit` and `getGitHubErrorMessage` for UI consumption.

- [x] Write tests for the reported 403, shared cooldown, pacing, deduplication, bounded retries, primary exhaustion and token changes.
- [x] Run `node --test tests/githubClient.test.ts`; verify failures describe the missing behaviors.
- [x] Implement the shared transport and error classification; wire `npm test` to Node's runner.
- [x] Run `npm test`; expect all tests to pass.

### Task 2: Clear UI messages and lazy-history verification

**Files:** `src/pages/Dashboard.tsx`, `src/state/tokenStore.ts`, `README.md`, client tests, `tests/browser-regressions.html`, `tests/browser-regressions.tsx`.

**Interfaces:** Consume the client snapshot with React `useSyncExternalStore` and use `getGitHubErrorMessage` in both error handlers.

- [x] Test rate-limit messages and observable cooldown state before adding UI wiring.
- [x] Display the cooldown while requests are waiting; distinguish rate limits, authentication and permission errors.
- [x] Document request scheduling and Node 24 test usage.
- [x] Run `npm test`, `npm run lint`, `npm run build` and a browser check of initial load versus entering Missing Approve.
- [x] Obtain an independent review of the working diff, address significant findings, and leave changes ready for local testing.

## Progress

- Baseline lint passed. Existing code and call sites confirm history loads only from tab entry, history refresh or its slider; review history requires Load Reviews.
- Work remains in the existing checkout so the user can run the same panel locally. The user subsequently approved publishing the changes as a pull request with the 2,500 ms search interval unchanged.
- Final client tests: 16/16 passed. Browser checks against real React components: 3/3 passed. Lint, production build, test TypeScript checking and diff whitespace checking passed.
- Independent review findings reproduced before fixing: stale account requests clearing a newer login; stale cooldown text hiding the active resume time; each queued request restarting the retry budget. The fixes are covered by failing-then-passing browser/client regressions.
- Invalid numeric Retry-After also produced a permanently stalled queue; validated the resulting date and covered the fallback with a regression test.
- Persistent secondary failures now reject the pending batch after two retries. Subsequent attempts retain exponential backoff (maximum 15 minutes) until a successful response resets it.
- Scope decisions after review: retain existing per-PR partial-result handling, GraphQL HTTP-200 error classification and multi-call pagination behavior. This change addresses reported REST HTTP-403/429 throttling and shares its cooldown with GraphQL transport; it does not redesign those existing behaviors.
