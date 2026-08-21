import { githubClient } from './githubClient';

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

export async function searchOpenPRsForReview(
    orgs: string[],
    login: string,
    teamSlugsByOrg: Record<string, string[]> = {}
): Promise<ParsedPR[]> {
    const allPRs: ParsedPR[] = [];
    const seen = new Set<string>();
    const normalizedLogin = login.toLowerCase();

    for (const org of orgs) {
        // Query 1: PRs where I'm requested as reviewer (pending review)
        const queryRequested = `is:pr is:open org:${org} review-requested:${login} archived:false`;
        // Query 2: PRs where I already submitted a review (but still open)
        const queryReviewed = `is:pr is:open org:${org} reviewed-by:${login} archived:false`;
        // Query 3+: PRs where my teams are requested as reviewers — only this
        // org's team slugs (the ${org}/${slug} qualifier must not mix orgs)
        const teamSlugs = teamSlugsByOrg[org.toLowerCase()] ?? [];
        const teamQueries = teamSlugs.map(
            (slug) => `is:pr is:open org:${org} team-review-requested:${org}/${slug} archived:false`
        );

        // Run all queries in parallel
        const [requestedPRs, reviewedPRs, ...teamResults] = await Promise.all([
            searchPRs(queryRequested, 200),
            searchPRs(queryReviewed, 200),
            ...teamQueries.map((q) => searchPRs(q, 200)),
        ]);

        // Merge results, avoiding duplicates
        const allResults = [...requestedPRs, ...reviewedPRs, ...teamResults.flat()];
        for (const pr of allResults) {
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
