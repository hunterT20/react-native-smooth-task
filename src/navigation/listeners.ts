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

export function createNavigatorListeners(coordinator: NavigationCoordinator): NavigatorListeners {
  return {
    transitionStart(e) {
      const target = e?.target;
      if (typeof target === 'string') coordinator.transitionStarted(target);
    },
    transitionEnd(e) {
      const target = e?.target;
      if (typeof target === 'string') coordinator.transitionFinished(target);
    },
    gestureCancel(e) {
      const target = e?.target;
      if (typeof target === 'string') coordinator.gestureCancelled(target);
    },
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
