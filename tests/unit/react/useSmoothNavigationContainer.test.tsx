/**
 * useSmoothNavigationContainer tests.
 */

jest.mock('../../../src/core/types', () => jest.requireActual('./fakes').coreTypesModule());
jest.mock('../../../src/navigation/types', () => jest.requireActual('./fakes').navigationTypesModule());
jest.mock('../../../src/diagnostics/types', () => jest.requireActual('./fakes').diagnosticsTypesModule());

import { act, renderHook } from '@testing-library/react-native';
import { useSmoothTask } from '../../../src/react/SmoothTaskContext';
import {
  useSmoothNavigationContainer,
  type SmoothNavigationContainerOptions,
} from '../../../src/react/useSmoothNavigationContainer';
import type { DiagnosticEvent } from '../../../src/diagnostics/types';
import type { NavigationTreeState } from '../../../src/navigation/types';
import type { SmoothTaskContextValue } from '../../../src/react/types';
import type { NavigationContainerObservers } from '../../../src/react/types';
import { twoRouteState, wrapper } from './harness';

function useBoth(options?: SmoothNavigationContainerOptions): {
  ctx: SmoothTaskContextValue;
  observers: NavigationContainerObservers;
} {
  return { ctx: useSmoothTask(), observers: useSmoothNavigationContainer(options) };
}

describe('useSmoothNavigationContainer', () => {
  it('onStateChange feeds the coordinator, then calls the user callback', async () => {
    const calls: Array<{ state: unknown; readyAtCall: boolean }> = [];
    const { result } = await renderHook(
      () =>
        useBoth({
          onStateChange: (state) =>
            calls.push({ state, readyAtCall: result.current.ctx.coordinator.ready }),
        }),
      { wrapper }
    );
    const state = twoRouteState(0);
    await act(() => result.current.observers.onStateChange(state));
    expect(result.current.ctx.coordinator.ready).toBe(true);
    expect(result.current.ctx.coordinator.getRouteStatus('route-a').exists).toBe(true);
    expect(result.current.ctx.coordinator.getRouteStatus('route-a').focusedOnPath).toBe(true);
    // user callback ran AFTER the internal feed (ready already true)
    expect(calls).toEqual([{ state, readyAtCall: true }]);
  });

  it('onReady resolves initial state via navigationRef.getRootState, then calls user onReady', async () => {
    const order: string[] = [];
    const state = twoRouteState(1);
    const navigationRef = { current: { getRootState: () => state } };
    const { result } = await renderHook(
      () =>
        useBoth({
          navigationRef,
          onReady: () => {
            order.push('user');
          },
        }),
      { wrapper }
    );
    expect(result.current.ctx.coordinator.ready).toBe(false);
    await act(() => result.current.observers.onReady());
    expect(result.current.ctx.coordinator.ready).toBe(true);
    expect(result.current.ctx.coordinator.getRouteStatus('route-b').focusedOnPath).toBe(true);
    expect(order).toEqual(['user']);
  });

  it('onReady prefers options.getRootState over navigationRef', async () => {
    const stateA = twoRouteState(0);
    const stateB = navStateDifferent();
    const { result } = await renderHook(
      () =>
        useBoth({
          getRootState: () => stateB,
          navigationRef: { current: { getRootState: () => stateA } },
        }),
      { wrapper }
    );
    await act(() => result.current.observers.onReady());
    expect(result.current.ctx.coordinator.getRouteStatus('route-z').exists).toBe(true);
    expect(result.current.ctx.coordinator.getRouteStatus('route-a').exists).toBe(false);
  });

  it('emits a missing-nav-ref warning once when no state source resolves', async () => {
    const events: DiagnosticEvent[] = [];
    const userOnReady = jest.fn();
    const { result } = await renderHook(() => useBoth({ onReady: userOnReady }), { wrapper });
    result.current.ctx.diagnostics.subscribe((e) => events.push(e));

    await act(() => result.current.observers.onReady());
    await act(() => result.current.observers.onReady()); // second call: no second warn
    const warnings = events.filter((e) => e.code === 'missing-nav-ref');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.level).toBe('warn');
    // degraded but functional: user onReady still ran, state still deliverable later
    expect(userOnReady).toHaveBeenCalledTimes(2);
    expect(result.current.ctx.coordinator.ready).toBe(false);
    await act(() => result.current.observers.onStateChange(twoRouteState(0)));
    expect(result.current.ctx.coordinator.ready).toBe(true);
  });

  it('does not warn when navigationRef exists but state resolves through onStateChange', async () => {
    const events: DiagnosticEvent[] = [];
    const { result } = await renderHook(() => useBoth(), { wrapper });
    result.current.ctx.diagnostics.subscribe((e) => events.push(e));
    await act(() => result.current.observers.onStateChange(twoRouteState(0)));
    expect(events.some((e) => e.code === 'missing-nav-ref')).toBe(false);
  });

  it('returned observers are stable and use the latest user callbacks', async () => {
    const first = jest.fn();
    const second = jest.fn();
    const { result, rerender } = await renderHook(
      ({ onStateChange }: { onStateChange: (state: NavigationTreeState | undefined) => void }) =>
        useBoth({ onStateChange }),
      { wrapper, initialProps: { onStateChange: first } }
    );
    const observers = result.current.observers;
    await rerender({ onStateChange: second });
    expect(result.current.observers).toBe(observers); // stable reference
    await act(() => result.current.observers.onStateChange(twoRouteState(0)));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

function navStateDifferent() {
  return { index: 0, routes: [{ key: 'route-z', name: 'route-z' }] };
}
