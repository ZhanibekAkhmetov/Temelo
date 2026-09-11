import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";
import {
  Keyboard,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";

/** Just enough of a host component's surface to locate it on screen. */
export interface RevealTarget {
  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void;
}

export interface FieldReveal {
  /**
   * Scrolls just far enough that `target`, once it has grown by `extraHeight`,
   * is inside the viewport. A no-op when it already is.
   */
  reveal: (target: RevealTarget | null, extraHeight: number) => void;
}

const FieldRevealContext = createContext<FieldReveal | null>(null);

/**
 * Available to any field inside a `RevealingScrollView`, and null anywhere
 * else — so a field that wants to be revealed asks, and a field on a screen
 * that does not scroll simply gets no answer and does nothing.
 */
export function useFieldReveal(): FieldReveal | null {
  return useContext(FieldRevealContext);
}

interface RevealingScrollViewProps {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  keyboardShouldPersistTaps?: "always" | "never" | "handled";
}

/** Breathing room under a revealed panel, so it does not sit on the edge. */
const REVEAL_PADDING = 12;

/**
 * A form that brings an expanding field into view.
 *
 * The problem it solves is specific and was reported from the device: tapping
 * a date row in the class editor unfolded a month grid nearly three hundred
 * points tall, directly below the fold. The row acknowledged the tap and
 * nothing else appeared to happen; the picker was there, off-screen, and the
 * user had to go looking for the thing they had just asked for.
 *
 * Two decisions worth recording.
 *
 * It scrolls using the panel's *known* height rather than waiting for the
 * expansion animation to report a layout. The panel's height is a prop — both
 * pickers are fixed-size by construction — so the destination can be computed
 * at the moment of the tap, and the scroll then runs alongside the unfold
 * instead of after it. Waiting for layout means scrolling once the panel is
 * already open, which is the jump this is meant to avoid.
 *
 * It scrolls by the overflow and not to the row. Moving the row to the top of
 * the viewport would throw away the context above it — the class's name and
 * room — for a picker that usually only needs a little more room than it has.
 * The rule is "reveal", not "focus".
 *
 * The keyboard is dismissed first. It is the only other thing competing for the
 * bottom of the screen, and its own inset is what `KeyboardAvoidingView` has
 * already applied to this ScrollView's height — so letting it go both frees the
 * space and removes the one thing that could move the viewport after the
 * measurement was taken.
 */
export function RevealingScrollView({
  children,
  contentContainerStyle,
  style,
  keyboardShouldPersistTaps,
}: RevealingScrollViewProps) {
  const scrollRef = useRef<ScrollView>(null);
  /**
   * A plain view around the ScrollView, so the viewport can be located on
   * screen. `ScrollView`'s own ref is a scroll responder rather than a host
   * component and does not offer `measureInWindow`.
   */
  const viewportRef = useRef<View>(null);
  /** Where the form is scrolled to, tracked because `scrollTo` is absolute. */
  const offsetY = useRef(0);
  /** The viewport, as last laid out — the height a revealed panel must fit in. */
  const viewportHeight = useRef(0);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offsetY.current = event.nativeEvent.contentOffset.y;
  }, []);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    viewportHeight.current = event.nativeEvent.layout.height;
  }, []);

  const reveal = useCallback<FieldReveal["reveal"]>((target, extraHeight) => {
    if (!target) return;
    Keyboard.dismiss();

    const scroll = scrollRef.current;
    const viewport = viewportRef.current;
    if (!scroll || !viewport) return;

    // Measured rather than remembered: the form may itself have been pushed up
    // by a keyboard that is only now going away, and a stale origin would
    // scroll by the wrong amount.
    viewport.measureInWindow((_scrollX, scrollTop) => {
      if (viewportHeight.current <= 0) return;
      const viewportBottom = scrollTop + viewportHeight.current;

      target.measureInWindow((_x, rowTop, _width, rowHeight) => {
        const wantedBottom = rowTop + rowHeight + extraHeight + REVEAL_PADDING;
        const overflow = wantedBottom - viewportBottom;
        if (overflow <= 0) return;
        scroll.scrollTo({ y: Math.max(0, offsetY.current + overflow), animated: true });
      });
    });
  }, []);

  const value = useMemo<FieldReveal>(() => ({ reveal }), [reveal]);

  return (
    <FieldRevealContext.Provider value={value}>
      <View ref={viewportRef} collapsable={false} style={[styles.flex, style]} onLayout={handleLayout}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={contentContainerStyle}
          keyboardShouldPersistTaps={keyboardShouldPersistTaps}
          onScroll={handleScroll}
          // Enough to keep `offsetY` honest without a JS callback every frame.
          scrollEventThrottle={32}
        >
          {children}
        </ScrollView>
      </View>
    </FieldRevealContext.Provider>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
});
