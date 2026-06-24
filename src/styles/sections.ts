import type { Theme } from '@mui/material/styles';

// Card surface lifted from the translations-mcp landing page (.tool-card):
// theme-aware background / border colour / radius. Shared by the main page
// sections (2px border), the inner PR table (1px border), and the table's
// cell bottom-borders.
const CARD = { dark: '#111827', light: '#FFFFFF' };
const BORDER = { dark: '#1E293B', light: '#E8E8E3' };
const RADIUS = '12px';

export const sectionBorderColor = (theme: Theme): string =>
    theme.palette.mode === 'dark' ? BORDER.dark : BORDER.light;

export const sectionSurfaceSx = (borderWidth = 1) => (theme: Theme) => ({
    bgcolor: theme.palette.mode === 'dark' ? CARD.dark : CARD.light,
    border: `${borderWidth}px solid`,
    borderColor: sectionBorderColor(theme),
    borderRadius: RADIUS,
});
