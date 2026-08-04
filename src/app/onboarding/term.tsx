import { useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";

import { DateInput } from "@/components/DateInput";
import { OnboardingNav } from "@/components/OnboardingNav";
import { ScreenContainer } from "@/components/ScreenContainer";
import { TextField } from "@/components/TextField";
import { isIsoDateBeforeOrEqual, isValidIsoDate } from "@/domain/date";
import { useAppState } from "@/state/AppStateContext";
import { useTheme } from "@/theme/useTheme";

export default function TermConfigScreen() {
  const { colors, spacing, typography } = useTheme();
  const { state, setTermConfig } = useAppState();

  const [name, setName] = useState(state.term.name);
  const [startDate, setStartDate] = useState(state.term.startDate);
  const [estimatedEndDate, setEstimatedEndDate] = useState(state.term.estimatedEndDate);

  const [nameError, setNameError] = useState<string | undefined>();
  const [startError, setStartError] = useState<string | undefined>();
  const [endError, setEndError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();

  function handleFinish() {
    let hasError = false;
    setNameError(undefined);
    setStartError(undefined);
    setEndError(undefined);
    setFormError(undefined);

    if (!name.trim()) {
      setNameError("Term name is required.");
      hasError = true;
    }
    if (!isValidIsoDate(startDate)) {
      setStartError("Enter a valid date as DD.MM.YYYY.");
      hasError = true;
    }
    if (!isValidIsoDate(estimatedEndDate)) {
      setEndError("Enter a valid date as DD.MM.YYYY.");
      hasError = true;
    }
    if (!hasError && !isIsoDateBeforeOrEqual(startDate, estimatedEndDate)) {
      setEndError("Estimated end date cannot be before the start date.");
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
      <Text style={[typography.title, { color: colors.textPrimary }]}>Academic term</Text>
      <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.lg }]}>
        Set the term your timetable runs through — the end date is just an estimate you can change later.
      </Text>

      <TextField label="Term name" value={name} onChangeText={setName} error={nameError} placeholder="Current term" />
      <DateInput label="Start date" value={startDate} onChangeText={setStartDate} error={startError} helperText="e.g. 01.09.2026" />
      <DateInput
        label="Estimated end date"
        value={estimatedEndDate}
        onChangeText={setEstimatedEndDate}
        error={endError}
        helperText="An estimate — easy to change later"
      />

      {formError ? <Text style={[typography.caption, { color: colors.destructive }]}>{formError}</Text> : null}

      <OnboardingNav onBack={() => router.back()} onContinue={handleFinish} continueLabel="Finish" />
    </ScreenContainer>
  );
}
