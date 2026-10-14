/**
 * Default host adapters: wall-clock timers and a gate that never blocks.
 */

import type { EligibilityGate, TimerHost } from './types';

/** TimerHost backed by the global setTimeout/clearTimeout/Date.now. */
export function createDefaultTimerHost(): TimerHost {
  return {
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (handle) =>
      globalThis.clearTimeout(handle as Parameters<typeof globalThis.clearTimeout>[0]),
    now: () => Date.now(),
  };
}

/**
 * Gate where every scope is always eligible. Used when the scheduler runs
 * without a navigation coordinator (standalone app-scope usage).
 */
export function createOpenGate(): EligibilityGate {
  return {
    isEligible: () => true,
    subscribe: () => () => undefined,
  };
}
