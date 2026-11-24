/**
 * The web build's version of `util/haptics`: no haptics in a browser.
 *
 * Desktops have no vibration motor, and the one mobile browser API there is
 * (`navigator.vibrate`) is a buzz, not a detent tick — worse than nothing on
 * a wheel that ticks once per value. So every tick is a deliberate no-op, and
 * the diagnostics panel says why rather than reporting a failure.
 *
 * Every export is typed against the native file (`typeof Native.*`), and
 * `harness/architecture.mjs` checks they export the same names.
 */

import type * as Native from "@/util/haptics";

export type { HapticKind, HapticsDiagnostics } from "@/util/haptics";

export const selectionTick: typeof Native.selectionTick = () => {};

export const activationTick: typeof Native.activationTick = () => {};

export const getHapticsDiagnostics: typeof Native.getHapticsDiagnostics = () => ({
  moduleResolved: false,
  platform: "web",
  androidEffects: { selection: "unavailable", activation: "unavailable" },
  successCount: 0,
  lastError: null,
});

export const probeHaptic: typeof Native.probeHaptic = async () => ({
  ok: false,
  error: "haptics are not available in a browser",
});
