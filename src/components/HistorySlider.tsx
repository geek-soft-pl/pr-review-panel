import React from 'react';
import { Box, Slider, Typography } from '@mui/material';
import { CalendarMonth } from '@mui/icons-material';

interface HistorySliderProps {
    days: number;
    onChange: (days: number) => void;
    disabled?: boolean;
}

const marks = [
    { value: 30, label: '30d' },
    { value: 60, label: '60d' },
    { value: 90, label: '90d' },
];

export const HistorySlider: React.FC<HistorySliderProps> = ({
    days,
    onChange,
    disabled = false,
}) => {
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CalendarMonth fontSize="small" color="action" />
                <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                    Missing Approve history
                </Typography>
            </Box>

            <Box sx={{ width: { xs: 180, sm: 220 } }}>
                <Slider
                    value={days}
                    onChange={(_, value) => onChange(value as number)}
                    min={30}
                    max={90}
                    step={30}
                    marks={marks}
                    disabled={disabled}
                    size="small"
                />
            </Box>
        </Box>
    );
};
