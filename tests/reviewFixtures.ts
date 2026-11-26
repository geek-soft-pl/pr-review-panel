import type { SearchItem } from '../src/api/search.ts';

export function searchItem(number: number, author = 'author', mergedAt: string | null = null): SearchItem {
    const url = `https://github.com/org/repo/pull/${number}`;
    return {
        id: number, number, title: `PR ${number}`, state: mergedAt ? 'closed' : 'open',
        user: { login: author, avatar_url: '' }, html_url: url,
        repository_url: 'https://api.github.com/repos/org/repo',
        pull_request: { html_url: url, url, merged_at: mergedAt },
        created_at: '2026-11-01T08:00:00Z', updated_at: '2026-11-01T11:00:00Z', closed_at: mergedAt,
    };
}
