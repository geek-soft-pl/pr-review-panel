import { useEffect, useMemo, useState } from 'react';
import { ThemeProvider, createTheme, CssBaseline, Container, Box, Paper, Typography, Switch } from '@mui/material';
import { GitHub, LightMode, DarkMode } from '@mui/icons-material';
import { TokenBar } from './components/TokenBar';
import { HistorySlider } from './components/HistorySlider';
import { Dashboard } from './pages/Dashboard';
import { useToken, useCurrentUser } from './state/tokenStore';
import { useHistoryWindow } from './state/configStore';

// Organization whose PRs the panel shows. Configure via VITE_GITHUB_ORG (.env);
// falls back to the default below when unset.
const ORGANIZATION = import.meta.env.VITE_GITHUB_ORG || 'geek-soft-pl';

type ThemeMode = 'light' | 'dark';
const THEME_MODE_STORAGE_KEY = 'github_pr_panel_theme_mode';

const getInitialThemeMode = (): ThemeMode => {
  const savedMode = localStorage.getItem(THEME_MODE_STORAGE_KEY);
  return savedMode === 'light' || savedMode === 'dark' ? savedMode : 'dark';
};

const createAppTheme = (mode: ThemeMode) =>
  createTheme({
    palette: {
      mode,
      primary: {
        main: mode === 'dark' ? '#58a6ff' : '#1565c0',
      },
      background: mode === 'dark'
        ? {
            default: '#0d1117',
            paper: '#161b22',
          }
        : {
            default: '#f6f8fa',
            paper: '#ffffff',
          },
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
        },
      },
    },
  });

function App() {
  const { token, setToken, clearToken, storageType } = useToken();
  const { user, loading: userLoading, error: userError } = useCurrentUser(token);
  const { days, setDays } = useHistoryWindow();
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);
  const theme = useMemo(() => createAppTheme(themeMode), [themeMode]);

  useEffect(() => {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, themeMode);
  }, [themeMode]);

  const isAuthenticated = !!user && !userError;

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Container maxWidth="xl" sx={{ py: 3 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 3, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <GitHub sx={{ fontSize: 40 }} />
            <Typography variant="h4" component="h1" fontWeight="bold">
              PR Review Panel
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <LightMode fontSize="small" color={themeMode === 'light' ? 'warning' : 'action'} />
            <Switch
              checked={themeMode === 'dark'}
              onChange={(_, checked) => setThemeMode(checked ? 'dark' : 'light')}
              inputProps={{ 'aria-label': 'Toggle light and dark theme' }}
            />
            <DarkMode fontSize="small" color={themeMode === 'dark' ? 'primary' : 'action'} />
          </Box>
        </Box>

        {/* Configuration Panel */}
        <Paper sx={{ p: 3, mb: 3 }} elevation={0} variant="outlined">
          <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <Box sx={{ flex: 1, minWidth: 400 }}>
              <TokenBar
                token={token}
                storageType={storageType}
                user={user}
                userLoading={userLoading}
                userError={userError}
                onSaveToken={setToken}
                onClearToken={clearToken}
              />
            </Box>
            {isAuthenticated && (
              <Box>
                <HistorySlider days={days} onChange={setDays} />
              </Box>
            )}
          </Box>
        </Paper>

        {/* Dashboard */}
        {isAuthenticated && (
          <Paper sx={{ p: 3 }} elevation={0} variant="outlined">
            <Dashboard
              userLogin={user!.login}
              org={ORGANIZATION}
              historyDays={days}
            />
          </Paper>
        )}
      </Container>
    </ThemeProvider>
  );
}

export default App;
