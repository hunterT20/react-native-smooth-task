/**
 * Hook-level integration tests — REAL SmoothTaskProvider + real coordinator
 * + real scheduler, exercised through the public hooks. Only
 * `@react-navigation/native`'s `useRoute` is mocked (route-scoped hooks read
 * the route key from it); no library module is mocked.
 *
 * Covers the React-side release-matrix cases: T12, T13, T14, T15, T19, T21,
 * T24 — plus root (app-scope) sanity and provider/provider-less errors.
 *
 * Determinism: everything flows through real timers inside `act`; `flush()`
 * drains pending macrotask turns and the setTimeout-backed idle host.
 */

jest.mock('@react-navigation/native', () => ({
  useRoute: jest.fn(),
}));

import React, { StrictMode, type ReactNode } from 'react';
import { Text } from 'react-native';
import { act, render, renderHook, screen } from '@testing-library/react-native';
import { useRoute } from '@react-navigation/native';
import { SmoothTaskProvider } from '../../src/react/SmoothTaskProvider';
import { useSmoothTask } from '../../src/react/SmoothTaskContext';
import { useDeferredMount } from '../../src/react/useDeferredMount';
import { useAfterTransition as useRouteAfterTransition } from '../../src/react/routeScoped/useAfterTransition';
import { useDeferredMount as useRouteDeferredMount } from '../../src/react/routeScoped/useDeferredMount';
import { useIdleTask as useRouteIdleTask } from '../../src/react/routeScoped/useIdleTask';
import { useSmoothStackListeners } from '../../src/navigation/stack/useSmoothStackListeners';
import type { NavigationCoordinator } from '../../src/navigation/types';
import type { SmoothTaskContextValue } from '../../src/react/types';
import { twoRouteState } from '../unit/react/harness';

const useRouteMock = useRoute as jest.Mock;

const wrapper = ({ children }: { children?: ReactNode }) => (
  <SmoothTaskProvider>{children}</SmoothTaskProvider>
);

const strictWrapper = ({ children }: { children?: ReactNode }) => (
  <StrictMode>
    <SmoothTaskProvider>{children}</SmoothTaskProvider>
  </StrictMode>
);

function useCtx(): SmoothTaskContextValue {
  return useSmoothTask();
}

/** Drain real macrotasks inside act — covers continuations + idle fallback. */
async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  useRouteMock.mockReturnValue({ key: 'route-a', name: 'route-a' });
});

describe('T21 — missing provider diagnostics', () => {
  it('hooks throw a clear error outside SmoothTaskProvider', async () => {
    // React logs the throw; assert the message reaches the test.
    await expect(renderHook(() => useDeferredMount())).rejects.toThrow(
      /must be used within <SmoothTaskProvider>/
    );
  });
});

