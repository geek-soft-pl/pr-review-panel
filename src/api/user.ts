import { githubClient } from './githubClient';

export interface GitHubUser {
    login: string;
    id: number;
    avatar_url: string;
    name: string | null;
}

export interface GitHubTeam {
    id: number;
    slug: string;
    name: string;
    organization: {
        login: string;
    };
}

export async function fetchCurrentUser(): Promise<GitHubUser> {
    return githubClient.fetch<GitHubUser>('/user');
}

// Team slugs grouped by org (lowercased): team-review requests are queried
// per-org with a `${org}/${slug}` qualifier, so a flat slug list would mix orgs.
export async function fetchUserTeamsByOrg(): Promise<Record<string, string[]>> {
    const allTeams = await githubClient.fetchWithPagination<GitHubTeam>('/user/teams');
    const byOrg: Record<string, string[]> = {};
    for (const team of allTeams) {
        const org = team.organization.login.toLowerCase();
        (byOrg[org] ??= []).push(team.slug);
    }
    return byOrg;
}
