import { useColorScheme } from "react-native";

import { borderWidth, darkColors, lightColors, radii, spacing, typography } from "@/theme/tokens";

export function useTheme() {
  const scheme = useColorScheme();
  const colors = scheme === "dark" ? darkColors : lightColors;
  return { colors, spacing, radii, typography, borderWidth, scheme: scheme === "dark" ? "dark" as const : "light" as const };
}
