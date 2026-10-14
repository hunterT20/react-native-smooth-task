/**
 * useSmoothNavigationContainer — produces the `onReady` / `onStateChange`
 * props for a React Navigation <NavigationContainer> so the coordinator sees
 * the navigation state tree.
 *
 *   const observers = useSmoothNavigationContainer({ navigationRef });
 *   <NavigationContainer ref={navigationRef} {...observers} />
 *
 * Internal observers always run first; user callbacks are composed after.
 * The returned object is referentially stable so consumers can inline props.
 */

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import type { NavigationTreeState } from '../navigation/types';
import { useSmoothTask } from './SmoothTaskContext';
import type {
  NavigationContainerObservers,
  UseSmoothNavigationContainerOptions,
} from './types';

/** Shape of the object React Navigation's container ref points at. */
export interface NavigationContainerRefLike {
  current?: {
    getRootState?: () => NavigationTreeState | null | undefined;
  } | null;
}

export interface SmoothNavigationContainerOptions extends UseSmoothNavigationContainerOptions {
  /**
   * Resolve the current root navigation state (e.g.
   * `() => navigationRef.getRootState()`). Preferred over `navigationRef`
   * when both are provided.
   */
  getRootState?: () => NavigationTreeState | null | undefined;
  /**
   * The ref object attached to <NavigationContainer> — its
   * `current.getRootState()` is used to resolve the initial state on ready.
   */
  navigationRef?: NavigationContainerRefLike | null;
}

const MISSING_NAV_REF_MESSAGE =
  'react-native-smooth-task: no navigation state available on ready. Pass ' +
  '`navigationRef` or `getRootState` to useSmoothNavigationContainer so the ' +
  'initial state can be delivered; falling back to the first onStateChange.';

export function useSmoothNavigationContainer(
  options?: SmoothNavigationContainerOptions
): NavigationContainerObservers {
  const { coordinator, diagnostics } = useSmoothTask('useSmoothNavigationContainer');

  // Latest options via ref so the returned callbacks can be stable while
  // consumers pass inline props. Updated in the commit phase — before any
  // passive effects or external event dispatches can observe it stale.
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
  });
  const warnedMissingRef = useRef(false);

  const onReady = useCallback(() => {
    const opts = optionsRef.current;
    const state = opts?.getRootState?.() ?? opts?.navigationRef?.current?.getRootState?.();
    if (state != null) {
      coordinator.setNavigationState(state);
    } else if (!warnedMissingRef.current) {
      warnedMissingRef.current = true;
      diagnostics.emit({
        level: 'warn',
        code: 'missing-nav-ref',
        message: MISSING_NAV_REF_MESSAGE,
        timestamp: Date.now(),
      });
    }
    opts?.onReady?.();
  }, [coordinator, diagnostics]);

  const onStateChange = useCallback(
    (state: NavigationTreeState | undefined) => {
      coordinator.setNavigationState(state);
      optionsRef.current?.onStateChange?.(state);
    },
    [coordinator]
  );

  return useMemo(() => ({ onReady, onStateChange }), [onReady, onStateChange]);
}
