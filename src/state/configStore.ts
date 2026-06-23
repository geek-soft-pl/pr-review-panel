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
