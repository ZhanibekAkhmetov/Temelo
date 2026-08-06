import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";

import { DAY_HEADER_HEIGHT, TIME_GUTTER_WIDTH } from "@/features/timetable/geometry";
import { GridBlock, SelectionOutline } from "@/features/timetable/GridBlock";
import type { Interaction } from "@/features/timetable/interaction";
import { getAppearanceColors } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";
import type { TimeSlot } from "@/types/models";

const BUBBLE_HEIGHT = 22;
const BUBBLE_GAP = 6;

export interface ManipulationSubject {
  occurrenceId: string | null;
  name?: string;
  room?: string;
  appearanceId?: string;
}

interface ManipulationOverlayProps {
  interaction: Interaction;
  subject: ManipulationSubject | null;
  timeSlots: TimeSlot[];
  columnWidth: number;
  slotHeight: SharedValue<number>;
  scrollY: SharedValue<number>;
  dayIndex: SharedValue<number>;
  startIndex: SharedValue<number>;
  span: SharedValue<number>;
  /** 1 when the range grew downwards, so the label goes the other way. */
  labelBelow: SharedValue<number>;
}

/**
 * What the finger is currently shaping: the range being drawn out, the
 * class being resized, or the class being moved. Drawn above the grid so
 * nothing underneath reflows, and positioned from shared values so it
 * tracks the finger on the UI thread — only the time-range text crosses to
 * JavaScript, and only when the snapped range actually changes.
 */
export function ManipulationOverlay({
  interaction,
  subject,
  timeSlots,
  columnWidth,
  slotHeight,
  scrollY,
  dayIndex,
  startIndex,
  span,
  labelBelow,
}: ManipulationOverlayProps) {
  const { colors, radii, typography, scheme } = useTheme();

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dayIndex.get() * columnWidth }, { translateY: -scrollY.get() }],
  }));

  // Above the range while it grows downwards, below it while it grows
  // upwards — so the label never ends up under the finger.
  const labelStyle = useAnimatedStyle(() => {
    const height = slotHeight.get();
    const top = startIndex.get() * height;
    const bottom = (startIndex.get() + span.get()) * height;
    return {
      transform: [{ translateY: labelBelow.get() === 1 ? bottom + BUBBLE_GAP : top - BUBBLE_HEIGHT - BUBBLE_GAP }],
    };
  });

  const kind = interaction.kind;
  const isLive = kind === "creatingRange" || kind === "resizingStart" || kind === "resizingEnd" || kind === "movingEvent";
  if (!isLive) return null;

  const valid = "valid" in interaction ? interaction.valid : true;
  // While it can still land, the class is ringed in its own colour; the
  // moment it cannot, everything about the range turns destructive — stroke,
  // label ground and label text together, so it reads as refused rather than
  // as one more colour on a colourful grid.
  const appearance = subject?.appearanceId ? getAppearanceColors(subject.appearanceId, scheme) : null;
  const stroke = valid ? (appearance?.outline ?? colors.accent) : colors.destructive;
  const first = timeSlots[Math.max(0, Math.min(timeSlots.length - 1, interaction.startIndex))];
  const last = timeSlots[Math.max(0, Math.min(timeSlots.length - 1, interaction.startIndex + interaction.span - 1))];

  return (
    <View style={styles.viewport} pointerEvents="none">
      <Animated.View style={[styles.layer, containerStyle]}>
        {kind === "creatingRange" ? (
          <GridBlock
            startIndex={0}
            startShared={startIndex}
            span={interaction.span}
            spanShared={span}
            left={TIME_GUTTER_WIDTH}
            width={columnWidth}
            slotHeight={slotHeight}
            variant="provisional"
          />
        ) : (
          <GridBlock
            startIndex={0}
            startShared={startIndex}
            span={interaction.span}
            spanShared={span}
            left={TIME_GUTTER_WIDTH}
            width={columnWidth}
            slotHeight={slotHeight}
            appearanceId={subject?.appearanceId}
            name={subject?.name}
            room={subject?.room}
            variant="dragging"
          />
        )}

        <SelectionOutline
          startIndex={0}
          startShared={startIndex}
          span={interaction.span}
          spanShared={span}
          left={TIME_GUTTER_WIDTH}
          width={columnWidth}
          slotHeight={slotHeight}
          color={stroke}
          withHandles={kind !== "creatingRange"}
        />

        <Animated.View
          style={[
            styles.label,
            {
              left: TIME_GUTTER_WIDTH + 4,
              height: BUBBLE_HEIGHT,
              backgroundColor: valid ? colors.surfaceAlt : colors.destructiveMuted,
              borderRadius: radii.sm,
              borderColor: stroke,
            },
            labelStyle,
          ]}
        >
          <Text style={[typography.gridSecondary, { color: valid ? colors.textPrimary : colors.destructive }]} numberOfLines={1}>
            {first.startTime}–{last.endTime}
            {valid ? "" : " · in use"}
          </Text>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: {
    position: "absolute",
    left: 0,
    right: 0,
    top: DAY_HEADER_HEIGHT,
    bottom: 0,
    overflow: "hidden",
  },
  layer: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
  },
  label: {
    position: "absolute",
    top: 0,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: 6,
    borderWidth: 1,
    zIndex: 4,
  },
});
