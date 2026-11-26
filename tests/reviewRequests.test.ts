import assert from 'node:assert/strict';
import { test } from 'node:test';
import { githubClient } from '../src/api/githubClient.ts';
import { searchOpenPRsForReview, type SearchItem } from '../src/api/search.ts';
import * as timeline from '../src/api/timeline.ts';
import { searchItem } from './reviewFixtures.ts';

test('the personal search distinguishes active requests from previously reviewed candidates and skips team searches', async (t) => {
    const mixed = searchItem(1);
    const teamOnly = searchItem(2);
    const reviewed = searchItem(3);
    const own = searchItem(4, 'ME');
    const matches: Record<string, SearchItem[]> = {
        'user-review-requested:@me': [mixed, own],
        'review-requested:me': [mixed, teamOnly, own],
        'reviewed-by:me': [mixed, reviewed],
        'team-review-requested:org/frontend': [mixed, teamOnly],
    };
    const queries: string[] = [];
    t.mock.method(githubClient, 'fetch', async (endpoint: string) => {
        const q = new URL(endpoint, 'https://api.github.com').searchParams.get('q')!;
        const qualifier = q.split(' ').find(term => Object.hasOwn(matches, term))!;
        assert.ok(qualifier, q);
        queries.push(qualifier);
        const items = matches[qualifier];
        return { items, total_count: items.length, incomplete_results: false };
    });

    const teams = { org: ['frontend'] };
    const personal = await searchOpenPRsForReview(['org'], 'me', teams, true);
    assert.deepEqual(personal.map(pr => pr.number), [1, 3]);
    assert.deepEqual(personal.filter(pr => pr.fromDirectRequest).map(pr => pr.number), [1]);
    assert.deepEqual(queries, ['user-review-requested:@me', 'reviewed-by:me']);

    const all = await searchOpenPRsForReview(['org'], 'me', teams);
    assert.deepEqual(all.map(pr => pr.number).sort(), [1, 2, 3]);
});

const requested = { event: 'review_requested', requested_reviewer: { login: 'ME' }, created_at: '2026-10-05T21:33:17Z' };
const commented = { event: 'reviewed', user: { login: 'me' }, state: 'commented', submitted_at: '2026-10-07T16:02:42Z' };
const changes = { ...commented, state: 'changes_requested', submitted_at: '2026-10-12T07:05:49Z' };
const followUp = { ...commented, submitted_at: '2026-11-16T15:00:14Z' };

test('comments keep a direct review open and preserve its outstanding change request', () => {
    assert.deepEqual(timeline.getOutstandingDirectReview([requested, commented], 'me'), {
        state: 'COMMENTED', submittedAt: commented.submitted_at,
    });
    const otherApproval = { ...changes, user: { login: 'colleague' }, state: 'approved' };
    assert.deepEqual(timeline.getOutstandingDirectReview([requested, commented, followUp, changes, otherApproval], 'me'), {
        state: 'CHANGES_REQUESTED', submittedAt: changes.submitted_at,
    });
});

test('personal approval closes the review even after a comment, and a new request starts a new review', () => {
    const approved = { ...changes, state: 'approved' };
    const reRequested = { ...requested, created_at: '2026-11-15T09:00:00Z' };
    assert.equal(timeline.getOutstandingDirectReview([requested, approved, followUp], 'me'), null);
    assert.deepEqual(timeline.getOutstandingDirectReview([requested, approved, reRequested, followUp], 'me'), {
        state: 'COMMENTED', submittedAt: followUp.submitted_at,
    });
});

test('a team review, an unsolicited review and an explicitly withdrawn request stay out of the personal queue', () => {
    const team = { event: 'review_requested', requested_team: { name: 'Frontend', slug: 'frontend' }, created_at: requested.created_at };
    const removed = { ...requested, event: 'review_request_removed', created_at: '2026-11-15T09:00:00Z' };
    assert.equal(timeline.getOutstandingDirectReview([team, changes], 'me'), null);
    assert.equal(timeline.getOutstandingDirectReview([commented], 'me'), null);
    assert.equal(timeline.getOutstandingDirectReview([requested, changes, removed, followUp], 'me'), null);
});

test('missing approvals distinguish a personal request before merge from a team request', () => {
    const before = '2026-11-25T10:00:00Z';
    const merged = '2026-11-25T11:00:00Z';
    const after = '2026-11-25T12:00:00Z';
    const team = { event: 'review_requested', requested_team: { name: 'Frontend', slug: 'frontend' }, created_at: before };
    const personal = { event: 'review_requested', requested_reviewer: { login: 'Me' }, created_at: before };
    const source = (...events: timeline.TimelineEvent[]) =>
        timeline.getReviewRequestSource(events, 'me', ['FRONTEND'], merged);

    assert.equal(source(team, personal), 'direct');
    assert.equal(source(personal, team), 'direct');
    assert.equal(source(team, { ...personal, requested_reviewer: { login: 'colleague' } }), 'team');
    assert.equal(source(team, { ...personal, created_at: after }), 'team');
    assert.equal(source({ ...personal, created_at: after }), null);
    assert.equal(source({ ...personal, event: 'review_request_removed' }), null);
    assert.equal(source({ ...team, requested_team: { name: 'Backend', slug: 'backend' } }), null);
});
