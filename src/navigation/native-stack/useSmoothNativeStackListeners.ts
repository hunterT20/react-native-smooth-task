/**
 * useSmoothNativeStackListeners — feed a native-stack navigator's
 * transition/focus events into the NavigationCoordinator.
 *
 *   const screenListeners = useSmoothNativeStackListeners({ id: 'root' });
 *   <NativeStack.Navigator screenListeners={screenListeners}>…</NativeStack.Navigator>
 *
 * Event fidelity differs from the JS stack: events are driven by the native
 * side via react-native-screens.
 * - `transitionStart`/`transitionEnd` correlate with the native transition.
 * - `gestureCancel` is iOS-only (swipe-back cancel). Android native-stack
 *   never emits it — the mapping is harmless there.
 * - Screens mounted with `animation: 'none'` may emit the pair in the same
 *   frame; if a `transitionEnd` never arrives the barrier stays open and a
 *   `stalled-transition` diagnostic warns after ~4s.
 *
 * The returned object is a referentially stable {eventName: handler} map —
 * pass it straight to `screenListeners`.
 *
 * Registration: each hook instance registers a unique `instanceId`
 * (`native-stack:<id|anon>:<n>`) on mount and unregisters on unmount.
 */

import { useMemo } from 'react';
import type { NativeStackNavigationEventMap } from '@react-navigation/native-stack';
import {
  createNavigatorListeners,
  type NavigatorListenerEvent,
  type NavigatorListeners,
} from '../listeners';
import { useNavigatorRegistration } from '../../react/useNavigatorRegistration';
import { useSmoothTask } from '../../react/SmoothTaskContext';
import type { SmoothStackListenersOptions } from '../../react/types';

type EventData<Name extends keyof NativeStackNavigationEventMap> =
  NativeStackNavigationEventMap[Name]['data'];

/** Event payload shape delivered by native-stack screen listeners. */
export interface NativeStackListenerEvent<
  Name extends keyof NativeStackNavigationEventMap,
> extends NavigatorListenerEvent {
  readonly data?: EventData<Name>;
}

export interface NativeStackLifecycleEvent {
  readonly target?: string;
}

/**
 * The listeners object handed to <NativeStack.Navigator screenListeners={…}>.
 * Same five events as the JS stack adapter; native-stack simply lacks
 * gestureStart/gestureEnd (which smooth-task does not use).
 */
export interface SmoothNativeStackListeners extends NavigatorListeners {
  transitionStart(e?: NativeStackListenerEvent<'transitionStart'>): void;
  transitionEnd(e?: NativeStackListenerEvent<'transitionEnd'>): void;
  gestureCancel(e?: NativeStackListenerEvent<'gestureCancel'>): void;
}

export function useSmoothNativeStackListeners(
  options?: SmoothStackListenersOptions
): SmoothNativeStackListeners {
  const { coordinator } = useSmoothTask('useSmoothNativeStackListeners');
  useNavigatorRegistration(coordinator, 'native-stack', options?.id);
  return useMemo(() => createNavigatorListeners(coordinator), [coordinator]);
}
