/**
 * Shared test harness for the react layer:
 *  - provider wrappers for render/renderHook
 *  - pump(): let pending macrotasks settle inside act()
 *  - useBlockedGate(): hold every scope ineligible until released
 *  - NavigationTreeState fixture builders
 *
 * Tests run against the real TaskScheduler + NavigationCoordinator that
 * <SmoothTaskProvider> creates.
 */

import React, { useState, type ReactNode } from 'react';
import { act } from '@testing-library/react-native';
import type { NavigationRouteState, NavigationTreeState } from '../../../src/navigation/types';
import { useSmoothTask } from '../../../src/react/SmoothTaskContext';
import { SmoothTaskProvider } from '../../../src/react/SmoothTaskProvider';
import type { SmoothTaskProviderProps } from '../../../src/react/types';

export function createWrapper(providerProps?: SmoothTaskProviderProps) {
  return function Wrapper({ children }: { children?: ReactNode }) {
    return <SmoothTaskProvider {...providerProps}>{children}</SmoothTaskProvider>;
  };
}

export const wrapper = createWrapper();

/**
 * Advance the world: let pending macrotasks (drain continuations, idle
 * callbacks) settle.
 */
export async function pump(times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  }
}

/**
 * Hold every scope (app scope included) ineligible on the provider's
 * coordinator, so scheduled tasks stay pending deterministically. Call it
 * before the hooks under test in the same component: the gate is blocked
 * during the first render, i.e. before any scheduling effect runs.
 *
 * Returns `release()`: restores the real gate and broadcasts so the
 * scheduler revalidates its pending tasks.
 */
export function useBlockedGate(): () => Promise<void> {
  const { coordinator } = useSmoothTask();
  const [release] = useState(() => {
    const isEligible = jest.spyOn(coordinator, 'isEligible').mockReturnValue(false);
    return async () => {
      isEligible.mockRestore();
      // An AppState round-trip is a gate broadcast that leaves the app active
      // (the jest AppState mock never reports a state, so it starts active).
      await act(() => {
        coordinator.setAppActive(false);
        coordinator.setAppActive(true);
      });
    };
  });
  return release;
}

/** Shorthand: a plain route entry for a state fixture. */
export function routeState(key: string, nested?: NavigationTreeState): NavigationRouteState {
  return {
    key,
    name: key,
    ...(nested !== undefined ? { state: nested } : {}),
  };
}

/** Shorthand: a NavigationTreeState fixture. */
export function navState(routes: NavigationRouteState[], index?: number): NavigationTreeState {
  return { routes, ...(index !== undefined ? { index } : {}) };
}

/**
 * A two-screen root state where `focusedKey` holds the index. The route keys
 * default to 'route-a' and 'route-b'.
 */
export function twoRouteState(focusedIndex: number): NavigationTreeState {
  return navState([routeState('route-a'), routeState('route-b')], focusedIndex);
}
