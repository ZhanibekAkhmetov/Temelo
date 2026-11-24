import { useState } from "react";
import { Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { DialogCard } from "@/components/DialogCard";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/useTheme";

interface OpenLinkDialogProps {
  /** True while the link is being downloaded and checked. */
  busy: boolean;
  /** Why the last attempt did not work, already translated. */
  error?: string;
  onOpen: (input: string) => void;
  onCancel: () => void;
}

/**
 * Pasting a share link into Temelo.
 *
 * The way a link reaches the app on a phone today: copy it from the chat, paste
 * it here. (A link tapped in a browser opens the web app's `/shared/<id>`
 * route; Android opening the app straight from the link needs App Links on the
 * hosted domain — roadmap 14.7 and 14.9.) A whole link or a bare id both
 * work, and whatever it leads to arrives in the same import preview as a file.
 *
 * A plain full-width input rather than `TextField`'s label-and-value row: a
 * link is long, unbroken text, and right-aligned in half a row it would show
 * only its last few characters.
 */
export function OpenLinkDialog({ busy, error, onOpen, onCancel }: OpenLinkDialogProps) {
  const { colors, spacing, radii, typography } = useTheme();
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const canOpen = input.trim().length > 0 && !busy;

  function open() {
    if (canOpen) onOpen(input);
  }

  return (
    <DialogCard onRequestClose={busy ? undefined : onCancel}>
      <Text accessibilityRole="header" style={[typography.subtitle, { color: colors.textPrimary }]}>
        {t("openLink.title")}
      </Text>
      <TextInput
        value={input}
        onChangeText={setInput}
        placeholder={t("openLink.placeholder")}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={t("openLink.field")}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="go"
        onSubmitEditing={open}
        editable={!busy}
        style={[
          typography.body,
          {
            color: colors.textPrimary,
            backgroundColor: colors.inputBackground,
            borderRadius: radii.sm,
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.sm,
          },
        ]}
      />
      {error ? <Text style={[typography.caption, { color: colors.danger }]}>{error}</Text> : null}
      <View style={{ gap: spacing.sm }}>
        <Button
          label={busy ? t("openLink.opening") : t("openLink.confirm")}
          variant="primary"
          onPress={open}
          disabled={!canOpen}
        />
        <Button label={t("common.cancel")} variant="secondary" onPress={onCancel} disabled={busy} />
      </View>
    </DialogCard>
  );
}
