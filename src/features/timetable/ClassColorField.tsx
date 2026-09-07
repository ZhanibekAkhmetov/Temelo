import { StyleSheet, Pressable, View } from "react-native";

import { CollapsibleField } from "@/components/CollapsibleField";
import { normalizeClassColorId, type ClassColorId } from "@/domain/classColor";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/translate";
import { CLASS_COLOR_SWATCHES, getClassColors } from "@/theme/classColors";
import { useTheme } from "@/theme/useTheme";

/** Circles, sized for a comfortable target rather than for the ink in them. */
const SWATCH_SIZE = 40;
const ROW_GAP = 14;
const SWATCHES_PER_ROW = 6;
/** Each cell is an exact fraction of the row, so the wrap point never moves. */
const CELL_WIDTH_PERCENT = `${100 / SWATCHES_PER_ROW}%` as const;
const ROWS = Math.ceil(CLASS_COLOR_SWATCHES.length / SWATCHES_PER_ROW);
const PANEL_PADDING = 8;
/** The cell is the touch target; the circle inside it is only what you see. */
const CELL_HEIGHT = 48;

/**
 * Height of the unfolded grid.
 *
 * `CollapsibleField` animates against a height it is told rather than one it
 * measures, so this has to be exact. It can be, because the cells are sized
 * as a percentage of the row rather than in points: six always fit, on any
 * screen width, so the palette's twelve entries are always two rows and this
 * number cannot drift out of step with what is drawn on a narrow phone.
 */
export const CLASS_COLOR_PANEL_HEIGHT = ROWS * CELL_HEIGHT + (ROWS - 1) * ROW_GAP + PANEL_PADDING * 2;

/** The swatch shown collapsed, and the one every grid cell draws. */
const SWATCH_LABEL_KEY: Record<ClassColorId, TranslationKey> = {
  blue: "classColor.blue",
  orange: "classColor.orange",
  green: "classColor.green",
  purple: "classColor.purple",
  amber: "classColor.amber",
  teal: "classColor.teal",
  magenta: "classColor.magenta",
  deepGreen: "classColor.deepGreen",
  indigo: "classColor.indigo",
  red: "classColor.red",
  cyan: "classColor.cyan",
  graphite: "classColor.graphite",
};

interface ClassColorFieldProps {
  value: string;
  onChange: (appearanceId: ClassColorId) => void;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * The class's colour, as a row that unfolds a grid of circles.
 *
 * The same shape as the date and time fields — a value on the right, a panel
 * underneath — so the editor reads as one form rather than as a form with a
 * colour picker bolted to it. Six circles to a row fits a narrow phone with
 * the palette's twelve landing on exactly two rows.
 *
 * No text under the swatches. The colours *are* the labels, names would treble
 * the panel's height, and the names each one does have are where they are
 * actually useful — in the accessibility label, which is the one place a
 * colour cannot speak for itself.
 *
 * Selection is a ring plus a tick, never a ring alone: on a palette this
 * saturated a coloured ring is not reliably distinguishable from the fill
 * beside it, and the tick is drawn in the swatch's own ink so it is legible on
 * amber as well as on purple.
 *
 * Nothing here writes anything. It reports a choice upward; the editor holds
 * it as draft state and Save is what commits it — which is also what lets the
 * grid preview the new colour while the scope question is still open.
 */
export function ClassColorField({ value, onChange, expanded, onToggle }: ClassColorFieldProps) {
  const { radii, borderWidth } = useTheme();
  const { t } = useI18n();

  const selectedId = normalizeClassColorId(value);
  const selected = getClassColors(selectedId);

  return (
    <CollapsibleField
      label={t("classColor.label")}
      valueText={t(SWATCH_LABEL_KEY[selectedId])}
      valueContent={
        <View
          style={[
            styles.currentSwatch,
            { backgroundColor: selected.fill, borderColor: selected.edge, borderWidth: borderWidth.thin },
          ]}
        />
      }
      expanded={expanded}
      onToggle={onToggle}
      panelHeight={CLASS_COLOR_PANEL_HEIGHT}
    >
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("classColor.picker")}
        style={[styles.grid, { padding: PANEL_PADDING, rowGap: ROW_GAP }]}
      >
        {CLASS_COLOR_SWATCHES.map(({ id, colors: swatch }) => {
          const isSelected = id === selectedId;
          return (
            <Pressable
              key={id}
              onPress={() => onChange(id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={t(SWATCH_LABEL_KEY[id])}
              hitSlop={4}
              pressRetentionOffset={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={({ pressed }) => [styles.target, { opacity: pressed ? 0.7 : 1 }]}
            >
              <View
                style={[
                  styles.swatch,
                  {
                    backgroundColor: swatch.fill,
                    // The ring is the swatch's own outline — guaranteed at
                    // least 3.2:1 against its fill — with the page colour
                    // between them, so it reads on any scheme.
                    borderColor: isSelected ? swatch.outline : swatch.edge,
                    borderWidth: isSelected ? 3 : borderWidth.thin,
                  },
                ]}
              >
                {isSelected ? (
                  <View style={[styles.tick, { backgroundColor: swatch.ink, borderRadius: radii.sm }]} />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </CollapsibleField>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  target: {
    width: CELL_WIDTH_PERCENT,
    height: CELL_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  swatch: {
    width: SWATCH_SIZE,
    height: SWATCH_SIZE,
    borderRadius: SWATCH_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  tick: {
    width: 12,
    height: 12,
  },
  currentSwatch: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
});
