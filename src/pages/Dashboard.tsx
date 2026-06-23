import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
    Box,
    Tabs,
    Tab,
    Button,
    Alert,
    CircularProgress,
    Typography,
    LinearProgress,
    Badge,
    Autocomplete,
    Checkbox,
    TextField,
    Accordion,
    AccordionSummary,
    AccordionDetails,
    Snackbar,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
} from '@mui/material';
import { Refresh, RateReview, History, AccessTime, ExpandMore, VisibilityOff, ThumbUp, AccountCircle } from '@mui/icons-material';
import FormControlLabel from '@mui/material/FormControlLabel';
import { PRTable } from '../components/PRTable';
import type { PRItem } from '../components/PRTable';
import { searchOpenPRsForReview, searchMergedPRs, searchMyOpenPRs } from '../api/search';
import type { ParsedPR } from '../api/search';
import { fetchPRReviews, computeMyReviewState, submitReview, fetchPRDetails, computeAllReviewersState } from '../api/reviews';
import type { ReviewStateInfo } from '../api/reviews';
import { fetchTimeline, wasReviewRequestedForMe } from '../api/timeline';
import { fetchUserTeamsForOrg } from '../api/user';
import type { GitHubError } from '../api/githubClient';
import { useHiddenPRs } from '../state/hiddenStore';

interface DashboardProps {
    userLogin: string;
    org: string;
    historyDays: number;
}

interface TabPanelProps {
    children?: React.ReactNode;
    index: number;
    value: number;
}

function TabPanel(props: TabPanelProps) {
    const { children, value, index, ...other } = props;
    return (
        <div hidden={value !== index} {...other}>
            {value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
        </div>
    );
}

// Request queue for rate limiting
class RequestQueue {
    private queue: (() => Promise<void>)[] = [];
    private running = 0;
    private maxConcurrent: number;

    constructor(maxConcurrent = 5) {
        this.maxConcurrent = maxConcurrent;
    }

    async add<T>(fn: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.queue.push(async () => {
                try {
                    const result = await fn();
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            });
            this.processQueue();
        });
    }

    private async processQueue() {
        if (this.running >= this.maxConcurrent || this.queue.length === 0) return;

        this.running++;
        const task = this.queue.shift()!;
        try {
            await task();
        } finally {
            this.running--;
            this.processQueue();
        }
    }
}

// Cache for reviews and timeline
const reviewCache = new Map<string, { data: ReviewStateInfo; timestamp: number }>();
const timelineCache = new Map<string, { data: boolean; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const SELECTED_REPOS_STORAGE_KEY_PREFIX = 'github_pr_panel_selected_repos';

const getSelectedReposStorageKey = (org: string, userLogin: string) =>
    `${SELECTED_REPOS_STORAGE_KEY_PREFIX}:${org}:${userLogin.toLowerCase()}`;

const loadSelectedRepos = (storageKey: string): string[] => {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];

    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((item): item is string => typeof item === 'string');
    } catch {
        return [];
    }
};

// Format time for display
const formatTime = (date: Date) => {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
};

