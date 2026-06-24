import React from 'react';
import { Box, Chip, Tooltip } from '@mui/material';
import {
    CheckCircle,
    ChangeCircle,
    HourglassEmpty,
    EditNote,
    CallSplit,
    SyncProblem,
    ErrorOutline,
} from '@mui/icons-material';
import type { PRStatus } from '../api/pullStatus';

type ChipColor = 'default' | 'success' | 'warning' | 'error' | 'info';

// Headline chip = the review/lifecycle state (what the team asked for).
function getHeadline(s: PRStatus): { label: string; color: ChipColor; icon: React.ReactElement } {
    if (s.isDraft) {
        return { label: 'Draft', color: 'default', icon: <EditNote fontSize="small" /> };
    }
    if (s.reviewDecision === 'CHANGES_REQUESTED') {
        return { label: 'Changes requested', color: 'error', icon: <ChangeCircle fontSize="small" /> };
    }
    if (s.reviewDecision === 'REVIEW_REQUIRED') {
        return { label: 'Needs approval', color: 'warning', icon: <HourglassEmpty fontSize="small" /> };
    }
    // APPROVED or null (no required reviews). Only call it "Ready to merge" when
    // it's mechanically clean AND has at least one approval — some repos have no
    // required-review rule, so CLEAN alone can be true with zero approvals.
    const hasApproval = s.reviewDecision === 'APPROVED' || s.approvedCount > 0;
    if (s.mergeStateStatus === 'CLEAN' && hasApproval) {
        return { label: 'Ready to merge', color: 'success', icon: <CheckCircle fontSize="small" /> };
    }
    if (s.reviewDecision === 'APPROVED') {
        return { label: 'Approved', color: 'info', icon: <CheckCircle fontSize="small" /> };
    }
    return { label: 'Open', color: 'default', icon: <HourglassEmpty fontSize="small" /> };
}

// Orthogonal mergeability problems, shown as small trailing icons so the single
// column never hides a secondary blocker.
interface Condition {
    key: string;
    title: string;
    icon: React.ReactElement;
    color: string;
}

function getConditions(s: PRStatus): Condition[] {
    const out: Condition[] = [];
    if (s.mergeable === 'CONFLICTING' || s.mergeStateStatus === 'DIRTY') {
        out.push({ key: 'conflict', title: 'Merge conflicts', icon: <CallSplit fontSize="inherit" />, color: 'error.main' });
    }
    if (s.checks === 'FAILURE' || s.checks === 'ERROR') {
        out.push({ key: 'checks', title: 'Checks failing', icon: <ErrorOutline fontSize="inherit" />, color: 'error.main' });
    }
    if (s.mergeStateStatus === 'BEHIND') {
        out.push({ key: 'behind', title: 'Behind base branch', icon: <SyncProblem fontSize="inherit" />, color: 'warning.main' });
    }
    return out;
}

export const PRStatusBadge: React.FC<{ status?: PRStatus }> = ({ status }) => {
    if (!status) {
        return <Box component="span" sx={{ color: 'text.disabled' }}>—</Box>;
    }

    const headline = getHeadline(status);
    const conditions = getConditions(status);

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Chip
                icon={headline.icon}
                label={headline.label}
                color={headline.color}
                size="small"
                variant="outlined"
                sx={{ fontWeight: 500 }}
            />
            {conditions.map((c) => (
                <Tooltip key={c.key} title={c.title} arrow>
                    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', color: c.color, fontSize: 18 }}>
                        {c.icon}
                    </Box>
                </Tooltip>
            ))}
        </Box>
    );
};
