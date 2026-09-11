/**
 * Which weeks are mounted, and — the part that actually mattered — which
 * *component instances* draw them.
 *
 * The pager has always mounted a fixed three pages: previous, current, next.
 * That bound was never the problem. The problem was that each page's React key
 * was its own week, so advancing one week retired a key and introduced a new
 * one — and a `WeekPage` is not a cheap thing to retire. One page is a weekday
 * strip, a period line per period, a column rule per day, a block per class and
 * three page-level transforms: on the order of forty `useAnimatedStyle` mappers
 * and sixty native views. Every single swipe tore one of those down and built
 * another, and pressing Today tore down and rebuilt all three at once, in one
 * frame, with nothing on screen in between. That is the blank grid and the
 * multi-second freeze, and the steady accumulation of mount/unmount churn is
 * why paging felt worse the further it went.
 *
 * So the window is addressed as a ring instead. A page's identity is its *slot*
 * — `pageIndex` modulo the window size — which means:
 *
 *  - the three page instances are created once, when the surface mounts, and
 *    live until it unmounts. Nothing is ever built or destroyed by paging.
 *  - advancing or retreating one week changes the `weekStart` of exactly one
 *    slot: the one holding the week that has just dropped out of range. The two
 *    weeks that survive keep their slot, their props and their subtree.
 *  - a jump of any distance — Today from a hundred weeks out — changes all
 *    three slots' props and nothing else. The cost is three re-renders,
 *    whatever the distance.
 *
 * The slots are returned in slot order rather than in offset order, so the
 * array's shape is as stable as the keys are and React never sees a reorder
 * either. Render order is not visual order here: every page is absolutely
 * positioned and places itself from its own `pageIndex`, so the one on screen
 * is decided by arithmetic rather than by where it sits in the list.
 *
 * Pure, and deliberately in its own module so the harness can assert the bound
 * directly instead of inferring it from a component that cannot be mounted
 * outside a device build.
 */

/** How many weeks either side of the current one stay mounted. */
export const PAGE_WINDOW_RADIUS = 1;

/** Pages mounted at any moment — constant, whatever the user does. */
export const PAGE_WINDOW_SIZE = PAGE_WINDOW_RADIUS * 2 + 1;

export interface WeekPageSlot {
  /**
   * React key. One of exactly `PAGE_WINDOW_SIZE` values for the whole life of
   * the surface, so no paging can ever mount or unmount a page.
   */
  key: string;
  /** The page this slot is currently drawing, in the pager's own coordinates. */
  pageIndex: number;
}

/** Which slot a page index lives in. Non-negative for negative indices too. */
function slotOf(pageIndex: number): number {
  return ((pageIndex % PAGE_WINDOW_SIZE) + PAGE_WINDOW_SIZE) % PAGE_WINDOW_SIZE;
}

/**
 * The mounted window centred on `baseIndex`, in slot order.
 *
 * Negative page indices are as ordinary as positive ones: the pager is not
 * clamped at the week it opened on, and a reader may page back into the past
 * exactly as far as they can page forward. Whether a *class* occurs in a week
 * they navigate to is a separate question, answered by the recurrence rule's
 * own `startsOn` — a past week legitimately draws an empty grid.
 */
export function weekPageWindow(baseIndex: number): WeekPageSlot[] {
  const slots: WeekPageSlot[] = new Array(PAGE_WINDOW_SIZE);
  for (let offset = -PAGE_WINDOW_RADIUS; offset <= PAGE_WINDOW_RADIUS; offset++) {
    const pageIndex = baseIndex + offset;
    slots[slotOf(pageIndex)] = { key: `week-slot-${slotOf(pageIndex)}`, pageIndex };
  }
  return slots;
}

/**
 * What moving the pager from one page to another has to do.
 *
 * Two cases, and the distinction is the whole of why Today is fast:
 *
 * - `"slide"` — the destination is a mounted neighbour, so it is one spring,
 *   the same animation and the same arrival a swipe gets.
 * - `"jump"` — it is not mounted, so there is nothing to slide along. The
 *   position is set and the week committed in one step. Nothing walks the weeks
 *   in between, nothing springs a hundred page-widths, and no intermediate week
 *   is ever built: `weekPageWindow` re-addresses its three slots straight onto
 *   the destination, so the cost is the same at one week's distance and at a
 *   hundred.
 *
 * Pure, and separated from the pager for the same reason the window is: this is
 * the rule that has to hold, and it can be asserted here rather than inferred
 * from a gesture on a device.
 */
export type PagerStep =
  | { kind: "none" }
  | { kind: "slide"; to: number }
  | { kind: "jump"; to: number };

export function pagerStep(from: number, target: number): PagerStep {
  const distance = target - from;
  if (distance === 0) return { kind: "none" };
  // One page either way is the only distance that is mounted to slide through.
  if (Math.abs(distance) > PAGE_WINDOW_RADIUS) return { kind: "jump", to: target };
  return { kind: "slide", to: from + Math.sign(distance) };
}

/**
 * Which pages are mounted, and which week each of them draws.
 *
 * Two numbers, because a direct jump and a slide move different things. A
 * slide moves the pager: `pos` springs to the neighbouring page and the window
 * re-centres on it afterwards. A jump must not move the pager at all — see
 * `directJump` — so it moves the *addressing* instead: `weekShift` is added to
 * every page index to name the week that page draws.
 */
export interface PagerAddress {
  /** Centre of the mounted window, in the pager's own page coordinates. */
  baseIndex: number;
  /** Weeks from the anchor week to the week drawn by page index 0. */
  weekShift: number;
}

/** The week a page draws, in weeks from the anchor week. */
export function weekOffsetOfPage(pageIndex: number, weekShift: number): number {
  return pageIndex + weekShift;
}

/**
 * Where a direct jump leaves the pager: on the page it was already resting on,
 * with that page re-addressed to draw the target week.
 *
 * This is the fix for Today blanking the grid. The jump used to move `pos` —
 * a shared value that lives on the UI thread — from the JS thread, and then
 * read it straight back to decide which week was now committed. A write from
 * the JS thread is only *queued* for the UI thread, so the read returned the
 * page the pager had just left, the commit decided nothing had changed, and the
 * window stayed centred a hundred weeks away. When the queued write landed,
 * `pos` was 0 and every mounted page sat about a hundred page-widths off
 * screen until a swipe happened to re-commit the window.
 *
 * Leaving `pos` where it is removes the whole class of problem rather than
 * re-ordering it. The page on screen stays on screen, its two neighbours stay
 * mounted either side of it, and all that changes is which weeks the three of
 * them draw — props on three existing slots, in one React commit. There is no
 * frame in which the pager is somewhere the pages are not.
 */
export function directJump(restingPage: number, targetWeek: number): PagerAddress {
  return { baseIndex: restingPage, weekShift: targetWeek - restingPage };
}

export interface PageInView {
  key: string;
  pageIndex: number;
  /** The week this page draws, in weeks from the anchor week. */
  weekOffset: number;
  /** Where the page sits, in page widths from the viewport: 0 is fully on screen. */
  offset: number;
}

/**
 * The mounted pages that overlap the viewport with the pager at `pos` — what
 * the user actually sees. Empty is the blank grid.
 */
export function pagesInView(address: PagerAddress, pos: number): PageInView[] {
  return weekPageWindow(address.baseIndex)
    .map((slot) => ({
      key: slot.key,
      pageIndex: slot.pageIndex,
      weekOffset: weekOffsetOfPage(slot.pageIndex, address.weekShift),
      offset: slot.pageIndex - pos,
    }))
    .filter((page) => Math.abs(page.offset) < 1);
}
