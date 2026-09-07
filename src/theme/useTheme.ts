/**
 * The theme, as every component reads it.
 *
 * Kept as its own module so the twenty-odd `import { useTheme } from
 * "@/theme/useTheme"` lines across the app do not have to know that the
 * implementation moved from a bare `useColorScheme` call into a provider.
 */

export { useTheme, type Theme } from "@/theme/ThemeProvider";
