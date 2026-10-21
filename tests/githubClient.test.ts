import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { githubClient, type GitHubError } from '../src/api/githubClient.ts';
import * as clientModule from '../src/api/githubClient.ts';

const START = Date.parse('2026-10-21T14:58:32Z');
const secondaryMessage = 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.';

function setup(t: TestContext) {
  // The application exports one singleton. Give each test its own real client.
  const Client = githubClient.constructor as new () => typeof githubClient;
  const client = new Client();
  client.setToken('test-token');
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START });
  return client;
}

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers });

const secondary = (headers: Record<string, string> = {}, status = 403) =>
  json({ message: secondaryMessage }, status, {
    'X-RateLimit-Limit': '30',
    'X-RateLimit-Remaining': '27',
    'X-RateLimit-Reset': '1792594770',
    'X-RateLimit-Resource': 'search',
    ...headers,
  });

async function advance(t: TestContext, milliseconds: number) {
  t.mock.timers.tick(milliseconds);
  await setImmediate();
}

test('recovers from the reported 403 without Retry-After after at least a minute', async (t) => {
  const client = setup(t);
  const calls: number[] = [];
  t.mock.method(globalThis, 'fetch', async () => {
    calls.push(Date.now());
    return calls.length === 1 ? secondary() : json({ items: ['recovered'] });
  });

  const result = client.fetch('/search/issues?q=author:test').catch((error) => error);
  await setImmediate();
  await advance(t, 59_999);
  assert.equal(calls.length, 1);
  await advance(t, 1);
  assert.deepEqual(await result, { items: ['recovered'] });
  assert.deepEqual(calls, [START, START + 60_000]);
});

test('pauses queued REST and GraphQL calls during the same cooldown', async (t) => {
  const client = setup(t);
  const calls: Array<{ url: string; at: number }> = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push({ url, at: Date.now() });
    if (calls.length === 1) return secondary();
    return url.endsWith('/graphql') ? json({ data: { viewer: 'test' } }) : json({ ok: true });
  });

  const limited = client.fetch('/search/issues?q=author:test').catch((error) => error);
  await setImmediate();
  const rest = client.fetch('/user');
  const graphql = client.graphql('{ viewer { login } }');
  await advance(t, 59_999);
  assert.equal(calls.length, 1, 'other endpoints must respect the shared cooldown');
  await advance(t, 1);
  assert.deepEqual(await Promise.all([limited, rest, graphql]), [
    { ok: true }, { ok: true }, { viewer: 'test' },
  ]);
  assert.ok(calls.slice(1).every((call) => call.at >= START + 60_000));
});

test('spaces concurrent search requests and shares identical pending GETs', async (t) => {
  const client = setup(t);
  const calls: Array<{ url: string; at: number }> = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push({ url, at: Date.now() });
    return json({ query: new URL(url).searchParams.get('q') });
  });

  const first = client.fetch('/search/issues?q=first');
  const duplicate = client.fetch('/search/issues?q=first');
  const second = client.fetch('/search/issues?q=second');
  await setImmediate();
  assert.equal(calls.length, 1);
  await advance(t, 2_499);
  assert.equal(calls.length, 1);
  await advance(t, 1);
  assert.deepEqual(await Promise.all([first, duplicate, second]), [
    { query: 'first' }, { query: 'first' }, { query: 'second' },
  ]);
  assert.deepEqual(calls.map((call) => call.at), [START, START + 2_500]);
});

test('does not overlap slow search responses even after the pacing interval', async (t) => {
  const client = setup(t);
  let release!: (response: Response) => void;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) return new Promise<Response>((resolve) => { release = resolve; });
    return json({ page: 2 });
  });
  const first = client.fetch('/search/issues?q=test&page=1');
  const second = client.fetch('/search/issues?q=test&page=2');
  await setImmediate();
  await advance(t, 5_000);
  assert.equal(calls, 1);
  release(json({ page: 1 }));
  assert.deepEqual(await Promise.all([first, second]), [{ page: 1 }, { page: 2 }]);
});

for (const retryAfter of ['120', 'Wed, 21 Oct 2026 15:00:32 GMT']) {
  test(`honors a long Retry-After: ${retryAfter}`, async (t) => {
    const client = setup(t);
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => ++calls === 1
      ? secondary({ 'Retry-After': retryAfter }) : json({ ok: true }));
    const result = client.fetch('/user').catch((error) => error);
    await setImmediate();
    await advance(t, 119_999);
    assert.equal(calls, 1);
    await advance(t, 1);
    assert.deepEqual(await result, { ok: true });
    assert.equal(calls, 2);
  });
}

test('backs off exponentially on 429 and stops after two retries', async (t) => {
  const client = setup(t);
  const calls: number[] = [];
  t.mock.method(globalThis, 'fetch', async () => {
    calls.push(Date.now());
    return secondary({}, 429);
  });
  const result = client.fetch('/user').catch((error: GitHubError) => error);
  await setImmediate();
  await advance(t, 60_000);
  assert.equal(calls.length, 2);
  await advance(t, 119_999);
  assert.equal(calls.length, 2);
  await advance(t, 1);
  const error = await result as GitHubError;
  assert.equal(error.isRateLimit, true);
  assert.deepEqual(calls, [START, START + 60_000, START + 180_000]);
  await advance(t, 600_000);
  assert.equal(calls.length, 3);
});

test('uses a minute fallback for malformed Retry-After', async (t) => {
  const client = setup(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1
    ? secondary({ 'Retry-After': 'invalid' }) : json({ ok: true }));
  const result = client.fetch('/user').catch((error) => error);
  await setImmediate();
  await advance(t, 59_999);
  assert.equal(calls, 1);
  await advance(t, 1);
  assert.deepEqual(await result, { ok: true });
});

