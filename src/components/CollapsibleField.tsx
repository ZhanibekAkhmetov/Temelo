import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

import { FieldRow, FieldValue } from "@/components/FieldRow";
import { useFieldReveal } from "@/components/RevealingScrollView";
import { useTheme } from "@/theme/useTheme";

interface CollapsibleFieldProps {
  label: string;
  /** The collapsed state: just the current value. */
  valueText: string;
  /**
   * Drawn in place of `valueText` when the value is not words — the class
   * colour field shows its swatch here. `valueText` is still required, and
   * is what the row announces to a screen reader.
   */
  valueContent?: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  /** Fixed height of the panel, so the unfold animates against a known target. */
  panelHeight: number;
  children: ReactNode;
  error?: string;
  helperText?: string;
}

const EXPAND_DURATION_MS = 180;

/**
 * A field that shows only its value until tapped, then unfolds its picker
 * in place. The panel's height is passed in rather than measured: both
 * pickers are fixed-size by construction, and a known target height keeps
 * the unfold from jumping on the first frame the way a measure-then-animate
 * pass does.
 */
export function CollapsibleField({
  label,
  valueText,
  valueContent,
  expanded,
  onToggle,
  panelHeight,
  children,
  error,
  helperText,
}: CollapsibleFieldProps) {
  const { colors } = useTheme();
  const [progress] = useState(() => new Animated.Value(expanded ? 1 : 0));

  /*
   * Asking the form to scroll this field's panel into view.
   *
   * The field is the only thing that knows it has just opened and how tall
   * the panel it opened is, so it is the one that asks; the form is the only
   * thing that can scroll, so it is the one that answers. Null when there is
   * no scrolling form around this field, in which case nothing happens —
   * which is right for a field on a screen that does not scroll.
   *
   * It fires on the transition into the expanded state, not on every render,
   * so re-rendering an already-open field never moves the page under the
   * reader.
   */
  const container = useRef<View>(null);
  const fieldReveal = useFieldReveal();

  useEffect(() => {
    Animated.timing(progress, {
      toValue: expanded ? 1 : 0,
      duration: EXPAND_DURATION_MS,
      easing: expanded ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: false,
    }).start();

    // The panel's height is known before it has any, so the scroll can start
    // in the same frame as the unfold rather than chasing it afterwards.
    if (expanded) fieldReveal?.reveal(container.current, panelHeight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, progress]);

  const height = progress.interpolate({ inputRange: [0, 1], outputRange: [0, panelHeight] });

  return (
    // One extra view, purely so there is something to measure: FieldRow's own
    // outer view is not exposed, and the measurement has to cover the row and
    // the panel beneath it.
    <View ref={container} collapsable={false}>
      <FieldRow
        label={label}
        onPress={onToggle}
        accessibilityLabel={`${label}, ${valueText}`}
        accessibilityExpanded={expanded}
        error={error}
        helperText={helperText}
        panel={
          <Animated.View style={[styles.panel, { height, opacity: progress }]}>
            <View style={{ height: panelHeight }}>{children}</View>
          </Animated.View>
        }
      >
        {/* An open field's value is drawn in the accent, which is the only
            state this row has: the panel below it is the rest of the answer. */}
        {valueContent ?? <FieldValue>{valueText}</FieldValue>}
        {expanded && !valueContent ? <View style={[styles.openMark, { backgroundColor: colors.accent }]} /> : null}
      </FieldRow>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    overflow: "hidden",
  },
  openMark: {
    height: 2,
    width: 18,
    marginTop: 3,
    borderRadius: 1,
  },
});
