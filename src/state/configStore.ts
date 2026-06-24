import { useState, useCallback } from 'react';

const HISTORY_KEY = 'github_pr_panel_history_days';

export function useHistoryWindow() {
    // Initialize synchronously from storage (avoids setState-in-effect).
    const [days, setDaysState] = useState<number>(() => {
        const stored = sessionStorage.getItem(HISTORY_KEY);
        if (stored) {
            const parsed = parseInt(stored, 10);
            if (!isNaN(parsed) && parsed > 0) {
                return parsed;
            }
        }
        return 30;
    });

    const setDays = useCallback((newDays: number) => {
        setDaysState(newDays);
        sessionStorage.setItem(HISTORY_KEY, String(newDays));
    }, []);

    return { days, setDays };
}

/**
 * A boolean toggle persisted in localStorage so the user's choice survives a
 * page refresh. Initialized synchronously (no setState-in-effect).
 */
export function usePersistedToggle(key: string, defaultValue = false) {
    const [value, setValue] = useState<boolean>(() => {
        const stored = localStorage.getItem(key);
        return stored === null ? defaultValue : stored === 'true';
    });

    const set = useCallback(
        (next: boolean) => {
            setValue(next);
            localStorage.setItem(key, String(next));
        },
        [key]
    );

    return [value, set] as const;
}
