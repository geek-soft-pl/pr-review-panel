import React from 'react';
import { Chip, Tooltip } from '@mui/material';
import {
    CheckCircle,
    ChangeCircle,
    RadioButtonUnchecked,
    Comment,
} from '@mui/icons-material';
import type { ReviewState } from '../api/reviews';

interface ReviewBadgeProps {
    state?: ReviewState;
    submittedAt?: string | null;
}

export const ReviewBadge: React.FC<ReviewBadgeProps> = ({ state, submittedAt }) => {
    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const getConfig = () => {
        switch (state) {
            case 'APPROVED':
                return {
                    label: 'Approved',
                    color: 'success' as const,
                    icon: <CheckCircle fontSize="small" />,
                };
            case 'CHANGES_REQUESTED':
                return {
                    label: 'Changes Requested',
                    color: 'warning' as const,
                    icon: <ChangeCircle fontSize="small" />,
                };
            case 'COMMENTED':
                return {
                    label: 'Commented',
                    color: 'info' as const,
                    icon: <Comment fontSize="small" />,
                };
            case 'PENDING':
                return {
                    label: 'Pending',
                    color: 'default' as const,
                    icon: <RadioButtonUnchecked fontSize="small" />,
                };
            default:
                return {
                    label: 'Not Reviewed',
                    color: 'default' as const,
                    icon: <RadioButtonUnchecked fontSize="small" />,
                };
        }
    };

    const config = getConfig();
    const tooltipText = submittedAt
        ? `Last action: ${formatDate(submittedAt)}`
        : 'No review submitted';

    return (
        <Tooltip title={tooltipText} arrow>
            <Chip
                icon={config.icon}
                label={config.label}
                color={config.color}
                size="small"
                variant="outlined"
                sx={{ fontWeight: 500 }}
            />
        </Tooltip>
    );
};
