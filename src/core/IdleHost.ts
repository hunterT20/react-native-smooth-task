/**
 * Default IdleHost adapter.
 *
 * React Native provides `requestIdleCallback`/`cancelIdleCallback` on
 * globalThis — when both are functions we delegate directly. Otherwise we
 * fall back to `setTimeout(cb, 0)` and synthesize an IdleDeadline whose
 * `timeRemaining()` reports the remainder of a 50ms budget measured from
 * request time (`didTimeout` is always false — we never force expiry).
 */

import type { IdleDeadline, IdleHost } from './types';

/** Structural view of globalThis when an idle-callback facility exists. */
interface GlobalWithIdleCallbacks {
  requestIdleCallback?: (callback: (deadline: IdleDeadline) => void) => number;
  cancelIdleCallback?: (handle: number) => void;
}

/** Idle budget reported by the synthetic fallback deadline. */
const FALLBACK_IDLE_BUDGET_MS = 50;

export function createDefaultIdleHost(): IdleHost {
  const g = globalThis as unknown as GlobalWithIdleCallbacks;

  if (typeof g.requestIdleCallback === 'function' && typeof g.cancelIdleCallback === 'function') {
    const request = g.requestIdleCallback;
    const cancel = g.cancelIdleCallback;
    return {
      request: (callback) => request.call(g, callback),
      cancel: (handle) => cancel.call(g, handle),
    };
  }

  // Fallback: own a handle → native timer map so cancel() is exact.
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let nextHandle = 1;

  return {
    request: (callback) => {
      const handle = nextHandle++;
      const requestedAt = Date.now();
      const timer = setTimeout(() => {
        timers.delete(handle);
        const deadline: IdleDeadline = {
          didTimeout: false,
          timeRemaining: () => Math.max(0, FALLBACK_IDLE_BUDGET_MS - (Date.now() - requestedAt)),
        };
        callback(deadline);
      }, 0);
      timers.set(handle, timer);
      return handle;
    },
    cancel: (handle) => {
      const timer = timers.get(handle);
      if (timer !== undefined) {
        clearTimeout(timer);
        timers.delete(handle);
      }
    },
  };
}
