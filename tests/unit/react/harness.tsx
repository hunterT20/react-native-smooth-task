/**
 * Shared test harness for the react layer:
 *  - provider wrappers for render/renderHook
 *  - pump(): flush fake schedulers + pending macrotasks inside act()
 *  - NavigationTreeState fixture builders
 *
 * Requires the contract module mocks from ./fakes to be registered by the
 * importing test file (jest.mock calls must live in the test file itself).
 */

import React, { type ReactNode } from 'react';
import { act } from '@testing-library/react-native';
import type { NavigationRouteState, NavigationTreeState } from '../../../src/navigation/types';
import { SmoothTaskProvider } from '../../../src/react/SmoothTaskProvider';
import type { SmoothTaskProviderProps } from '../../../src/react/types';
import { flushAllSchedulers } from './fakes';

export function createWrapper(providerProps?: SmoothTaskProviderProps) {
  return function Wrapper({ children }: { children?: ReactNode }) {
    return <SmoothTaskProvider {...providerProps}>{children}</SmoothTaskProvider>;
  };
}

export const wrapper = createWrapper();

/**
 * Advance the world: run every pending eligible fake-scheduler task and let
 * pending macrotasks (fake idle host, real implementations) settle.
 */
export async function pump(times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      flushAllSchedulers();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
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