describe('T12/T13 — once vs every-focus', () => {
  it('T12: mode once — callback starts exactly once across 10 refocuses', async () => {
    const cb = jest.fn();
    const { result } = await renderHook(
      () => ({ ctx: useCtx(), run: useRouteAfterTransition(cb, { mode: 'once' }) }),
      { wrapper }
    );
    const coordinator = result.current.ctx.coordinator;
    for (let i = 0; i < 10; i++) {
      await act(() => coordinator.setNavigationState(twoRouteState(0))); // focus a
      await flush(2);
      await act(() => coordinator.setNavigationState(twoRouteState(1))); // blur
      await flush(2);
    }
    await act(() => coordinator.setNavigationState(twoRouteState(0)));
    await flush();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('T13: every-focus — one run per focus epoch, not per barrier churn', async () => {
    const cb = jest.fn();
    const { result } = await renderHook(
      () => ({ ctx: useCtx(), run: useRouteAfterTransition(cb, { mode: 'every-focus' }) }),
      { wrapper }
    );
    const coordinator: NavigationCoordinator = result.current.ctx.coordinator;

    // epoch 1
    await act(() => coordinator.setNavigationState(twoRouteState(0)));
    await flush();
    expect(cb).toHaveBeenCalledTimes(1);

    // Barrier churn while focused must NOT re-run (no new epoch).
    await act(() => coordinator.transitionStarted('route-a'));
    await act(() => coordinator.transitionFinished('route-a'));
    await flush();
    expect(cb).toHaveBeenCalledTimes(1);

    // Blur → refocus: second epoch → second run.
    await act(() => coordinator.setNavigationState(twoRouteState(1)));
    await act(() => coordinator.setNavigationState(twoRouteState(0)));
    await flush();
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

describe('T14/T15 — unmount and cancellation', () => {
  it('T14: component unmounted while pending — callback never runs', async () => {
    const cb = jest.fn();
    const { result, unmount } = await renderHook(
      () => ({ ctx: useCtx(), run: useRouteAfterTransition(cb) }),
      { wrapper }
    );
    const coordinator = result.current.ctx.coordinator;
    // Keep the route unsettled (no state delivered), then unmount.
    await unmount();
    await act(() => coordinator.setNavigationState(twoRouteState(0)));
    await flush();
    expect(cb).not.toHaveBeenCalled();
  });

  it('T15: cancelling a running async task aborts its signal', async () => {
    let observedSignal: AbortSignal | null = null;
    const { result, unmount } = await renderHook(
      () => ({ ctx: useCtx(), schedule: useRouteIdleTask() }),
      { wrapper }
    );
    const coordinator = result.current.ctx.coordinator;
    await act(() => coordinator.setNavigationState(twoRouteState(0)));

    let handle: ReturnType<typeof result.current.schedule> | null = null;
    await act(() => {
      handle = result.current.schedule(async (signal) => {
        observedSignal = signal;
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    });
    await flush(2); // idle host fires → task starts
    expect(observedSignal).not.toBeNull();
    expect(observedSignal!.aborted).toBe(false);
    await act(() => handle!.cancel());
    expect(observedSignal!.aborted).toBe(true);
    await unmount();
  });
});

describe('T19 — React StrictMode double-mount', () => {
  it('no double execution outside the contract', async () => {
    const cb = jest.fn();
    useRouteMock.mockReturnValue({ key: 'route-a', name: 'route-a' });
    const { result } = await renderHook(
      () => ({ ctx: useCtx(), run: useRouteAfterTransition(cb, { mode: 'once' }) }),
      { wrapper: strictWrapper }
    );
    await act(() => result.current.ctx.coordinator.setNavigationState(twoRouteState(0)));
    await flush();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('T24 — repeated mount/unmount leaves no leaks', () => {
  it('navigator registrations and pending tasks return to zero', async () => {
    const { result, unmount } = await renderHook(
      () => ({
        ctx: useCtx(),
        listeners: useSmoothStackListeners({ id: 'root' }),
        ready: useRouteDeferredMount(),
      }),
      { wrapper }
    );
    const coordinator = result.current.ctx.coordinator;
    expect(coordinator.navigatorCount).toBe(1);

    // Mount/unmount a heavy-hook child 25 times.
    for (let i = 0; i < 25; i++) {
      const inner = await renderHook(
        () => ({ ready: useRouteDeferredMount(), after: useRouteAfterTransition(jest.fn()) }),
        { wrapper }
      );
      await inner.unmount();
    }
    expect(coordinator.navigatorCount).toBe(1); // outer navigator still registered
    await unmount();
    expect(coordinator.navigatorCount).toBe(0);
    expect(result.current.ctx.scheduler.getPendingCount()).toBe(0);
  });
});

describe('root entry — app scope without navigation', () => {
  it('useDeferredMount resolves without any navigation wiring', async () => {
    const seen: string[] = [];
    function Screen() {
      const ready = useDeferredMount();
      seen.push(ready ? 'ready' : 'skeleton');
      return <Text>{ready ? 'ready' : 'skeleton'}</Text>;
    }
    await render(
      <SmoothTaskProvider>
        <Screen />
      </SmoothTaskProvider>
    );
    await flush();
    // First render showed the fallback; the task ran inside the same act.
    expect(seen[0]).toBe('skeleton');
    expect(screen.getByText('ready')).toBeTruthy();
  });
});
