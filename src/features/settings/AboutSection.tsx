import { Linking, Text, View } from "react-native";
import Constants from "expo-constants";

import { FieldRow, FieldValue } from "@/components/FieldRow";
import { FormSection } from "@/components/FormSection";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/useTheme";

/** Where the project actually lives; the repository's own remote. */
const PROJECT_URL = "https://github.com/ZhanibekAkhmetov/Temelo";
/**
 * What the row shows. The host is already in the label, and the full URL
 * wraps onto two lines in the value column at this width — the owner/repo
 * shorthand is what a GitHub link is called anyway.
 */
const PROJECT_LABEL = "ZhanibekAkhmetov/Temelo";

/**
 * About.
 *
 * Three facts and a link, and deliberately nothing else. What belongs here is
 * what a user cannot find out from the app itself: which build they are
 * running, that their timetables are on this device and nowhere else, and what
 * each of the two ways out of the app actually does — because "Share Temelo
 * file" and "Export to calendar" sound alike and behave nothing alike.
 *
 * The version is read from the app config rather than written out, so the
 * number on this screen is the number that was built. "Beta 1" is the release,
 * not a state the app is in, so it is said once, here, and nowhere else in the
 * product.
 */
export function AboutSection() {
  const { colors, spacing, typography } = useTheme();
  const { t } = useI18n();

  // `expoConfig` is null only in a bare runtime this app never has, but the
  // About row must not be the thing that crashes Settings if it ever is.
  const version = Constants.expoConfig?.version ?? "—";

  const lines = [t("about.storage"), t("about.backup"), t("about.calendar")];

  return (
    <FormSection title={t("about.title")}>
      <View style={{ paddingVertical: spacing.sm, gap: spacing.sm }}>
        <View>
          <Text style={[typography.subtitle, { color: colors.textPrimary }]}>Temelo</Text>
          <Text style={[typography.caption, { color: colors.textMuted, marginTop: 2 }]}>
            {t("about.version", { version })}
          </Text>
        </View>
        {lines.map((line) => (
          <Text key={line} style={[typography.caption, { color: colors.textSecondary }]}>
            {line}
          </Text>
        ))}
      </View>
      {/* A row rather than a button: it is one more fact about the app, and it
          names where it goes so that tapping it is never a surprise. */}
      <FieldRow
        label={t("about.project")}
        onPress={() => {
          void Linking.openURL(PROJECT_URL);
        }}
        accessibilityLabel={`${t("about.project")}, ${PROJECT_LABEL}`}
        last
      >
        <FieldValue muted>{PROJECT_LABEL}</FieldValue>
      </FieldRow>
    </FormSection>
  );
}
