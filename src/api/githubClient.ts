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
        ? new Date(parseInt(rateLimitReset) * 1000)
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
    options: FetchOptions = {}
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
