import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Dashboard } from '../src/pages/Dashboard';
import { githubClient } from '../src/api/githubClient';
import { useCurrentUser } from '../src/state/tokenStore';
import { searchItem } from './reviewFixtures';

// Real React/DOM integration checks served by Vite, without a DOM emulator.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const originalFetch = globalThis.fetch;
const userCacheKey = 'github_pr_panel_user';
const savedUserCache = sessionStorage.getItem(userCacheKey);
const host = document.querySelector<HTMLDivElement>('#fixture')!;
const results = document.querySelector<HTMLOListElement>('#results')!;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const emptySearch = () => json({ items: [], total_count: 0, incomplete_results: false });
const user = (login: string) => json({ id: 1, login, name: login, avatar_url: '' });
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

async function until(condition: () => boolean) {
  const deadline = Date.now() + 15_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the expected UI state');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  }
}

export function UserFixture({ token }: { token: string }) {
  useEffect(() => { githubClient.setToken(token); }, [token]);
  const state = useCurrentUser(token);
  return <output>{JSON.stringify({ login: state.user?.login, error: state.error, loading: state.loading })}</output>;
}

const cases: Array<[string, (root: ReturnType<typeof createRoot>) => Promise<void>]> = [
  ['An old account response cannot clear the new login', async (root) => {
    let releaseOld!: (response: Response) => void;
    globalThis.fetch = async (_input, options) => {
      if (new Headers(options?.headers).get('Authorization') === 'Bearer old-test-token') {
        return new Promise<Response>((resolve) => { releaseOld = resolve; });
      }
      return user('new-user');
    };
    await act(async () => { root.render(<UserFixture token="old-test-token" />); });
    await until(() => !!releaseOld);
    await act(async () => { root.render(<UserFixture token="new-test-token" />); });
    await until(() => host.textContent!.includes('new-user'));
    await act(async () => { releaseOld(user('old-user')); });
    check(host.textContent!.includes('new-user'), 'A stale rejection cleared the new login');
    check(host.textContent!.includes('"error":null'), 'A stale request set an authentication error');
  }],
  ['Missing Approve makes no request until its tab is opened', async (root) => {
    const requests: URL[] = [];
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      return url.pathname === '/user/teams' ? json([]) : emptySearch();
    };
    await act(async () => { root.render(<Dashboard userLogin="fixture-user" orgs={['fixture-org']} />); });
    await until(() => requests.filter((url) => url.pathname === '/search/issues').length === 3);
    check(!requests.some((url) => url.search.includes('is%3Amerged')), 'History was fetched on startup');
    const tab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((element) => element.textContent!.includes('Missing Approve'))!;
    check(tab, 'Missing Approve tab is available');
    await act(async () => { tab.click(); });
    await until(() => requests.some((url) => url.search.includes('is%3Amerged')));
    check(requests.filter((url) => url.search.includes('is%3Amerged')).length === 1, 'History was fetched more than once');
    check(!requests.some((url) => /timeline|reviews/.test(url.pathname)), 'Per-PR history fetched before Load Reviews');
  }],
  ['Only direct review requests is shared by the open queue and loaded history', async (root) => {
    const directKey = 'github_pr_panel_only_direct_review_requests';
    const approvedKey = 'github_pr_panel_hide_approved_open';
    const reposKey = 'github_pr_panel_selected_repos:org:me';
    const keys = [directKey, approvedKey, reposKey];
    const saved = keys.map(key => localStorage.getItem(key));
    const tab = async (name: string) => {
      const button = [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find(el => el.textContent?.includes(name))!;
      await act(async () => { button.click(); });
    };
    const checkbox = () => [...host.querySelectorAll('label')]
      .find(label => label.textContent === 'Only direct review requests')?.querySelector('input');
    const row = (number: number) => host.querySelector(`tbody a[href$="/pull/${number}"]`)?.closest('tr');
    const checkFilterPosition = () => {
      const options = host.querySelector('[role="group"][aria-label="Options"]');
      const table = host.querySelector('table')!;
      check(options && options.querySelector('input[type="checkbox"]') === checkbox(), 'The direct filter should be the first option');
      check(options!.getBoundingClientRect().top >= table.getBoundingClientRect().bottom, 'Options should appear below the table');
    };
    const before = '2026-11-01T09:00:00Z';
    const merged = '2026-11-01T12:00:00Z';
    let historyReads = 0;
    let authorSearches = 0;
    try {
      localStorage.removeItem(directKey);
      localStorage.setItem(approvedKey, 'true');
      localStorage.setItem(reposKey, '["org/repo"]');
      globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        const query = url.searchParams.get('q') ?? '';
        if (url.pathname === '/user/teams') return json([{ slug: 'frontend', organization: { login: 'org' } }]);
        if (url.pathname === '/search/issues') {
          if (query.includes('author:')) authorSearches++;
          let numbers: number[] = [];
          if (query.includes('is:merged')) numbers = [211, 212];
          else if (query.includes('user-review-requested:@me')) numbers = [225];
          else if (query.includes('review-requested:')) numbers = [225, 226];
          else if (query.includes('reviewed-by:me')) numbers = [225, 226, 237, 238];
          const items = numbers.map(n => searchItem(n, 'author', n < 225 ? merged : null));
          return json({ items, total_count: items.length, incomplete_results: false });
        }
        if (url.pathname.endsWith('/timeline')) {
          historyReads++;
          const team = { event: 'review_requested', requested_team: { slug: 'frontend' }, created_at: before };
          const direct = { event: 'review_requested', requested_reviewer: { login: 'me' }, created_at: before };
          const comment = { event: 'reviewed', user: { login: 'me' }, state: 'commented', submitted_at: '2026-11-16T15:00:14Z' };
          if (url.pathname.includes('/226/')) return json([team, comment]);
          if (url.pathname.includes('/237/') || url.pathname.includes('/238/')) {
            const state = url.pathname.includes('/237/') ? 'changes_requested' : 'approved';
            return json([direct, { ...comment, state, submitted_at: '2026-11-02T07:05:49Z' }, comment]);
          }
          return json(url.pathname.includes('/211/') ? [team, direct] : [team]);
        }
        if (url.pathname.endsWith('/reviews')) {
          return json(url.pathname.includes('/225/')
            ? [{ user: { login: 'me' }, state: 'APPROVED', submitted_at: before }] : []);
        }
        if (url.pathname === '/graphql') return json({ data: {} });
        throw new Error(`Unexpected fixture request: ${url.pathname}`);
      };
      await act(async () => { root.render(<Dashboard userLogin="me" orgs={['org']} />); });
      await tab('To Review');
      check(checkbox()?.checked === false, 'The personal filter should start unchecked');
      await until(() => !!row(226));
      checkFilterPosition();
      await act(async () => { checkbox()!.click(); });
      await until(() => !!row(225) && !row(226));
      check(row(225)?.textContent?.includes('Pending'), 'A repeat request should be pending despite the previous approval');
      check(row(237)?.textContent?.includes('Changes Requested'), 'A personal change request disappeared after a follow-up comment');
      check(!row(238), 'A comment after personal approval reopened the review');
      const hideApproved = [...host.querySelectorAll('label')].find(label => label.textContent?.startsWith('Hide approved'))!;
      await act(async () => { hideApproved.click(); });
      check(row(238)?.textContent?.includes('Approved'), 'Clearing Hide approved should show the approved direct review');
      check(!row(226), 'Clearing Hide approved should keep team-only requests out of the personal queue');
      check(hideApproved.textContent === 'Hide approved (1)', 'The approved count should include the completed direct review');
      await act(async () => { hideApproved.click(); });
      check(!row(238) && row(225) && row(237), 'Hide approved should hide only the approved direct review');
      check(localStorage.getItem(directKey) === 'true', 'The filter should survive a reload');
      check(authorSearches === 1, 'Changing review scope re-fetched authored PRs');

      await tab('Missing Approve');
      check(checkbox()?.checked, 'History did not inherit the filter');
      await until(() => host.textContent!.includes('2 merged PRs'));
      const load = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Load Reviews'))!;
      const historyReadsBeforeLoad = historyReads;
      await act(async () => { load.click(); });
      await until(() => !!row(211));
      checkFilterPosition();
      check(!row(212), 'The team-only request appeared as a personal missing approval');
      await act(async () => { checkbox()!.click(); });
      check(row(212) && row(211), 'Toggling the filter did not restore already loaded team requests');
      check(historyReads === historyReadsBeforeLoad + 2, 'Toggling the filter re-fetched PR timelines');
    } finally {
      keys.forEach((key, i) => {
        if (saved[i] === null) localStorage.removeItem(key);
        else localStorage.setItem(key, saved[i]!);
      });
    }
  }],
  ['The current cooldown remains visible after an earlier request failed', async (root) => {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/user/teams') return json([]);
      if (url.searchParams.get('q')?.includes('author:')) {
        return json({ message: 'API rate limit exceeded' }, 403, {
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000)),
        });
      }
      return json({ message: 'You have exceeded a secondary rate limit.' }, 403, { 'X-RateLimit-Remaining': '27' });
    };
    await act(async () => { root.render(<Dashboard userLogin="fixture-user" orgs={['fixture-org']} />); });
    await until(() => githubClient.getRateLimit()?.rateLimitKind === 'secondary');
    const alerts = [...host.querySelectorAll('[role="alert"]')].map((element) => element.textContent).join(' ');
    check(alerts.includes('temporarily limited'), 'The live cooldown was hidden behind a stale error');
    check(alerts.includes(githubClient.getRateLimit()!.retryAt!.toLocaleTimeString()), 'The current resume time is missing');
  }],
];

async function run() {
  let failures = 0;
  try {
    for (const [name, body] of cases) {
      const result = document.createElement('li');
      result.textContent = `RUNNING: ${name}`;
      results.append(result);
      sessionStorage.removeItem(userCacheKey);
      githubClient.setToken(`fixture-${name}`);
      const root = createRoot(host);
      try {
        await body(root);
        result.textContent = `PASS: ${name}`;
      } catch (error) {
        failures++;
        result.textContent = `FAIL: ${name}: ${String(error)}`;
      } finally {
        await act(async () => { root.unmount(); });
        githubClient.setToken('');
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (savedUserCache === null) sessionStorage.removeItem(userCacheKey);
    else sessionStorage.setItem(userCacheKey, savedUserCache);
    const summary = document.createElement('p');
    summary.textContent = `Finished: ${cases.length - failures}/${cases.length} passed`;
    summary.id = 'summary';
    results.after(summary);
  }
}

void run();