test('surfaces primary exhaustion and holds subsequent requests until reset', async (t) => {
  const client = setup(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1
    ? json({ message: 'API rate limit exceeded' }, 429, {
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String((START + 90_000) / 1000),
    }) : json({ ok: true }));
  let settled = false;
  const failed = client.fetch('/search/issues?q=first').catch((error) => {
    settled = true;
    return error;
  });
  await setImmediate();
  assert.equal(settled, true, 'primary exhaustion must surface without an automatic retry');
  const error = await failed as GitHubError;
  assert.equal(error.isRateLimit, true);
  assert.equal(error.rateLimitReset?.getTime(), START + 90_000);
  const next = client.fetch('/user');
  await advance(t, 89_999);
  assert.equal(calls, 1);
  await advance(t, 1);
  assert.deepEqual(await next, { ok: true });
});

test('does not retry permission errors or block the queue after a failure', async (t) => {
  const client = setup(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1
    ? json({ message: 'Resource not accessible by personal access token' }, 403)
    : json({ ok: true }));
  const failed = client.fetch('/user').catch((error) => error);
  const next = client.fetch('/user/teams');
  assert.equal((await failed as GitHubError).isRateLimit, false);
  assert.deepEqual(await next, { ok: true });
  assert.equal(calls, 2);
});

test('never deduplicates review submissions', async (t) => {
  const client = setup(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => json({ id: ++calls }));
  const options = { method: 'POST', body: { event: 'APPROVE' } };
  assert.deepEqual(await Promise.all([
    client.fetch('/repos/example/repo/pulls/1/reviews', options),
    client.fetch('/repos/example/repo/pulls/1/reviews', options),
  ]), [{ id: 1 }, { id: 2 }]);
});

test('cancels old queued requests and responses when the token changes', async (t) => {
  const client = setup(t);
  let release!: (response: Response) => void;
  const tokens: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    tokens.push(new Headers(options.headers).get('Authorization')!);
    if (tokens.length === 1) return new Promise<Response>((resolve) => { release = resolve; });
    return json({ login: 'new-user' });
  });
  const old = client.fetch('/user').catch((error) => error);
  const queued = client.fetch('/user/teams').catch((error) => error);
  await setImmediate();
  client.setToken('new-token');
  const current = client.fetch('/user');
  release(json({ login: 'old-user' }));
  assert.deepEqual(await current, { login: 'new-user' });
  assert.equal((await old as GitHubError).status, 0);
  assert.equal((await queued as GitHubError).status, 0);
  assert.deepEqual(tokens, ['Bearer test-token', 'Bearer new-token']);
});

test('publishes a secondary cooldown for the UI and clears it when requests resume', async (t) => {
  const client = setup(t);
  let calls = 0;
  const states: Array<GitHubError | null> = [];
  const unsubscribe = client.subscribeToRateLimit(() => states.push(client.getRateLimit()));
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1 ? secondary() : json({ ok: true }));
  const result = client.fetch('/user');
  await setImmediate();
  assert.equal(states.length, 1);
  assert.equal(states[0]?.rateLimitKind, 'secondary');
  assert.equal(states[0]?.retryAt?.getTime(), START + 60_000);
  assert.equal(states[0]?.rateLimitReset, undefined, 'primary reset must not masquerade as a secondary cooldown');
  const message = clientModule.getGitHubErrorMessage(states[0]);
  assert.match(message, /temporarily limited/i);
  assert.match(message, /resume after/i);
  assert.doesNotMatch(message, /permissions|organization/i);
  await advance(t, 60_000);
  assert.deepEqual(await result, { ok: true });
  assert.equal(states.at(-1), null);
  unsubscribe();
});

test('formats primary limits, invalid credentials and permission failures distinctly', () => {
  const format = clientModule.getGitHubErrorMessage;
  assert.match(format({ isRateLimit: true, rateLimitKind: 'primary', retryAt: new Date(START) }), /rate limit exceeded/i);
  assert.match(format({ status: 401 }), /expired token/i);
  assert.match(format({ status: 403, isRateLimit: false }), /permissions/i);
  assert.match(format(null), /error occurred/i);
  assert.equal(format(new Error('Connection lost')), 'Connection lost');
});

test('ends the pending batch after repeated secondary limits instead of restarting retries', async (t) => {
  const client = setup(t);
  let calls = 0;
  let settled = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return secondary();
  });
  const requests = ['/user', '/user/teams', '/search/issues?q=other'].map((url) =>
    client.fetch(url).catch((error: GitHubError) => { settled++; return error; }));
  await setImmediate();
  await advance(t, 60_000);
  await advance(t, 120_000);
  assert.equal(settled, 3, 'a persistently blocked batch should stop instead of taking many minutes per queued request');
  const errors = await Promise.all(requests);
  assert.ok(errors.every((error) => (error as GitHubError).isRateLimit));
  await advance(t, 240_000);
  assert.equal(calls, 3);

  const probe = await client.fetch('/user').catch((error: GitHubError) => error) as GitHubError;
  assert.equal(calls, 4);
  assert.equal(probe.retryAt?.getTime(), START + 900_000, 'a failed probe must retain the session backoff');
  await advance(t, 480_000);

  t.mock.method(globalThis, 'fetch', async () => json({ ok: true }));
  assert.deepEqual(await client.fetch('/user'), { ok: true }, 'a fresh request may resume after the cooldown');
});

test('ignores out-of-range Retry-After values instead of poisoning the shared queue', async (t) => {
  const client = setup(t);
  t.mock.method(globalThis, 'fetch', async () => secondary({ 'Retry-After': '1e308' }));
  const error = await client.fetch('/user', {}, 0).catch((error: GitHubError) => error) as GitHubError;
  assert.equal(error.retryAt?.getTime(), START + 60_000);
});
