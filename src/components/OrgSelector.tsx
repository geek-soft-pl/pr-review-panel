import React, { useState } from 'react';
import {
    Box,
    TextField,
    Chip,
    IconButton,
    Typography,
    InputAdornment,
} from '@mui/material';
import { Add, Business } from '@mui/icons-material';

interface OrgSelectorProps {
    orgs: string[];
    onAddOrg: (org: string) => void;
    onRemoveOrg: (org: string) => void;
    disabled?: boolean;
}

export const OrgSelector: React.FC<OrgSelectorProps> = ({
    orgs,
    onAddOrg,
    onRemoveOrg,
    disabled = false,
}) => {
    const [inputValue, setInputValue] = useState('');

    const handleAdd = () => {
        const trimmed = inputValue.trim();
        if (trimmed && !orgs.includes(trimmed)) {
            onAddOrg(trimmed);
            setInputValue('');
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAdd();
        }
        // Support comma-separated input
        if (e.key === ',') {
            e.preventDefault();
            handleAdd();
        }
    };

    const handlePaste = (e: React.ClipboardEvent) => {
        const pasted = e.clipboardData.getData('text');
        if (pasted.includes(',')) {
            e.preventDefault();
            const newOrgs = pasted.split(',').map((o) => o.trim()).filter(Boolean);
            newOrgs.forEach((org) => {
                if (!orgs.includes(org)) {
                    onAddOrg(org);
                }
            });
            setInputValue('');
        }
    };

    return (
        <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Business fontSize="small" color="action" />
                <Typography variant="body2" color="text.secondary">
                    Organizations
                </Typography>
            </Box>

            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <TextField
                    size="small"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    placeholder="Add organization..."
                    disabled={disabled}
                    sx={{ minWidth: 200 }}
                    InputProps={{
                        endAdornment: (
                            <InputAdornment position="end">
                                <IconButton
                                    onClick={handleAdd}
                                    disabled={!inputValue.trim() || disabled}
                                    size="small"
                                >
                                    <Add fontSize="small" />
                                </IconButton>
                            </InputAdornment>
                        ),
                    }}
                />

                {orgs.map((org) => (
                    <Chip
                        key={org}
                        label={org}
                        onDelete={disabled ? undefined : () => onRemoveOrg(org)}
                        size="small"
                        variant="outlined"
                    />
                ))}

                {orgs.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                        No organizations configured. Add your GitHub org names (comma-separated).
                    </Typography>
                )}
            </Box>
        </Box>
    );
};
