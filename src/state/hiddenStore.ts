import { useState, useCallback } from 'react';

const HIDDEN_PRS_KEY = 'github_pr_panel_hidden_prs';

export function useHiddenPRs() {
    // Initialize synchronously from storage (avoids setState-in-effect).
    const [hiddenIds, setHiddenIdsState] = useState<number[]>(() => {
        const stored = localStorage.getItem(HIDDEN_PRS_KEY);
        if (stored) {
            try {
                return JSON.parse(stored);
            } catch {
                // Invalid JSON
            }
        }
        return [];
    });

    const hidePR = useCallback((id: number) => {
        setHiddenIdsState((prev) => {
            if (prev.includes(id)) return prev;
            const newIds = [...prev, id];
            localStorage.setItem(HIDDEN_PRS_KEY, JSON.stringify(newIds));
            return newIds;
        });
    }, []);

    const unhidePR = useCallback((id: number) => {
        setHiddenIdsState((prev) => {
            const newIds = prev.filter((hiddenId) => hiddenId !== id);
            localStorage.setItem(HIDDEN_PRS_KEY, JSON.stringify(newIds));
            return newIds;
        });
    }, []);

    const isHidden = useCallback((id: number) => {
        return hiddenIds.includes(id);
    }, [hiddenIds]);

    return { hiddenIds, hidePR, unhidePR, isHidden };
}
