import { githubClient } from './githubClient.ts';
import type { ReviewStateInfo } from './reviews';

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
    user?: { login: string };
    state?: string;
    submitted_at?: string;
    created_at?: string;
}

export async function fetchTimeline(
    owner: string,
    repo: string,
    issueNumber: number,
    maxItems?: number
): Promise<TimelineEvent[]> {
    return githubClient.fetchWithPagination<TimelineEvent>(
        `/repos/${owner}/${repo}/issues/${issueNumber}/timeline`,
        maxItems
    );
}

export type ReviewRequestSource = 'direct' | 'team';

export function getDirectReviewState(events: TimelineEvent[], login: string): ReviewStateInfo | null {
    const normalizedLogin = login.toLowerCase();
    const myEvents = events.filter(event =>
        event.requested_reviewer?.login.toLowerCase() === normalizedLogin ||
        (event.event === 'reviewed' && event.user?.login.toLowerCase() === normalizedLogin)
    );
    const time = (event: TimelineEvent) => Date.parse(event.submitted_at ?? event.created_at ?? '') || 0;
    myEvents.sort((a, b) => time(a) - time(b));

    let review: ReviewStateInfo | null = null;
    for (const event of myEvents) {
        if (event.event === 'review_requested') {
            review = { state: 'PENDING', submittedAt: null };
        } else if (event.event === 'review_request_removed') {
            review = null;
        } else if (event.event === 'reviewed' && review) {
            const state = event.state?.toUpperCase();
            // A follow-up comment leaves the reviewer's approval or request for changes in effect.
            const commentOnly = state === 'COMMENTED' && (review.state === 'PENDING' || review.state === 'COMMENTED');
            if (state === 'APPROVED' || state === 'CHANGES_REQUESTED' || commentOnly) {
                review = { state, submittedAt: event.submitted_at ?? null };
            }
        }
    }
    return review;
}

export function getReviewRequestSource(
    events: TimelineEvent[],
    login: string,
    userTeams: string[],
    mergedAt: string | null
): ReviewRequestSource | null {
    const normalizedLogin = login.toLowerCase();
    const teams = new Set(userTeams.map(team => team.toLowerCase()));
    const mergeTime = mergedAt ? Date.parse(mergedAt) : Infinity;
    let source: ReviewRequestSource | null = null;

    for (const event of events) {
        if (event.event !== 'review_requested') continue;
        if (event.created_at && Date.parse(event.created_at) > mergeTime) continue;

        if (event.requested_reviewer?.login.toLowerCase() === normalizedLogin) {
            return 'direct';
        }
        if (event.requested_team && teams.has(event.requested_team.slug.toLowerCase())) {
            source = 'team';
        }
    }

    return source;
}
