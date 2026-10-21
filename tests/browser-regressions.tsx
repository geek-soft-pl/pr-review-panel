import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Dashboard } from '../src/pages/Dashboard';
import { githubClient } from '../src/api/githubClient';
import { useCurrentUser } from '../src/state/tokenStore';

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
