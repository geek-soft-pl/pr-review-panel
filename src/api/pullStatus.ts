import { githubClient } from './githubClient';

export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
export type MergeableState = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
export type CheckState = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'ERROR' | 'EXPECTED' | null;

export interface PRStatus {
    isDraft: boolean;
    // reviewDecision honors each repo's branch-protection rules (required
    // approvals) — GitHub computes it, so we never read repo settings ourselves.
    reviewDecision: ReviewDecision;
    mergeable: MergeableState;
    mergeStateStatus: string; // CLEAN | BLOCKED | BEHIND | DIRTY | UNSTABLE | DRAFT | HAS_HOOKS | UNKNOWN
    checks: CheckState;
    // Count of reviewers whose latest opinionated review is an approval.
    approvedCount: number;
}

export interface PRRef {
    owner: string;
    repo: string;
    number: number;
}

interface RawPR {
    isDraft: boolean;
    reviewDecision: ReviewDecision;
    mergeable: MergeableState;
    mergeStateStatus: string;
    commits: {
        nodes: Array<{ commit: { statusCheckRollup: { state: CheckState } | null } }>;
    };
    latestOpinionatedReviews: { nodes: Array<{ state: string }> };
}

export const prStatusKey = (owner: string, repo: string, prNumber: number): string =>
    `${owner}/${repo}#${prNumber}`;

const STATUS_FRAGMENT = `fragment S on PullRequest {
  isDraft
  reviewDecision
  mergeable
  mergeStateStatus
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  latestOpinionatedReviews(first: 50) { nodes { state } }
}`;

/**
 * Fetch review/merge status for many PRs in as few requests as possible: one
 * aliased GraphQL query per chunk of 50. Best-effort per-PR — a PR that can't be
 * resolved is simply absent from the returned map.
 */
export async function fetchPRStatuses(prs: PRRef[]): Promise<Map<string, PRStatus>> {
    const result = new Map<string, PRStatus>();
    if (prs.length === 0) return result;

    const CHUNK = 50;
    for (let i = 0; i < prs.length; i += CHUNK) {
        const chunk = prs.slice(i, i + CHUNK);
        const aliases = chunk
            .map(
                (pr, idx) =>
                    `p${idx}: repository(owner: ${JSON.stringify(pr.owner)}, name: ${JSON.stringify(
                        pr.repo
                    )}) { pullRequest(number: ${pr.number}) { ...S } }`
            )
            .join('\n');
        const query = `query {\n${aliases}\n}\n${STATUS_FRAGMENT}`;

        const data = await githubClient.graphql<
            Record<string, { pullRequest: RawPR | null } | null>
        >(query);

        chunk.forEach((pr, idx) => {
            const node = data[`p${idx}`]?.pullRequest;
            if (!node) return;
            result.set(prStatusKey(pr.owner, pr.repo, pr.number), {
                isDraft: node.isDraft,
                reviewDecision: node.reviewDecision,
                mergeable: node.mergeable,
                mergeStateStatus: node.mergeStateStatus,
                checks: node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null,
                approvedCount:
                    node.latestOpinionatedReviews?.nodes?.filter((n) => n.state === 'APPROVED').length ?? 0,
            });
        });
    }

    return result;
}
