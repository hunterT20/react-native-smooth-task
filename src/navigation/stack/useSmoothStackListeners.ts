/**
 * useSmoothStackListeners — feed a stack navigator's transition/focus events
 * into the NavigationCoordinator.
 *
 *   const screenListeners = useSmoothStackListeners({ id: 'root' });
 *   <Stack.Navigator screenListeners={screenListeners}>…</Stack.Navigator>
 *
 * The returned object is a plain {eventName: handler} map — referentially
 * stable for the lifetime of the hook, so it can be passed straight to
 * `screenListeners` without causing re-renders. No screenOptions or
 * component wrapping is needed.
 *
 * Registration: each hook instance registers a unique `instanceId`
 * (`stack:<id|anon>:<n>`) on mount and unregisters on unmount.
 */

import { useEffect, useMemo } from 'react';
import type { StackNavigationEventMap } from '@react-navigation/stack';
import type { NavigatorRegistration } from '../types';
import { useSmoothTask } from '../../react/SmoothTaskContext';
import type { SmoothStackListenersOptions } from '../../react/types';

type EventData<Name extends keyof StackNavigationEventMap> = StackNavigationEventMap[Name]['data'];

/** Structural event payload delivered by React Navigation listeners. */
export interface StackListenerEvent<Name extends keyof StackNavigationEventMap> {
  readonly target?: string;
  readonly data?: EventData<Name>;
}

export interface StackLifecycleEvent {
  readonly target?: string;
}

/**
 * The listeners object handed to <Stack.Navigator screenListeners={…}>.
 * Every handler defensively ignores events without a string `target`.
 */
export interface SmoothStackListeners {
  transitionStart(e?: StackListenerEvent<'transitionStart'>): void;
  transitionEnd(e?: StackListenerEvent<'transitionEnd'>): void;
  gestureCancel(e?: StackListenerEvent<'gestureCancel'>): void;
  focus(e?: StackLifecycleEvent): void;
  blur(e?: StackLifecycleEvent): void;
}

let instanceCounter = 0;

export function useSmoothStackListeners(
  options?: SmoothStackListenersOptions
): SmoothStackListeners {
  const { coordinator } = useSmoothTask('useSmoothStackListeners');
  const id = options?.id;

  // Unique instanceId generated inside the effect — render stays pure.
  // If `id` changes the navigator is re-registered under a fresh instanceId.
  useEffect(() => {
    instanceCounter += 1;
    const registration: NavigatorRegistration = {
      instanceId: `stack:${id ?? 'anon'}:${instanceCounter}`,
      kind: 'stack',
      ...(id !== undefined ? { label: id } : {}),
    };
    coordinator.registerNavigator(registration);
    return () => coordinator.unregisterNavigator(registration.instanceId);
  }, [coordinator, id]);

  return useMemo<SmoothStackListeners>(
    () => ({
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
    }),
    [coordinator]
  );
}
