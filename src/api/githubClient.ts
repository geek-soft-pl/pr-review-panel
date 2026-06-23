export interface GitHubError {
  status: number;
  message: string;
  isRateLimit: boolean;
  rateLimitReset?: Date;
}

export interface FetchOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

class GitHubClient {
  private token: string = '';

  setToken(token: string) {
    this.token = token;
  }

  getToken(): string {
    return this.token;
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const isRateLimit =
        response.status === 403 &&
        response.headers.get('X-RateLimit-Remaining') === '0';

      const rateLimitReset = response.headers.get('X-RateLimit-Reset');
      const resetDate = rateLimitReset
        ? new Date(parseInt(rateLimitReset, 10) * 1000)
        : undefined;

      let message = `GitHub API error: ${response.status}`;
      try {
        const errorBody = await response.json();
        message = errorBody.message || message;
      } catch {
        // ignore json parse errors
      }

      const error: GitHubError = {
        status: response.status,
        message,
        isRateLimit,
        rateLimitReset: resetDate,
      };
      throw error;
    }

    return response.json();
  }

  async fetch<T>(
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
      ...options.headers,
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    // Transparently retry on secondary rate limits / abuse detection, which
    // GitHub signals with 429 or a 403 carrying a Retry-After header. We do NOT
    // retry primary quota exhaustion (X-RateLimit-Remaining: 0) — that can take
    // up to an hour to reset and should surface to the user instead.
    if (!response.ok && retriesLeft > 0) {
      const remaining = response.headers.get('X-RateLimit-Remaining');
      const retryAfter = response.headers.get('Retry-After');
      const isSecondaryLimit =
        response.status === 429 ||
        (response.status === 403 && remaining !== '0' && retryAfter !== null);

      if (isSecondaryLimit) {
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 1000;
        // Only honor short, sensible backoffs; otherwise surface the error.
        if (waitMs > 0 && waitMs <= 60_000) {
          await sleep(waitMs);
          return this.fetch<T>(endpoint, options, retriesLeft - 1);
        }
      }
    }

    return this.handleResponse<T>(response);
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
}

export const githubClient = new GitHubClient();
