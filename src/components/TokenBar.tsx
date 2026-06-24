import React, { useState } from 'react';
import {
    Box,
    TextField,
    Button,
    FormControlLabel,
    Checkbox,
    InputAdornment,
    IconButton,
    Typography,
    Avatar,
    Chip,
    Alert,
} from '@mui/material';
import {
    Visibility,
    VisibilityOff,
    CheckCircle,
    Error as ErrorIcon,
} from '@mui/icons-material';
import type { GitHubUser } from '../api/user';
import type { StorageType } from '../state/tokenStore';

interface TokenBarProps {
    token: string;
    storageType: StorageType;
    user: GitHubUser | null;
    userLoading: boolean;
    userError: string | null;
    onSaveToken: (token: string, persist: boolean) => void;
    onClearToken: () => void;
}

export const TokenBar: React.FC<TokenBarProps> = ({
    token,
    storageType,
    user,
    userLoading,
    userError,
    onSaveToken,
    onClearToken,
}) => {
    const [inputValue, setInputValue] = useState(token);
    const [showToken, setShowToken] = useState(false);
    const [persist, setPersist] = useState(storageType === 'local');

    const handleSave = () => {
        onSaveToken(inputValue, persist);
    };

    const handleClear = () => {
        setInputValue('');
        onClearToken();
    };

    const isValidToken = !!user && !userError;

    return (
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <TextField
                    type={showToken ? 'text' : 'password'}
                    label="GitHub Token"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    size="small"
                    sx={{ minWidth: 320 }}
                    placeholder="ghp_xxxxxxxxxxxx"
                    InputProps={{
                        endAdornment: (
                            <InputAdornment position="end">
                                <IconButton
                                    onClick={() => setShowToken(!showToken)}
                                    edge="end"
                                    size="small"
                                >
                                    {showToken ? <VisibilityOff /> : <Visibility />}
                                </IconButton>
                            </InputAdornment>
                        ),
                    }}
                />

                <FormControlLabel
                    control={
                        <Checkbox
                            checked={persist}
                            onChange={(e) => setPersist(e.target.checked)}
                            size="small"
                        />
                    }
                    label="Remember"
                />

                <Button
                    variant="contained"
                    onClick={handleSave}
                    disabled={!inputValue || inputValue === token}
                    size="small"
                >
                    Save
                </Button>

                {token && (
                    <Button variant="outlined" onClick={handleClear} size="small" color="error">
                        Clear
                    </Button>
                )}
            </Box>

            {/* Token status — sits to the right of the input row */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {userLoading && (
                    <Typography variant="body2" color="text.secondary">
                        Verifying token...
                    </Typography>
                )}

                {!userLoading && isValidToken && user && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <CheckCircle color="success" fontSize="small" />
                        <Avatar src={user.avatar_url} sx={{ width: 24, height: 24 }} />
                        <Typography variant="body2">
                            Logged in as <strong>{user.login}</strong>
                        </Typography>
                        <Chip
                            label={storageType === 'local' ? 'Saved' : 'Session'}
                            size="small"
                            variant="outlined"
                        />
                    </Box>
                )}

                {!userLoading && userError && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <ErrorIcon color="error" fontSize="small" />
                        <Typography variant="body2" color="error">
                            {userError}
                        </Typography>
                    </Box>
                )}

                {!token && !userLoading && (
                    <Alert severity="info" sx={{ py: 0 }}>
                        Enter your GitHub Personal Access Token to view PR reviews. Token needs <code>repo</code> scope for private repos.
                    </Alert>
                )}
            </Box>
        </Box>
    );
};
