import React from 'react';
import {
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Link,
    Avatar,
    Box,
    Typography,
    Skeleton,
    TableSortLabel,
    Chip,
    IconButton,
    Tooltip,
} from '@mui/material';
import { OpenInNew, VisibilityOff, Visibility, ThumbUp } from '@mui/icons-material';
import { ReviewBadge } from './ReviewBadge';
import type { ReviewState, ReviewerInfo } from '../api/reviews';

export interface PRItem {
    id: number;
    number: number;
    title: string;
    author: string;
    authorAvatar: string;
    repoFullName: string;
    htmlUrl: string;
    updatedAt: string;
    mergedAt?: string | null;
    closedAt?: string | null;
    reviewState?: ReviewState;
    reviewSubmittedAt?: string | null;
    reviewers?: ReviewerInfo[];
}

interface PRTableProps {
    items: PRItem[];
    loading: boolean;
    showMergedDate?: boolean;
    showReviewColumn?: boolean;
    showReviewersColumn?: boolean;
    onHide?: (id: number) => void;
    onUnhide?: (id: number) => void;
    onApprove?: (pr: PRItem) => void;
}

type SortField = 'updatedAt' | 'repoFullName' | 'author';
type SortDirection = 'asc' | 'desc';

export const PRTable: React.FC<PRTableProps> = ({
    items,
    loading,
    showMergedDate = false,
    showReviewColumn = true,
    showReviewersColumn = false,
    onHide,
    onUnhide,
    onApprove,
}) => {
    const [sortField, setSortField] = React.useState<SortField>('updatedAt');
    const [sortDirection, setSortDirection] = React.useState<SortDirection>('desc');

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('desc');
        }
    };

    const sortedItems = React.useMemo(() => {
        return [...items].sort((a, b) => {
            let comparison = 0;
            switch (sortField) {
                case 'updatedAt':
                    comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
                    break;
                case 'repoFullName':
                    comparison = a.repoFullName.localeCompare(b.repoFullName);
                    break;
                case 'author':
                    comparison = a.author.localeCompare(b.author);
                    break;
            }
            return sortDirection === 'asc' ? comparison : -comparison;
        });
    }, [items, sortField, sortDirection]);

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const day = date.getDate();
        const month = date.toLocaleDateString('en-US', { month: 'long' });
        const year = date.getFullYear();
        return `${hours}:${minutes} ${day} ${month} ${year}`;
    };

    // Extract repo name without org prefix
    const getRepoName = (fullName: string) => {
        const parts = fullName.split('/');
        return parts.length > 1 ? parts[1] : fullName;
    };

    const showActions = !!onHide || !!onUnhide || !!onApprove;

    if (loading) {
        return (
            <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Repository</TableCell>
                            <TableCell>Title</TableCell>
                            <TableCell>Author</TableCell>
                            <TableCell>Updated</TableCell>
                            {showReviewColumn && <TableCell>My Review</TableCell>}
                            {showReviewersColumn && <TableCell>Reviewers</TableCell>}
                            <TableCell>Link</TableCell>
                            {showActions && <TableCell>Actions</TableCell>}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {[1, 2, 3, 4, 5].map((i) => (
                            <TableRow key={i}>
                                <TableCell><Skeleton width={120} /></TableCell>
                                <TableCell><Skeleton width={200} /></TableCell>
                                <TableCell><Skeleton width={100} /></TableCell>
                                <TableCell><Skeleton width={80} /></TableCell>
                                {showReviewColumn && <TableCell><Skeleton width={100} /></TableCell>}
                                {showReviewersColumn && <TableCell><Skeleton width={150} /></TableCell>}
                                <TableCell><Skeleton width={40} /></TableCell>
                                {showActions && <TableCell><Skeleton width={40} /></TableCell>}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        );
    }

    if (items.length === 0) {
        return (
            <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
                <Typography color="text.secondary">
                    No pull requests found.
                </Typography>
            </Paper>
        );
    }

    return (
        <TableContainer component={Paper} variant="outlined">
            <Table size="small">
                <TableHead>
                    <TableRow>
                        <TableCell>
                            <TableSortLabel
                                active={sortField === 'repoFullName'}
                                direction={sortField === 'repoFullName' ? sortDirection : 'asc'}
                                onClick={() => handleSort('repoFullName')}
                            >
                                Repository
                            </TableSortLabel>
                        </TableCell>
                        <TableCell>Title</TableCell>
                        <TableCell>
                            <TableSortLabel
                                active={sortField === 'author'}
                                direction={sortField === 'author' ? sortDirection : 'asc'}
                                onClick={() => handleSort('author')}
                            >
                                Author
                            </TableSortLabel>
                        </TableCell>
                        <TableCell>
                            <TableSortLabel
                                active={sortField === 'updatedAt'}
                                direction={sortField === 'updatedAt' ? sortDirection : 'desc'}
                                onClick={() => handleSort('updatedAt')}
                            >
                                {showMergedDate ? 'Merged' : 'Updated'}
                            </TableSortLabel>
                        </TableCell>
                        {showReviewColumn && <TableCell>My Review</TableCell>}
                        {showReviewersColumn && <TableCell>Reviewers</TableCell>}
                        <TableCell>Link</TableCell>
                        {showActions && <TableCell align="center">Actions</TableCell>}
                    </TableRow>
                </TableHead>
                <TableBody>
                    {sortedItems.map((pr) => (
                        <TableRow
                            key={pr.id}
                            hover
                            sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                        >
                            <TableCell>
                                <Chip
                                    label={getRepoName(pr.repoFullName)}
                                    size="small"
                                    variant="outlined"
                                    sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                                />
                            </TableCell>
                            <TableCell>
                                <Box sx={{ maxWidth: 350 }}>
                                    <Typography
                                        variant="body2"
                                        sx={{
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                        }}
                                        title={pr.title}
                                    >
                                        <Link
                                            href={pr.htmlUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            underline="hover"
                                            color="inherit"
                                        >
                                            #{pr.number} {pr.title}
                                        </Link>
                                    </Typography>
                                </Box>
                            </TableCell>
                            <TableCell>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Avatar src={pr.authorAvatar} sx={{ width: 20, height: 20 }} />
                                    <Typography variant="body2">{pr.author}</Typography>
                                </Box>
                            </TableCell>
                            <TableCell>
                                <Typography variant="body2" color="text.secondary">
                                    {formatDate(showMergedDate && pr.mergedAt ? pr.mergedAt : pr.updatedAt)}
                                </Typography>
                            </TableCell>
                            {showReviewColumn && (
                                <TableCell>
                                    <ReviewBadge
                                        state={pr.reviewState}
                                        submittedAt={pr.reviewSubmittedAt}
                                    />
                                </TableCell>
                            )}
                            {showReviewersColumn && (
                                <TableCell>
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                        {pr.reviewers && pr.reviewers.length > 0 ? (
                                            pr.reviewers.map((reviewer) => (
                                                <Tooltip
                                                    key={reviewer.login}
                                                    title={`${reviewer.login}: ${reviewer.state === 'APPROVED' ? 'Approved' : reviewer.state === 'CHANGES_REQUESTED' ? 'Changes Requested' : reviewer.state === 'COMMENTED' ? 'Commented' : 'Pending'}`}
                                                >
                                                    <Box
                                                        sx={{
                                                            position: 'relative',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            border: '2px solid',
                                                            borderColor: reviewer.state === 'APPROVED'
                                                                ? 'success.main'
                                                                : reviewer.state === 'CHANGES_REQUESTED'
                                                                ? 'warning.main'
                                                                : reviewer.state === 'COMMENTED'
                                                                ? 'info.main'
                                                                : 'grey.500',
                                                            borderRadius: '50%',
                                                            p: '2px',
                                                        }}
                                                    >
                                                        <Avatar
                                                            src={reviewer.avatarUrl}
                                                            sx={{ width: 24, height: 24 }}
                                                        >
                                                            {reviewer.login[0]?.toUpperCase()}
                                                        </Avatar>
                                                        {reviewer.state === 'APPROVED' && (
                                                            <Box
                                                                component="svg"
                                                                viewBox="0 0 8 8"
                                                                sx={{
                                                                    position: 'absolute',
                                                                    top: -2,
                                                                    right: -2,
                                                                    width: 12,
                                                                    height: 12,
                                                                }}
                                                            >
                                                                <circle fill="#00875A" cx="4" cy="4" r="4" />
                                                                <path
                                                                    fill="#FFFFFF"
                                                                    d="M2.47140452,3.52859548 C2.21105499,3.26824595 1.78894501,3.26824595 1.52859548,3.52859548 C1.26824595,3.78894501 1.26824595,4.21105499 1.52859548,4.47140452 L2.86192881,5.80473785 C3.12227834,6.06508738 3.54438833,6.06508738 3.80473785,5.80473785 L6.47140452,3.13807119 C6.73175405,2.87772166 6.73175405,2.45561167 6.47140452,2.19526215 C6.21105499,1.93491262 5.78894501,1.93491262 5.52859548,2.19526215 L3.33333333,4.39052429 L2.47140452,3.52859548 Z"
                                                                />
                                                            </Box>
                                                        )}
                                                    </Box>
                                                </Tooltip>
                                            ))
                                        ) : (
                                            <Typography variant="body2" color="text.secondary">
                                                -
                                            </Typography>
                                        )}
                                    </Box>
                                </TableCell>
                            )}
                            <TableCell>
                                <Link
                                    href={pr.htmlUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <OpenInNew fontSize="small" />
                                </Link>
                            </TableCell>
                            {showActions && (
                                <TableCell align="center">
                                    <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1 }}>
                                        {onApprove && (
                                            <Tooltip title="Approve PR">
                                                <IconButton
                                                    size="small"
                                                    color="success"
                                                    onClick={() => onApprove(pr)}
                                                >
                                                    <ThumbUp fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        )}
                                        {onHide && (
                                            <Tooltip title="Hide from list">
                                                <IconButton size="small" onClick={() => onHide(pr.id)}>
                                                    <VisibilityOff fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        )}
                                        {onUnhide && (
                                            <Tooltip title="Restore to list">
                                                <IconButton size="small" onClick={() => onUnhide(pr.id)}>
                                                    <Visibility fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        )}
                                    </Box>
                                </TableCell>
                            )}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </TableContainer>
    );
};
