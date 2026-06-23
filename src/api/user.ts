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

export async function fetchUserTeamsForOrg(org: string): Promise<GitHubTeam[]> {
    const allTeams = await githubClient.fetchWithPagination<GitHubTeam>('/user/teams');
    return allTeams.filter(
        (team) => team.organization.login.toLowerCase() === org.toLowerCase()
    );
}
