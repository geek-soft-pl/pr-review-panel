import { githubClient } from './githubClient';

export interface TimelineEvent {
    event: string;
    actor?: {
        login: string;
    };
    requested_reviewer?: {
        login: string;
    };
    requested_team?: {
        name: string;
        slug: string;
    };
    created_at?: string;
}

export async function fetchTimeline(
    owner: string,
    repo: string,
    issueNumber: number
): Promise<TimelineEvent[]> {
    return githubClient.fetchWithPagination<TimelineEvent>(
        `/repos/${owner}/${repo}/issues/${issueNumber}/timeline`,
        500
    );
}

export function wasReviewRequestedForMe(
    events: TimelineEvent[],
    login: string,
    userTeams?: string[]
): boolean {
    for (const event of events) {
        if (event.event === 'review_requested') {
            // Direct user review request
            if (
                event.requested_reviewer?.login.toLowerCase() === login.toLowerCase()
            ) {
                return true;
            }

            // Team review request
            if (userTeams && event.requested_team) {
                const teamSlug = event.requested_team.slug.toLowerCase();
                if (userTeams.some((t) => t.toLowerCase() === teamSlug)) {
                    return true;
                }
            }
        }
    }

    return false;
}
