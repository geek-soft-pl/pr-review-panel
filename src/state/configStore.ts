import { useState, useEffect, useCallback } from 'react';

const ORGS_SESSION_KEY = 'github_pr_panel_orgs';
const ORGS_LOCAL_KEY = 'github_pr_panel_orgs_local';
const HISTORY_KEY = 'github_pr_panel_history_days';

function getEnvOrgs(): string[] {
    const envOrgs = import.meta.env.VITE_GITHUB_ORGS;
    if (envOrgs) {
        return envOrgs.split(',').map((o: string) => o.trim()).filter(Boolean);
    }
    return [];
}

function getStoredOrgs(): string[] {
    const localOrgs = localStorage.getItem(ORGS_LOCAL_KEY);
    if (localOrgs) {
        try {
            return JSON.parse(localOrgs);
        } catch {
            // Invalid JSON
        }
    }

    const sessionOrgs = sessionStorage.getItem(ORGS_SESSION_KEY);
    if (sessionOrgs) {
        try {
            return JSON.parse(sessionOrgs);
        } catch {
            // Invalid JSON
        }
    }

    return getEnvOrgs();
}

export function useOrganizations() {
    const [orgs, setOrgsState] = useState<string[]>([]);
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        const storedOrgs = getStoredOrgs();
        setOrgsState(storedOrgs);
        setIsLoaded(true);
    }, []);

    const setOrgs = useCallback((newOrgs: string[], persist: boolean = false) => {
        const filtered = newOrgs.filter(Boolean);
        setOrgsState(filtered);

        localStorage.removeItem(ORGS_LOCAL_KEY);
        sessionStorage.removeItem(ORGS_SESSION_KEY);

        if (filtered.length > 0) {
            if (persist) {
                localStorage.setItem(ORGS_LOCAL_KEY, JSON.stringify(filtered));
            } else {
                sessionStorage.setItem(ORGS_SESSION_KEY, JSON.stringify(filtered));
            }
        }
    }, []);

    const addOrg = useCallback((org: string, persist: boolean = false) => {
        setOrgsState((prev) => {
            if (prev.includes(org)) return prev;
            const newOrgs = [...prev, org];
            if (persist) {
                localStorage.setItem(ORGS_LOCAL_KEY, JSON.stringify(newOrgs));
            } else {
                sessionStorage.setItem(ORGS_SESSION_KEY, JSON.stringify(newOrgs));
            }
            return newOrgs;
        });
    }, []);

    const removeOrg = useCallback((org: string) => {
        setOrgsState((prev) => {
            const newOrgs = prev.filter((o) => o !== org);
            // Re-save to current storage
            const localOrgs = localStorage.getItem(ORGS_LOCAL_KEY);
            if (localOrgs) {
                localStorage.setItem(ORGS_LOCAL_KEY, JSON.stringify(newOrgs));
            } else {
                sessionStorage.setItem(ORGS_SESSION_KEY, JSON.stringify(newOrgs));
            }
            return newOrgs;
        });
    }, []);

    return { orgs, setOrgs, addOrg, removeOrg, isLoaded };
}

export function useHistoryWindow() {
    const [days, setDaysState] = useState(30);

    useEffect(() => {
        const stored = sessionStorage.getItem(HISTORY_KEY);
        if (stored) {
            const parsed = parseInt(stored, 10);
            if (!isNaN(parsed) && parsed > 0) {
                setDaysState(parsed);
            }
        }
    }, []);

    const setDays = useCallback((newDays: number) => {
        setDaysState(newDays);
        sessionStorage.setItem(HISTORY_KEY, String(newDays));
    }, []);

    return { days, setDays };
}
