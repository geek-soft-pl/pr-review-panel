import { githubClient } from './githubClient';

// A reviewer is a bot if GitHub types it as such, or its login is suffixed with
// "[bot]" (e.g. copilot-pull-request-reviewer[bot], devin-ai-integration[bot]).
const isBotUser = (login: string, type?: string): boolean =>
    type === 'Bot' || login.endsWith('[bot]');

export type ReviewState =
    | 'APPROVED'
    | 'CHANGES_REQUESTED'
    | 'COMMENTED'
    | 'DISMISSED'
    | 'PENDING';

interface Review {
    id: number;
    user: {
        login: string;
        avatar_url: string;
        type?: string;
    };
    state: ReviewState;
    submitted_at: string;
}

export interface ReviewStateInfo {
    state: ReviewState | 'PENDING';
    submittedAt: string | null;
}

export async function fetchPRReviews(
    owner: string,
    repo: string,
    pullNumber: number
): Promise<Review[]> {
    return githubClient.fetchWithPagination<Review>(
        `/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`
    );
}

export async function submitReview(
    owner: string,
    repo: string,
    pullNumber: number,
    event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
    body?: string
): Promise<void> {
    await githubClient.fetch(
        `/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`,
        {
            method: 'POST',
            body: {
                event,
                body,
            },
        }
    );
}

export interface ReviewerInfo {
    login: string;
    avatarUrl: string;
    state: ReviewState | 'PENDING';
    isBot: boolean;
}

interface PRDetails {
    requested_reviewers: Array<{
        login: string;
        avatar_url: string;
        type?: string;
    }>;
}

export async function fetchPRDetails(
    owner: string,
    repo: string,
    pullNumber: number
): Promise<PRDetails> {
    return githubClient.fetch<PRDetails>(
        `/repos/${owner}/${repo}/pulls/${pullNumber}`
    );
}

export function computeAllReviewersState(
    reviews: Review[],
    requestedReviewers: Array<{ login: string; avatar_url: string; type?: string }>
): ReviewerInfo[] {
    const reviewerMap = new Map<string, ReviewerInfo>();

    // Add requested reviewers as PENDING
    for (const reviewer of requestedReviewers) {
        reviewerMap.set(reviewer.login.toLowerCase(), {
            login: reviewer.login,
            avatarUrl: reviewer.avatar_url,
            state: 'PENDING',
            isBot: isBotUser(reviewer.login, reviewer.type),
        });
    }

    // Process reviews to get latest state per reviewer
    // Sort reviews by submitted_at ascending so we process in order
    const sortedReviews = [...reviews].sort(
        (a, b) => new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime()
    );

    for (const review of sortedReviews) {
        if (!review.user?.login) continue;

        const key = review.user.login.toLowerCase();
        let state = review.state;

        // Map DISMISSED to PENDING
        if (state === 'DISMISSED') {
            state = 'PENDING';
        }

        // Get existing avatar or use empty string
        const existing = reviewerMap.get(key);

        reviewerMap.set(key, {
            login: review.user.login,
            // Once a reviewer approves, GitHub drops them from requested_reviewers,
            // so they only appear here — use the avatar from the review itself.
            avatarUrl: existing?.avatarUrl || review.user.avatar_url || '',
            state,
            isBot: existing?.isBot ?? isBotUser(review.user.login, review.user.type),
        });
    }

    // Sort: APPROVED first, then CHANGES_REQUESTED, then others
    const stateOrder: Record<string, number> = {
        'APPROVED': 0,
        'CHANGES_REQUESTED': 1,
        'COMMENTED': 2,
        'PENDING': 3,
    };

    return Array.from(reviewerMap.values()).sort(
        (a, b) => (stateOrder[a.state] ?? 99) - (stateOrder[b.state] ?? 99)
    );
}

export function computeMyReviewState(
    reviews: Review[],
    myLogin: string
): ReviewStateInfo {
    // Filter reviews by current user
    const myReviews = reviews.filter(
        (r) => r.user?.login.toLowerCase() === myLogin.toLowerCase()
    );

    if (myReviews.length === 0) {
        return { state: 'PENDING', submittedAt: null };
    }

    // Sort by submitted_at desc
    myReviews.sort(
        (a, b) =>
            new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()
    );

    const lastReview = myReviews[0];

    // Map DISMISSED to PENDING for logic purposes (user needs to review again)
    // But keep other states
    let state = lastReview.state;
    if (state === 'DISMISSED') {
        state = 'PENDING';
    }

    return {
        state,
        submittedAt: lastReview.submitted_at,
    };
}
