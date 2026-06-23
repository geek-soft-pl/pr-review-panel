import { useState, useEffect, useCallback } from 'react';
import { githubClient } from '../api/githubClient';
import { fetchCurrentUser } from '../api/user';
import type { GitHubUser } from '../api/user';

const TOKEN_SESSION_KEY = 'github_pr_panel_token';
const TOKEN_LOCAL_KEY = 'github_pr_panel_token_local';
const USER_CACHE_KEY = 'github_pr_panel_user';

export type StorageType = 'session' | 'local';

function getStoredToken(): { token: string; storageType: StorageType } {
    // Priority: localStorage > sessionStorage
    const localToken = localStorage.getItem(TOKEN_LOCAL_KEY);
    if (localToken) {
        return { token: localToken, storageType: 'local' };
    }

    const sessionToken = sessionStorage.getItem(TOKEN_SESSION_KEY);
    if (sessionToken) {
        return { token: sessionToken, storageType: 'session' };
    }

    return { token: '', storageType: 'session' };
}

export function useToken() {
    // Read persisted token synchronously on first render: storage is available
    // immediately, so there's no flash and no setState-in-effect.
    const [auth, setAuth] = useState<{ token: string; storageType: StorageType }>(getStoredToken);
    const { token, storageType } = auth;

    // Keep the API client's token in sync with React state (external system).
    useEffect(() => {
        githubClient.setToken(token);
    }, [token]);

    const setToken = useCallback((newToken: string, persist: boolean = false) => {
        // Clear old storage
        localStorage.removeItem(TOKEN_LOCAL_KEY);
        sessionStorage.removeItem(TOKEN_SESSION_KEY);
        sessionStorage.removeItem(USER_CACHE_KEY);

        if (newToken) {
            if (persist) {
                localStorage.setItem(TOKEN_LOCAL_KEY, newToken);
            } else {
                sessionStorage.setItem(TOKEN_SESSION_KEY, newToken);
            }
        }

        setAuth({ token: newToken, storageType: persist ? 'local' : 'session' });
    }, []);

    const clearToken = useCallback(() => {
        localStorage.removeItem(TOKEN_LOCAL_KEY);
        sessionStorage.removeItem(TOKEN_SESSION_KEY);
        sessionStorage.removeItem(USER_CACHE_KEY);
        setAuth({ token: '', storageType: 'session' });
    }, []);

    return { token, setToken, clearToken, storageType };
}

export function useCurrentUser(token: string) {
    const [user, setUser] = useState<GitHubUser | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchUser = useCallback(async () => {
        if (!token) {
            setUser(null);
            setError(null);
            return;
        }

        // Check cache
        const cached = sessionStorage.getItem(USER_CACHE_KEY);
        if (cached) {
            try {
                const parsedUser = JSON.parse(cached);
                setUser(parsedUser);
                setError(null);
                return;
            } catch {
                // Invalid cache, continue to fetch
            }
        }

        setLoading(true);
        setError(null);

        try {
            const userData = await fetchCurrentUser();
            setUser(userData);
            sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(userData));
        } catch (err) {
            const errorObj = err as { status?: number; message?: string };
            if (errorObj.status === 401) {
                setError('Invalid or expired token');
            } else if (errorObj.status === 403) {
                setError('Token lacks permissions or rate limited');
            } else {
                setError(errorObj.message || 'Failed to fetch user');
            }
            setUser(null);
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        fetchUser();
    }, [fetchUser]);

    return { user, loading, error, refetch: fetchUser };
}