export const Dashboard: React.FC<DashboardProps> = ({
    userLogin,
    org,
    historyDays,
}) => {
    const [tabValue, setTabValue] = useState(0);
    const [myOpenPRs, setMyOpenPRs] = useState<PRItem[]>([]);
    const [openPRs, setOpenPRs] = useState<PRItem[]>([]);
    const [historicalPRs, setHistoricalPRs] = useState<PRItem[]>([]);
    const [loadingMyOpen, setLoadingMyOpen] = useState(false);
    const [loadingOpen, setLoadingOpen] = useState(false);
    const [loadingHistorical, setLoadingHistorical] = useState(false);
    const [progressMyOpen, setProgressMyOpen] = useState(0);
    const [progressOpen, setProgressOpen] = useState(0);
    const [progressHistorical, setProgressHistorical] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [historicalLoaded, setHistoricalLoaded] = useState(false);
    const [myOpenRefreshTime, setMyOpenRefreshTime] = useState<Date | null>(null);
    const [openRefreshTime, setOpenRefreshTime] = useState<Date | null>(null);
    const [historicalRefreshTime, setHistoricalRefreshTime] = useState<Date | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [approveDialogOpen, setApproveDialogOpen] = useState(false);
    const [prToApprove, setPrToApprove] = useState<PRItem | null>(null);
    const [approving, setApproving] = useState(false);
    const [hideApprovedOpen, setHideApprovedOpen] = useState(false);

    // Merged PRs before filtering per-repo
    const [allMergedPRs, setAllMergedPRs] = useState<ParsedPR[]>([]);
    const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
    const [selectedReposInitialized, setSelectedReposInitialized] = useState(false);
    const [processingRepos, setProcessingRepos] = useState(false);
    const [latestMergedFetchTime, setLatestMergedFetchTime] = useState<Date | null>(null);

    const [teamSlugs, setTeamSlugs] = useState<string[]>([]);
    const [teamsLoaded, setTeamsLoaded] = useState(false);

    const { hidePR, unhidePR, isHidden } = useHiddenPRs();

    // Generation guards: a newer fetch always wins, so a slow in-flight request
    // (e.g. from the 30-min auto-refresh) can't overwrite fresher results.
    const myOpenReqId = useRef(0);
    const openReqId = useRef(0);
    const selectedReposStorageKey = useMemo(
        () => getSelectedReposStorageKey(org, userLogin),
        [org, userLogin]
    );

    // Get unique repos from merged PRs
    const availableRepos = useMemo(() => {
        const repos = new Set<string>();
        allMergedPRs.forEach(pr => {
            const repoName = pr.repoFullName.split('/')[1] || pr.repoFullName;
            repos.add(repoName);
        });
        return Array.from(repos).sort();
    }, [allMergedPRs]);

    // Filter visible and hidden PRs
    const { visiblePRs, hiddenPRs } = useMemo(() => {
        const visible: PRItem[] = [];
        const hidden: PRItem[] = [];

        historicalPRs.forEach(pr => {
            if (isHidden(pr.id)) {
                hidden.push(pr);
            } else {
                visible.push(pr);
            }
        });

        return { visiblePRs: visible, hiddenPRs: hidden };
    }, [historicalPRs, isHidden]);

    // Filter open PRs based on hideApprovedOpen setting
    const filteredOpenPRs = useMemo(() => {
        if (!hideApprovedOpen) return openPRs;
        return openPRs.filter(pr => pr.reviewState !== 'APPROVED');
    }, [openPRs, hideApprovedOpen]);

    useEffect(() => {
        const savedRepos = loadSelectedRepos(selectedReposStorageKey);
        setSelectedRepos(savedRepos);
        setSelectedReposInitialized(true);
    }, [selectedReposStorageKey]);

    useEffect(() => {
        if (!selectedReposInitialized) return;
        localStorage.setItem(selectedReposStorageKey, JSON.stringify(selectedRepos));
    }, [selectedRepos, selectedReposStorageKey, selectedReposInitialized]);

    useEffect(() => {
        if (availableRepos.length === 0) return;
        setSelectedRepos(prev => prev.filter(repo => availableRepos.includes(repo)));
    }, [availableRepos]);

    // Drop cached review/timeline data when the signed-in user changes, so we
    // never show another account's review state from the module-level cache.
    useEffect(() => {
        reviewCache.clear();
        timelineCache.clear();
    }, [userLogin]);

    // Fetch the user's teams in the org on mount. The initial PR fetch is gated
    // on this (see the auto-fetch effect) so "To Review" is queried once, already
    // knowing the team slugs — instead of firing with no teams and again on load.
    useEffect(() => {
        let active = true;
        fetchUserTeamsForOrg(org)
            .then((teams) => {
                if (!active) return;
                setTeamSlugs(teams.map((t) => t.slug));
                setTeamsLoaded(true);
            })
            .catch((err) => {
                console.error('Failed to fetch user teams:', err);
                if (active) setTeamsLoaded(true);
            });
        return () => {
            active = false;
        };
    }, [org]);

    const fetchReviewState = useCallback(
        async (pr: ParsedPR, queue: RequestQueue): Promise<ReviewStateInfo> => {
            const cacheKey = `${pr.htmlUrl}/reviews`;
            const cached = reviewCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
                return cached.data;
            }

            const reviews = await queue.add(() =>
                fetchPRReviews(pr.owner, pr.repo, pr.number)
            );
            const state = computeMyReviewState(reviews, userLogin);
            reviewCache.set(cacheKey, { data: state, timestamp: Date.now() });
            return state;
        },
        [userLogin]
    );

    const checkReviewRequested = useCallback(
        async (pr: ParsedPR, queue: RequestQueue): Promise<boolean> => {
            const cacheKey = `${pr.htmlUrl}/timeline`;
            const cached = timelineCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
                return cached.data;
            }

            const events = await queue.add(() =>
                fetchTimeline(pr.owner, pr.repo, pr.number)
            );
            const wasRequested = wasReviewRequestedForMe(events, userLogin, teamSlugs);
            timelineCache.set(cacheKey, { data: wasRequested, timestamp: Date.now() });
            return wasRequested;
        },
        [userLogin, teamSlugs]
    );

    // Fetch my open PRs (authored by me)
    const fetchMyOpenPRs = useCallback(async () => {
        const reqId = ++myOpenReqId.current;
        setLoadingMyOpen(true);
        setError(null);
        setProgressMyOpen(0);

        const queue = new RequestQueue(5);

        try {
            const myPRsRaw = await searchMyOpenPRs([org], userLogin);
            setProgressMyOpen(30);

            const myPRsFormatted: PRItem[] = [];
            for (let i = 0; i < myPRsRaw.length; i++) {
                const pr = myPRsRaw[i];
                try {
                    // Fetch PR details to get requested_reviewers
                    const [details, reviews] = await Promise.all([
                        queue.add(() => fetchPRDetails(pr.owner, pr.repo, pr.number)),
                        queue.add(() => fetchPRReviews(pr.owner, pr.repo, pr.number)),
                    ]);

                    const reviewers = computeAllReviewersState(reviews, details.requested_reviewers)
                        .filter(reviewer => reviewer.login.toLowerCase() !== pr.author.toLowerCase());

                    myPRsFormatted.push({
                        id: pr.id,
                        number: pr.number,
                        title: pr.title,
                        author: pr.author,
                        authorAvatar: pr.authorAvatar,
                        repoFullName: pr.repoFullName,
                        htmlUrl: pr.htmlUrl,
                        updatedAt: pr.updatedAt,
                        reviewers,
                    });
                } catch (err) {
                    console.error(`Error fetching reviewers for ${pr.htmlUrl}:`, err);
                    // Still add the PR without reviewers
                    myPRsFormatted.push({
                        id: pr.id,
                        number: pr.number,
                        title: pr.title,
                        author: pr.author,
                        authorAvatar: pr.authorAvatar,
                        repoFullName: pr.repoFullName,
                        htmlUrl: pr.htmlUrl,
                        updatedAt: pr.updatedAt,
                    });
                }
                setProgressMyOpen(30 + ((i + 1) / myPRsRaw.length) * 70);
            }

            if (reqId !== myOpenReqId.current) return; // superseded by a newer refresh
            setMyOpenPRs(myPRsFormatted);
            setMyOpenRefreshTime(new Date());
        } catch (err) {
            if (reqId === myOpenReqId.current) handleError(err);
        } finally {
            if (reqId === myOpenReqId.current) setLoadingMyOpen(false);
        }
    }, [org, userLogin]);

    // Fetch open PRs
    const fetchOpenPRs = useCallback(async () => {
        const reqId = ++openReqId.current;
        setLoadingOpen(true);
        setError(null);
        setProgressOpen(0);

        const queue = new RequestQueue(5);

        try {
            const openPRsRaw = await searchOpenPRsForReview([org], userLogin, teamSlugs);
            setProgressOpen(30);

            const openPRsWithReviews: PRItem[] = [];
            for (let i = 0; i < openPRsRaw.length; i++) {
                const pr = openPRsRaw[i];
                try {
                    const reviewState = await fetchReviewState(pr, queue);
                    openPRsWithReviews.push({
                        id: pr.id,
                        number: pr.number,
                        title: pr.title,
                        author: pr.author,
                        authorAvatar: pr.authorAvatar,
                        repoFullName: pr.repoFullName,
                        htmlUrl: pr.htmlUrl,
                        updatedAt: pr.updatedAt,
                        reviewState: reviewState.state,
                        reviewSubmittedAt: reviewState.submittedAt,
                    });
                } catch (err) {
                    console.error(`Error fetching reviews for ${pr.htmlUrl}:`, err);
                }
                setProgressOpen(30 + ((i + 1) / openPRsRaw.length) * 70);
            }
            if (reqId !== openReqId.current) return; // superseded by a newer refresh
            setOpenPRs(openPRsWithReviews);
            setOpenRefreshTime(new Date());
        } catch (err) {
            if (reqId === openReqId.current) handleError(err);
        } finally {
            if (reqId === openReqId.current) setLoadingOpen(false);
        }
    }, [org, userLogin, teamSlugs, fetchReviewState]);

    // Step 1: Fetch merged PRs list (fast, no per-PR requests)
    const fetchMergedPRsList = useCallback(async () => {
        setLoadingHistorical(true);
        setProgressHistorical(0);
        setError(null);

        try {
            // If we have loaded before, fetch delta. Otherwise full range.
            let since: number | Date = historyDays;
            if (historicalLoaded && latestMergedFetchTime) {
                since = latestMergedFetchTime;
            }

            const mergedPRsRaw = await searchMergedPRs([org], since);

            if (since instanceof Date) {
                // Delta update: append new PRs, updating duplicates
                setAllMergedPRs(prev => {
                    const newIds = new Set(mergedPRsRaw.map(p => p.id));
                    // Keep existing ones that are NOT in the new batch
                    const existing = prev.filter(p => !newIds.has(p.id));
                    // Append new batch
                    return [...existing, ...mergedPRsRaw];
                });
            } else {
                // Full reload
                setAllMergedPRs(mergedPRsRaw);
            }

            setLatestMergedFetchTime(new Date());
            setProgressHistorical(100);
            setHistoricalLoaded(true);
            setHistoricalRefreshTime(new Date());
        } catch (err) {
            handleError(err);
        } finally {
            setLoadingHistorical(false);
        }
    }, [org, historyDays, historicalLoaded, latestMergedFetchTime]);

    // Step 2: Process selected repos (per-PR requests only for selected repos)
    const processSelectedRepos = useCallback(async () => {
        if (selectedRepos.length === 0) {
            setHistoricalPRs([]);
            return;
        }

        setProcessingRepos(true);
        setProgressHistorical(0);

        const queue = new RequestQueue(5);

        // Filter to selected repos only
        const filteredPRs = allMergedPRs.filter(pr => {
            const repoName = pr.repoFullName.split('/')[1] || pr.repoFullName;
            return selectedRepos.includes(repoName);
        });

        const historicalFiltered: PRItem[] = [];
        const totalFiltered = filteredPRs.length;

        for (let i = 0; i < totalFiltered; i++) {
            const pr = filteredPRs[i];

            try {
                const wasRequested = await checkReviewRequested(pr, queue);
                if (!wasRequested) continue;

                // Skip check for APPROVED state here to allow re-approving if needed,
                // or keep it to only show missing approvals. 
                // The requirement is "Missing Approve", so we only want those NOT APPROVED.
                const reviewState = await fetchReviewState(pr, queue);
                if (reviewState.state === 'APPROVED') continue;

                historicalFiltered.push({
                    id: pr.id,
                    number: pr.number,
                    title: pr.title,
                    author: pr.author,
                    authorAvatar: pr.authorAvatar,
                    repoFullName: pr.repoFullName,
                    htmlUrl: pr.htmlUrl,
                    updatedAt: pr.updatedAt,
                    mergedAt: pr.mergedAt,
                    closedAt: pr.closedAt,
                    reviewState: reviewState.state,
                    reviewSubmittedAt: reviewState.submittedAt,
                });
            } catch (err) {
                console.error(`Error processing ${pr.htmlUrl}:`, err);
            }

            setProgressHistorical(((i + 1) / totalFiltered) * 100);
        }

        setHistoricalPRs(historicalFiltered);
        setProcessingRepos(false);
    }, [allMergedPRs, selectedRepos, checkReviewRequested, fetchReviewState]);

    const handleApprove = (pr: PRItem) => {
        setPrToApprove(pr);
        setApproveDialogOpen(true);
    };

    const handleConfirmApprove = async () => {
        if (!prToApprove) return;

        setApproving(true);
        try {
            const [owner, repo] = prToApprove.repoFullName.split('/');
            await submitReview(owner, repo, prToApprove.number, 'APPROVE');

            // Hide the PR from the list since it's now approved
            hidePR(prToApprove.id);

            setSuccessMessage(`Approved PR #${prToApprove.number}`);
            setApproveDialogOpen(false);
            setPrToApprove(null);
        } catch (err) {
            handleError(err);
        } finally {
            setApproving(false);
        }
    };

    const handleCloseApproveDialog = () => {
        if (!approving) {
            setApproveDialogOpen(false);
            setPrToApprove(null);
        }
    };

    const handleError = (err: unknown) => {
        const error = err as GitHubError;
        if (error.isRateLimit && error.rateLimitReset) {
            setError(`Rate limit exceeded. Resets at ${error.rateLimitReset.toLocaleTimeString()}`);
        } else if (error.status === 401) {
            setError('Invalid or expired token. Please update your GitHub token.');
        } else if (error.status === 403) {
            setError('Token lacks permissions or access to this organization.');
        } else {
            setError(error.message || 'An error occurred while fetching data.');
        }
    };

    // Auto-fetch on mount (once teams resolve) and every 30 minutes. Gating on
    // teamsLoaded avoids a duplicate "To Review" fetch on first load: without it,
    // fetchOpenPRs would run once with no teams, then again when teamSlugs arrive.
    useEffect(() => {
        if (!teamsLoaded) return;
        fetchMyOpenPRs();
        fetchOpenPRs();
        const intervalId = setInterval(() => {
            fetchMyOpenPRs();
            fetchOpenPRs();
        }, 30 * 60 * 1000);
        return () => clearInterval(intervalId);
    }, [teamsLoaded, fetchMyOpenPRs, fetchOpenPRs]);

    // Lazy load merged PRs list when tab is switched
    const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
        setTabValue(newValue);
        if (newValue === 2 && !historicalLoaded && !loadingHistorical) {
            fetchMergedPRsList();
        }
    };

    // Refresh current tab
    const handleRefresh = () => {
        if (tabValue === 0) {
            fetchMyOpenPRs();
        } else if (tabValue === 1) {
            fetchOpenPRs();
        } else {
            // Missing Approve: fetch only newly-merged PRs since the last load
            // (delta) to keep the request count low. Review statuses for the
            // selected repos are refreshed separately via "Load Reviews".
            fetchMergedPRsList();
        }
    };

    const isLoading = loadingMyOpen || loadingOpen || loadingHistorical || processingRepos;

    return (
        <Box>
            <Snackbar
                open={!!successMessage}
                autoHideDuration={4000}
                onClose={() => setSuccessMessage(null)}
                message={successMessage}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            />

            {/* Header with refresh button */}
            <Box
                sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    mb: 2,
                }}
            >
                <Typography variant="h6">
                    Pull Requests for <strong>@{userLogin}</strong> in <code>{org}</code>
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    {((tabValue === 0 && myOpenRefreshTime) || (tabValue === 1 && openRefreshTime) || (tabValue === 2 && historicalRefreshTime)) && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <AccessTime fontSize="small" color="action" />
                            <Typography variant="body2" color="text.secondary">
                                {formatTime(tabValue === 0 ? myOpenRefreshTime! : tabValue === 1 ? openRefreshTime! : historicalRefreshTime!)}
                            </Typography>
                        </Box>
                    )}
                    <Button
                        variant="contained"
                        startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <Refresh />}
                        onClick={handleRefresh}
                        disabled={isLoading}
                    >
                        {isLoading ? 'Loading...' : 'Refresh'}
                    </Button>
                </Box>
            </Box>

            {/* Progress bar */}
            {loadingMyOpen && (
                <Box sx={{ mb: 2 }}>
                    <LinearProgress variant="determinate" value={progressMyOpen} />
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                        Fetching my open PRs...
                    </Typography>
                </Box>
            )}

            {loadingOpen && (
                <Box sx={{ mb: 2 }}>
                    <LinearProgress variant="determinate" value={progressOpen} />
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                        Fetching open PRs for review...
                    </Typography>
                </Box>
            )}

            {(loadingHistorical || processingRepos) && (
                <Box sx={{ mb: 2 }}>
                    <LinearProgress variant="determinate" value={progressHistorical} />
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                        {loadingHistorical ? 'Fetching merged PRs list...' : 'Checking review history for selected repos...'}
                    </Typography>
                </Box>
            )}

            {/* Error display */}
            {error && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                    {error}
                </Alert>
            )}

            {/* Tabs */}
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                <Tabs value={tabValue} onChange={handleTabChange}>
                    <Tab
                        icon={
                            <Badge badgeContent={myOpenPRs.length} color="success" max={99}>
                                <AccountCircle />
                            </Badge>
                        }
                        iconPosition="start"
                        label="My Open PRs"
                    />
                    <Tab
                        icon={
                            <Badge badgeContent={openPRs.length} color="primary" max={99}>
                                <RateReview />
                            </Badge>
                        }
                        iconPosition="start"
                        label="To Review (Open)"
                    />
                    <Tab
                        icon={
                            <Badge badgeContent={historicalLoaded ? visiblePRs.length : '?'} color="warning" max={99}>
                                <History />
                            </Badge>
                        }
                        iconPosition="start"
                        label={`Missing Approve (last ${historyDays}d)`}
                    />
                </Tabs>
            </Box>

            {/* Tab panels */}
            <TabPanel value={tabValue} index={0}>
                <PRTable items={myOpenPRs} loading={loadingMyOpen} showReviewColumn={false} showReviewersColumn={true} />
            </TabPanel>

            <TabPanel value={tabValue} index={1}>
                <PRTable items={filteredOpenPRs} loading={loadingOpen} />
                {!loadingOpen && openPRs.length > 0 && (
                    <Box sx={{ mt: 2 }}>
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={hideApprovedOpen}
                                    onChange={(e) => setHideApprovedOpen(e.target.checked)}
                                    size="small"
                                />
                            }
                            label={
                                <Typography variant="body2" color="text.secondary">
                                    Hide approved ({openPRs.filter(pr => pr.reviewState === 'APPROVED').length})
                                </Typography>
                            }
                        />
                    </Box>
                )}
            </TabPanel>

            <TabPanel value={tabValue} index={2}>
                {!historicalLoaded && !loadingHistorical ? (
                    <Alert severity="info" sx={{ mt: 2 }}>
                        Click on this tab to load merged PRs that are missing your approval.
                    </Alert>
                ) : (
                    <Box>
                        {/* Repo filter */}
                        <Box sx={{ mb: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                            <Autocomplete
                                multiple
                                disableCloseOnSelect
                                options={availableRepos}
                                value={selectedRepos}
                                onChange={(_, value) => setSelectedRepos(value)}
                                disabled={loadingHistorical || processingRepos}
                                size="small"
                                sx={{ minWidth: 300, maxWidth: 500, flex: 1 }}
                                renderOption={(props, option, { selected }) => (
                                    <li {...props}>
                                        <Checkbox size="small" checked={selected} sx={{ mr: 1 }} />
                                        {option}
                                    </li>
                                )}
                                renderInput={(params) => (
                                    <TextField
                                        {...params}
                                        label="Select Repositories"
                                        placeholder="Type to search repositories"
                                    />
                                )}
                            />

                            <Button
                                variant="outlined"
                                onClick={processSelectedRepos}
                                disabled={selectedRepos.length === 0 || processingRepos}
                                size="small"
                            >
                                Load Reviews ({selectedRepos.length} repos)
                            </Button>

                            <Typography variant="body2" color="text.secondary">
                                {allMergedPRs.length} merged PRs in {availableRepos.length} repos
                            </Typography>
                        </Box>

                        {selectedRepos.length === 0 && !processingRepos && (
                            <Alert severity="info">
                                Select repositories above and click "Load Reviews" to check for missing approvals.
                                This helps reduce API requests by only checking repos you care about.
                            </Alert>
                        )}

                        {(selectedRepos.length > 0 || processingRepos) && (
                            <>
                                <PRTable
                                    items={visiblePRs}
                                    loading={processingRepos}
                                    showMergedDate
                                    onHide={hidePR}
                                    onApprove={handleApprove}
                                />

                                {hiddenPRs.length > 0 && !processingRepos && (
                                    <Box sx={{ mt: 3 }}>
                                        <Accordion>
                                            <AccordionSummary expandIcon={<ExpandMore />}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                    <VisibilityOff color="action" />
                                                    <Typography color="text.secondary">
                                                        Hidden PRs ({hiddenPRs.length})
                                                    </Typography>
                                                </Box>
                                            </AccordionSummary>
                                            <AccordionDetails>
                                                <PRTable
                                                    items={hiddenPRs}
                                                    loading={false}
                                                    showMergedDate
                                                    onUnhide={unhidePR}
                                                />
                                            </AccordionDetails>
                                        </Accordion>
                                    </Box>
                                )}
                            </>
                        )}
                    </Box>
                )}
            </TabPanel>

            <Dialog
                open={approveDialogOpen}
                onClose={handleCloseApproveDialog}
                aria-labelledby="alert-dialog-title"
                aria-describedby="alert-dialog-description"
            >
                <DialogTitle id="alert-dialog-title">
                    {"Approve Pull Request?"}
                </DialogTitle>
                <DialogContent>
                    <DialogContentText id="alert-dialog-description">
                        Are you sure you want to approve <strong>{prToApprove?.title}</strong> (#{prToApprove?.number}) in <strong>{prToApprove?.repoFullName}</strong>?
                        <br /><br />
                        This will submit an <strong>APPROVE</strong> review and hide this PR from your missing approvals list.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseApproveDialog} disabled={approving}>Cancel</Button>
                    <Button
                        onClick={handleConfirmApprove}
                        autoFocus
                        variant="contained"
                        color="success"
                        disabled={approving}
                        startIcon={approving ? <CircularProgress size={16} color="inherit" /> : <ThumbUp />}
                    >
                        {approving ? 'Approving...' : 'Approve'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};
