/**
 * useSmoothStackListeners — feed a JS stack navigator's transition/focus
 * events into the NavigationCoordinator.
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

import { useMemo } from 'react';
import type { StackNavigationEventMap } from '@react-navigation/stack';
import {
  createNavigatorListeners,
  type NavigatorListenerEvent,
  type NavigatorListeners,
} from '../listeners';
import { useNavigatorRegistration } from '../../react/useNavigatorRegistration';
import { useSmoothTask } from '../../react/SmoothTaskContext';
import type { SmoothStackListenersOptions } from '../../react/types';

type EventData<Name extends keyof StackNavigationEventMap> = StackNavigationEventMap[Name]['data'];

/** Event payload shape delivered by stack screen listeners. */
export interface StackListenerEvent<
  Name extends keyof StackNavigationEventMap,
> extends NavigatorListenerEvent {
  readonly data?: EventData<Name>;
}

export interface StackLifecycleEvent {
  readonly target?: string;
}

/** The listeners object handed to <Stack.Navigator screenListeners={…}>. */
export interface SmoothStackListeners extends NavigatorListeners {
  transitionStart(e?: StackListenerEvent<'transitionStart'>): void;
  transitionEnd(e?: StackListenerEvent<'transitionEnd'>): void;
  gestureCancel(e?: StackListenerEvent<'gestureCancel'>): void;
}

export function useSmoothStackListeners(
  options?: SmoothStackListenersOptions
): SmoothStackListeners {
  const { coordinator } = useSmoothTask('useSmoothStackListeners');
  useNavigatorRegistration(coordinator, 'stack', options?.id);
  const animationEnabled = options?.animationEnabled;
  return useMemo(
    () =>
      createNavigatorListeners(
        coordinator,
        animationEnabled !== undefined ? { animationEnabled } : undefined
      ),
    [coordinator, animationEnabled]
  );
}
