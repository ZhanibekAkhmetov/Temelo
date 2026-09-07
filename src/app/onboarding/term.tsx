import { useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";

import { FieldRow, FieldValue } from "@/components/FieldRow";
import { FormSection } from "@/components/FormSection";
import { InlineDateField } from "@/components/InlineDateField";
import { OnboardingNav } from "@/components/OnboardingNav";
import { ScreenContainer } from "@/components/ScreenContainer";
import { TextField } from "@/components/TextField";
import { isIsoDateBeforeOrEqual, isValidIsoDate } from "@/domain/date";
import type { DomainError } from "@/domain/errors";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppState } from "@/state/AppStateContext";
import { useTheme } from "@/theme/useTheme";

/**
 * The term, in both the modes it is reached in.
 *
 * During onboarding it is the last step and sets the whole term, start date
 * included. Afterwards it is opened from Settings as its own editor, and the
 * start date becomes a read-only row: moving the start of a term that already
 * has classes in it would silently re-anchor every alternating-week series,
 * which is not something a settings row should be able to do in one tap.
 *
 * It is a screen rather than a block inside Settings because it is several
 * fields that have to be committed together — a name saved without its date,
 * or a date rejected after the name has already been written, is a
 * half-applied change. That is exactly the distinction Settings now draws:
 * single choices commit on tap, multi-field edits get a screen and a Save.
 */
export default function TermConfigScreen() {
  const { colors, spacing, typography } = useTheme();
  const { t, format } = useI18n();
  const { state, setTermConfig, updateTermInfo } = useAppState();

  const isEdit = state.settings.onboardingCompleted;

  // A fresh install has no term name yet — the seed leaves it empty rather
  // than putting an English one into the database — so the field opens on a
  // translated suggestion the user confirms or replaces.
  const [name, setName] = useState(state.term.name || t("onboarding.termNamePlaceholder"));
  const [startDate, setStartDate] = useState(state.term.startDate);
  const [estimatedEndDate, setEstimatedEndDate] = useState(state.term.estimatedEndDate);

  const [openPicker, setOpenPicker] = useState<"start" | "end" | null>(null);
  const [nameError, setNameError] = useState<DomainError | undefined>();
  const [startError, setStartError] = useState<DomainError | undefined>();
  const [endError, setEndError] = useState<DomainError | undefined>();
  const [formError, setFormError] = useState<DomainError | undefined>();

  function togglePicker(picker: "start" | "end") {
    setOpenPicker((current) => (current === picker ? null : picker));
  }

  function clearErrors() {
    setNameError(undefined);
    setStartError(undefined);
    setEndError(undefined);
    setFormError(undefined);
  }

  function handleSaveEdit() {
    clearErrors();
    const result = updateTermInfo({ name, estimatedEndDate });
    if (!result.ok) {
      if (result.error.key === "errors.termNameRequired") setNameError(result.error);
      else setEndError(result.error);
      return;
    }
    router.back();
  }

  function handleFinishOnboarding() {
    clearErrors();

    let hasError = false;
    if (!name.trim()) {
      setNameError({ key: "errors.termNameRequired" });
      hasError = true;
    }
    if (!isValidIsoDate(startDate)) {
      setStartError({ key: "errors.dateInvalid" });
      hasError = true;
    }
    if (!isValidIsoDate(estimatedEndDate)) {
      setEndError({ key: "errors.dateInvalid" });
      hasError = true;
    }
    if (!hasError && !isIsoDateBeforeOrEqual(startDate, estimatedEndDate)) {
      setEndError({ key: "errors.estimatedEndBeforeStart" });
      hasError = true;
    }
    if (hasError) return;

    const result = setTermConfig({ name, startDate, estimatedEndDate });
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    // Onboarding pushed week -> academic-day -> term onto the stack; pop
    // all the way back to the first onboarding screen before replacing it,
    // so none of the onboarding screens linger underneath the timetable
    // (which was causing back gestures to loop through them endlessly).
    router.dismissAll();
    router.replace("/timetable");
  }

  return (
    <ScreenContainer>
      <Text style={[typography.title, { color: colors.textPrimary }]}>{t("onboarding.termTitle")}</Text>
      {isEdit ? null : (
        <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.xs }]}>
          {t("onboarding.termSubtitle")}
        </Text>
      )}

      <FormSection>
        <TextField
          label={t("settings.termName")}
          value={name}
          onChangeText={setName}
          error={nameError ? t(nameError.key, nameError.params) : undefined}
          placeholder={t("onboarding.termNamePlaceholder")}
        />
        {isEdit ? (
          <FieldRow label={t("classEditor.startDate")}>
            <FieldValue muted>{format.dateLong(state.term.startDate)}</FieldValue>
          </FieldRow>
        ) : (
          <InlineDateField
            label={t("classEditor.startDate")}
            value={startDate}
            onChange={setStartDate}
            expanded={openPicker === "start"}
            onToggle={() => togglePicker("start")}
            error={startError ? t(startError.key, startError.params) : undefined}
          />
        )}
        <InlineDateField
          label={t("settings.estimatedEndDate")}
          value={estimatedEndDate}
          onChange={setEstimatedEndDate}
          expanded={openPicker === "end"}
          onToggle={() => togglePicker("end")}
          error={endError ? t(endError.key, endError.params) : undefined}
          helperText={t("onboarding.termEndDateHint")}
        />
      </FormSection>

      {formError ? (
        <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.sm }]}>
          {t(formError.key, formError.params)}
        </Text>
      ) : null}

      <OnboardingNav
        onBack={() => router.back()}
        onContinue={isEdit ? handleSaveEdit : handleFinishOnboarding}
        continueLabel={isEdit ? t("common.save") : t("common.finish")}
      />
    </ScreenContainer>
  );
}
