import { githubClient } from './githubClient';

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
}

interface PRDetails {
    requested_reviewers: Array<{
        login: string;
        avatar_url: string;
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
    requestedReviewers: Array<{ login: string; avatar_url: string }>
): ReviewerInfo[] {
    const reviewerMap = new Map<string, ReviewerInfo>();

    // Add requested reviewers as PENDING
    for (const reviewer of requestedReviewers) {
        reviewerMap.set(reviewer.login.toLowerCase(), {
            login: reviewer.login,
            avatarUrl: reviewer.avatar_url,
            state: 'PENDING',
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
            avatarUrl: existing?.avatarUrl || '',
            state,
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
