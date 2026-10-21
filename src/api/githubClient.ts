export interface GitHubError {
  status: number;
  message: string;
  isRateLimit: boolean;
  rateLimitReset?: Date;
  rateLimitKind?: 'primary' | 'secondary';
  retryAt?: Date;
}

export interface FetchOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export function getGitHubErrorMessage(err: unknown): string {
  const error = err as Partial<GitHubError> | null;
  if (error?.isRateLimit) {
    const retryAt = error.retryAt ?? error.rateLimitReset;
    const resume = retryAt
      ? ` Requests can resume after ${retryAt.toLocaleTimeString()}.`
      : ' Please wait a few minutes before trying again.';
    return error.rateLimitKind === 'secondary'
      ? `GitHub temporarily limited requests.${resume}`
      : `GitHub API rate limit exceeded.${resume}`;
  }
  if (error?.status === 401) return 'Invalid or expired token. Please update your GitHub token.';
  if (error?.status === 403) return 'Token lacks permissions or access to this organization.';
  return error?.message || 'An error occurred while fetching data.';
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const SEARCH_INTERVAL_MS = 2_500;
const SECONDARY_BACKOFF_MS = 60_000;

interface RequestSession {
  queue: Promise<void>;
  inFlight: Map<string, Promise<unknown>>;
  nextSearchAt: number;
  blockedUntil: number;
  secondaryFailures: number;
  failedBatch?: GitHubError;
}

const createSession = (): RequestSession => ({
  queue: Promise.resolve(),
  inFlight: new Map(),
  nextSearchAt: 0,
  blockedUntil: 0,
  secondaryFailures: 0,
});

function parseReset(value: string | null): Date | undefined {
  if (!value?.trim()) return undefined;
  const seconds = Number(value);
  const date = new Date(seconds * 1000);
  return Number.isFinite(seconds) && seconds > 0 && Number.isFinite(date.getTime())
    ? date : undefined;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    const milliseconds = seconds * 1000;
    return seconds >= 0 && Number.isFinite(new Date(Date.now() + milliseconds).getTime())
      ? milliseconds : undefined;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

class GitHubClient {
  private token: string = '';
  private session = createSession();
  private rateLimit: GitHubError | null = null;
  private listeners = new Set<() => void>();

  setToken(token: string) {
    if (token === this.token) return;
    this.token = token;
    // Requests captured under the old token must not run or populate the new
    // account's UI. A new queue also avoids inheriting another account's wait.
    this.session = createSession();
    this.setRateLimit(null);
  }

  getToken(): string {
    return this.token;
  }

  getRateLimit = (): GitHubError | null => this.rateLimit;

  subscribeToRateLimit = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private setRateLimit(error: GitHubError | null) {
    if (this.rateLimit === error) return;
    this.rateLimit = error;
    this.listeners.forEach((listener) => listener());
  }

  private assertSession(session: RequestSession) {
    if (session !== this.session) {
      throw {
        status: 0,
        message: 'GitHub account changed. Please refresh the panel.',
        isRateLimit: false,
      } satisfies GitHubError;
    }
  }

  private async waitForTurn(session: RequestSession, isSearch: boolean) {
    while (true) {
      this.assertSession(session);
      if (session.failedBatch) {
        if (Date.now() < session.blockedUntil) throw session.failedBatch;
        session.failedBatch = undefined;
      }
      const waitMs = Math.max(session.blockedUntil, isSearch ? session.nextSearchAt : 0) - Date.now();
      if (waitMs <= 0) {
        this.setRateLimit(null);
        return;
      }
      // Chunk long waits so a very distant reset cannot overflow setTimeout.
      await sleep(Math.min(waitMs, 60_000));
    }
  }

  private async readError(response: Response, attempt: number): Promise<GitHubError> {
    let message = `GitHub API error: ${response.status}`;
    try {
      const body = await response.json() as { message?: unknown } | null;
      if (typeof body?.message === 'string') message = body.message;
    } catch {
      // Proxy/server errors may not contain JSON.
    }

    const retryAfter = response.headers.get('Retry-After');
    const rateLimitStatus = response.status === 403 || response.status === 429;
    const primary = rateLimitStatus && response.headers.get('X-RateLimit-Remaining') === '0';
    const secondary = rateLimitStatus && !primary && (
      response.status === 429 || retryAfter !== null || /rate limit|abuse detection/i.test(message)
    );
    const rateLimitReset = primary ? parseReset(response.headers.get('X-RateLimit-Reset')) : undefined;
    const error: GitHubError = { status: response.status, message, isRateLimit: primary || secondary };

    if (error.isRateLimit) {
      error.rateLimitKind = primary ? 'primary' : 'secondary';
      error.rateLimitReset = rateLimitReset;
      const backoff = primary
        ? (rateLimitReset ? Math.max(0, rateLimitReset.getTime() - Date.now()) : SECONDARY_BACKOFF_MS)
        : Math.min(SECONDARY_BACKOFF_MS * 2 ** Math.min(attempt, 4), 15 * 60_000);
      error.retryAt = new Date(Date.now() + Math.max(backoff, parseRetryAfter(retryAfter) ?? 0));
    }
    return error;
  }

  private async performRequest<T>(
    session: RequestSession,
    url: string,
    options: RequestInit,
    retriesLeft: number
  ): Promise<T> {
    const isSearch = new URL(url).pathname.startsWith('/search/');
    while (true) {
      await this.waitForTurn(session, isSearch);
      this.assertSession(session);
      if (isSearch) session.nextSearchAt = Date.now() + SEARCH_INTERVAL_MS;

      const response = await fetch(url, options);
      this.assertSession(session);
      if (response.ok) {
        const result = await response.json() as T;
        this.assertSession(session);
        session.secondaryFailures = 0;
        return result;
      }

      const error = await this.readError(response, session.secondaryFailures);
      this.assertSession(session);
      if (error.isRateLimit) {
        session.blockedUntil = Math.max(session.blockedUntil, error.retryAt!.getTime());
        this.setRateLimit(error);
        if (error.rateLimitKind === 'secondary') {
          session.secondaryFailures++;
          if (session.secondaryFailures <= retriesLeft) continue;
          // Stop this batch once its shared retry budget is exhausted. A manual
          // refresh after the cooldown may probe again, but only a successful
          // response resets backoff; queued work cannot start new retry cycles.
          session.failedBatch = error;
        }
      }
      // Primary quota exhaustion is surfaced immediately. Any subsequent
      // requests still respect the shared reset time before reaching GitHub.
      throw error;
    }
  }

  fetch<T>(
    endpoint: string,
    options: FetchOptions = {},
    retriesLeft: number = 2
  ): Promise<T> {
    const url = endpoint.startsWith('http')
      ? endpoint
      : `https://api.github.com${endpoint}`;

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const session = this.session;
    const method = (options.method || 'GET').toUpperCase();
    const requestOptions: RequestInit = {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    };
    const key = method === 'GET' ? JSON.stringify([url, [...new Headers(headers)], retriesLeft]) : undefined;
    if (key) {
      const pending = session.inFlight.get(key);
      if (pending) return pending as Promise<T>;
    }

    const request = session.queue
      .then(() => this.performRequest<T>(session, url, requestOptions, retriesLeft))
      .finally(() => { if (key) session.inFlight.delete(key); });
    // A rejected task must release the queue for subsequent work.
    session.queue = request.then(() => {}, () => {});
    if (key) session.inFlight.set(key, request);
    return request;
  }

  async fetchWithPagination<T>(
    endpoint: string,
    maxItems: number = 500
  ): Promise<T[]> {
    const items: T[] = [];
    let page = 1;
    const perPage = 100;

    while (items.length < maxItems) {
      const separator = endpoint.includes('?') ? '&' : '?';
      const url = `${endpoint}${separator}per_page=${perPage}&page=${page}`;

      const data = await this.fetch<T[]>(url);

      if (data.length === 0) break;

      items.push(...data);

      if (data.length < perPage) break;

      page++;
    }

    return items.slice(0, maxItems);
  }

  async graphql<T>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    const payload = await this.fetch<{
      data?: T;
      errors?: Array<{ message: string }>;
    }>('/graphql', {
      method: 'POST',
      headers: {
        // merge-info-preview enables PullRequest.mergeStateStatus
        Accept: 'application/vnd.github.merge-info-preview+json',
      },
      body: { query, variables },
    });

    if (payload.errors && payload.errors.length > 0) {
      const error: GitHubError = {
        status: 200,
        message: payload.errors.map((e) => e.message).join('; '),
        isRateLimit: false,
      };
      throw error;
    }

    return payload.data as T;
  }
}

export const githubClient = new GitHubClient();
