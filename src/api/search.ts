import { githubClient } from './githubClient.ts';

export interface SearchResult {
    total_count: number;
    incomplete_results: boolean;
    items: SearchItem[];
}

export interface SearchItem {
    id: number;
    number: number;
    title: string;
    user: {
        login: string;
        avatar_url: string;
    };
    state: string;
    html_url: string;
    created_at: string;
    updated_at: string;
    closed_at: string | null;
    pull_request?: {
        url: string;
        html_url: string;
        merged_at: string | null;
    };
    repository_url: string;
}

export interface ParsedPR {
    id: number;
    number: number;
    title: string;
    author: string;
    authorAvatar: string;
    state: string;
    htmlUrl: string;
    createdAt: string;
    updatedAt: string;
    closedAt: string | null;
    mergedAt: string | null;
    owner: string;
    repo: string;
    repoFullName: string;
}

function parseRepoFromUrl(repositoryUrl: string): { owner: string; repo: string } {
    // Format: https://api.github.com/repos/owner/repo
    const parts = repositoryUrl.split('/');
    return {
        owner: parts[parts.length - 2],
        repo: parts[parts.length - 1],
    };
}

function parseSearchItem(item: SearchItem): ParsedPR {
    const { owner, repo } = parseRepoFromUrl(item.repository_url);
    return {
        id: item.id,
        number: item.number,
        title: item.title,
        author: item.user.login,
        authorAvatar: item.user.avatar_url,
        state: item.state,
        htmlUrl: item.html_url,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        closedAt: item.closed_at,
        mergedAt: item.pull_request?.merged_at || null,
        owner,
        repo,
        repoFullName: `${owner}/${repo}`,
    };
}

async function searchPRs(query: string, maxItems: number = 200): Promise<ParsedPR[]> {
    const items: SearchItem[] = [];
    let page = 1;
    const perPage = 100;
    // GitHub's Search API only exposes the first 1000 results; requesting beyond
    // that returns HTTP 422, so cap pagination at 1000/perPage pages.
    const maxPage = Math.ceil(1000 / perPage);

    while (items.length < maxItems && page <= maxPage) {
        const encodedQuery = encodeURIComponent(query);
        const url = `/search/issues?q=${encodedQuery}&per_page=${perPage}&page=${page}`;

        const result = await githubClient.fetch<SearchResult>(url);

        // Filter to only PR items (have pull_request field)
        const prItems = result.items.filter((item) => item.pull_request);
        items.push(...prItems);

        if (result.items.length < perPage) break;
        if (items.length >= result.total_count) break;

        page++;
    }

    return items.slice(0, maxItems).map(parseSearchItem);
}

export interface OpenReviewCandidate extends ParsedPR {
    fromDirectRequest: boolean;
}

export async function searchOpenPRsForReview(
    orgs: string[],
    login: string,
    teamSlugsByOrg: Record<string, string[]> = {},
    directOnly = false
): Promise<OpenReviewCandidate[]> {
    const allPRs: OpenReviewCandidate[] = [];
    const seen = new Set<string>();
    const normalizedLogin = login.toLowerCase();
    const directQualifier = 'user-review-requested:@me';

    for (const org of orgs) {
        const teamSlugs = directOnly ? [] : teamSlugsByOrg[org.toLowerCase()] ?? [];
        // Keep pending requests first so a re-request takes precedence over an earlier review.
        const qualifiers = [
            directOnly ? directQualifier : `review-requested:${login}`,
            `reviewed-by:${login}`,
            ...teamSlugs.map(slug => `team-review-requested:${org}/${slug}`),
        ];
        const results = await Promise.all(qualifiers.map(async qualifier => {
            const prs = await searchPRs(`is:pr is:open org:${org} ${qualifier} archived:false`);
            return prs.map(pr => ({ ...pr, fromDirectRequest: qualifier === directQualifier }));
        }));

        for (const pr of results.flat()) {
            // "To Review" should never include my own PRs.
            if (pr.author.toLowerCase() === normalizedLogin) {
                continue;
            }
            const key = pr.htmlUrl;
            if (!seen.has(key)) {
                seen.add(key);
                allPRs.push(pr);
            }
        }
    }

    return allPRs.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
}

export async function searchMyOpenPRs(
    orgs: string[],
    login: string
): Promise<ParsedPR[]> {
    const allPRs: ParsedPR[] = [];
    const seen = new Set<string>();

    for (const org of orgs) {
        const query = `is:pr is:open org:${org} author:${login} archived:false`;
        const prs = await searchPRs(query, 200);

        for (const pr of prs) {
            const key = pr.htmlUrl;
            if (!seen.has(key)) {
                seen.add(key);
                allPRs.push(pr);
            }
        }
    }

    return allPRs.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
}

export async function searchMergedPRs(
    orgs: string[],
    since: number | Date
): Promise<ParsedPR[]> {
    const allPRs: ParsedPR[] = [];
    const seen = new Set<string>();

    let sinceDate: Date;
    if (typeof since === 'number') {
        sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - since);
    } else {
        sinceDate = since;
    }

    // ISO string format YYYY-MM-DDTHH:MM:SSZ for precise time filtering
    // But GitHub search quilifiers for dates usually take YYYY-MM-DD or ISO 8601
    // merged:>=YYYY-MM-DD-THH:MM:SSZ works.
    const sinceDateStr = sinceDate.toISOString();

    for (const org of orgs) {
        const query = `is:pr is:merged org:${org} merged:>=${sinceDateStr} archived:false`;

        // Use a higher limit if possible, but pagination handles it
        const prs = await searchPRs(query, 100);

        for (const pr of prs) {
            const key = pr.htmlUrl;
            if (!seen.has(key)) {
                seen.add(key);
                allPRs.push(pr);
            }
        }
    }

    return allPRs.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
}
