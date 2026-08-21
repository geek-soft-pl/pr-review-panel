import { useEffect, useMemo, useState } from 'react';
import { ThemeProvider, createTheme, CssBaseline, Container, Box, Paper, Typography, Switch } from '@mui/material';
import { GitHub, LightMode, DarkMode } from '@mui/icons-material';
import { TokenBar } from './components/TokenBar';
import { Dashboard } from './pages/Dashboard';
import { useToken, useCurrentUser } from './state/tokenStore';
import { sectionSurfaceSx } from './styles/sections';

// Organizations whose PRs the panel shows, as a comma-separated list.
// Configure via VITE_GITHUB_ORG; falls back to the default when unset.
const parseOrgs = (raw: string | undefined): string[] =>
    (raw || 'geek-soft-pl')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

const ORGANIZATIONS = parseOrgs(import.meta.env.VITE_GITHUB_ORG);

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

        {/* Dashboard — kept at the top once signed in so the PR lists are
            the first thing you see. */}
        {isAuthenticated && (
          <Paper sx={[{ p: 3, mb: 3 }, sectionSurfaceSx(2)]} elevation={0}>
            <Dashboard
              userLogin={user!.login}
              orgs={ORGANIZATIONS}
            />
          </Paper>
        )}

        {/* Configuration Panel — token/login status + history depth. Set once,
            so it sits at the bottom when signed in; before sign-in it's the only
            content and naturally appears at the top. */}
        <Paper sx={[{ p: 3 }, sectionSurfaceSx(2)]} elevation={0}>
          <TokenBar
            token={token}
            storageType={storageType}
            user={user}
            userLoading={userLoading}
            userError={userError}
            onSaveToken={setToken}
            onClearToken={clearToken}
          />
        </Paper>
      </Container>
    </ThemeProvider>
  );
}

export default App;
