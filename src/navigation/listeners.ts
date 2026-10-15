/**
 * Shared navigator listener factory — pure TypeScript.
 *
 * Both the JS stack adapter and the native-stack adapter forward the same
 * five navigator events into coordinator calls. Event `data` payloads and
 * typing differ per navigator, but every handler needs only `e.target`
 * (the route key that fired the listener), so the implementation is shared.
 */

import type { NavigationCoordinator } from './types';

/** Structural event payload delivered by React Navigation screen listeners. */
export interface NavigatorListenerEvent {
  readonly target?: string;
}

/**
 * The plain listener map handed to a navigator's `screenListeners` prop.
 * Handlers defensively ignore events without a string `target`.
 *
 * Event availability notes:
 * - `gestureCancel` fires on the JS stack and on native-stack (iOS only).
 *   Android native-stack never emits it — safe to keep mapped anyway.
 */
export interface NavigatorListeners {
  transitionStart(e?: NavigatorListenerEvent): void;
  transitionEnd(e?: NavigatorListenerEvent): void;
  gestureCancel(e?: NavigatorListenerEvent): void;
  focus(e?: NavigatorListenerEvent): void;
  blur(e?: NavigatorListenerEvent): void;
}

export interface NavigatorListenersOptions {
  /**
   * When false, transition events are ignored entirely — no barriers are
   * opened and no recovery is awaited. Use for navigators whose screens
   * disable animation (JS stack `animationEnabled: false`, native-stack
   * `animation: 'none'`). Ignoring gestureCancel here is REQUIRED: a
   * forwarded cancel would open a barrier waiting on a `transitionEnd`
   * the platform may never emit for non-animated screens.
   */
  animationEnabled?: boolean;
}

export function createNavigatorListeners(
  coordinator: NavigationCoordinator,
  options?: NavigatorListenersOptions
): NavigatorListeners {
  const forwardTransitions = options?.animationEnabled !== false;
  const noop = () => undefined;
  return {
    transitionStart(e) {
      const target = e?.target;
      if (forwardTransitions && typeof target === 'string') {
        coordinator.transitionStarted(target);
      }
    },
    transitionEnd(e) {
      const target = e?.target;
      if (forwardTransitions && typeof target === 'string') {
        coordinator.transitionFinished(target);
      }
    },
    gestureCancel: forwardTransitions
      ? (e) => {
          const target = e?.target;
          if (typeof target === 'string') coordinator.gestureCancelled(target);
        }
      : noop,
    focus(e) {
      const target = e?.target;
      if (typeof target === 'string') coordinator.routeFocused(target);
    },
    blur(e) {
      const target = e?.target;
      if (typeof target === 'string') coordinator.routeBlurred(target);
    },
  };
}
