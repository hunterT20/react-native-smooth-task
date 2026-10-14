/**
 * Route-scoped hooks (src/react/routeScoped/*): same APIs bound to
 * `route:<useRoute().key>` — gated by the route's settled status.
 *
 * Determinism note: these tests run against the real TaskScheduler when it
 * exists. A real impl starts eligible tasks on the next macrotask, which may
 * be inside the same awaited act(). To keep tasks *pending* under any impl,
 * barriers are opened before (or atomically with) the state feed that would
 * make the route eligible — the task is never eligible at any timer tick.
 */

jest.mock('../../../src/core/types', () => jest.requireActual('./fakes').coreTypesModule());
jest.mock('../../../src/navigation/types', () => jest.requireActual('./fakes').navigationTypesModule());
jest.mock('../../../src/diagnostics/types', () => jest.requireActual('./fakes').diagnosticsTypesModule());
jest.mock('@react-navigation/native', () => ({
  useRoute: jest.fn(),
}));

import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { act, render, renderHook, screen } from '@testing-library/react-native';
import { useRoute } from '@react-navigation/native';
import { useSmoothTask } from '../../../src/react/SmoothTaskContext';
import { useDeferredMount } from '../../../src/react/routeScoped/useDeferredMount';
import { useAfterTransition } from '../../../src/react/routeScoped/useAfterTransition';
import { useIdleTask } from '../../../src/react/routeScoped/useIdleTask';
import { DeferredView } from '../../../src/react/routeScoped/DeferredView';
import type { NavigationCoordinator } from '../../../src/navigation/types';
import type { SmoothTaskContextValue } from '../../../src/react/types';
import type { TaskCallback } from '../../../src/types';
import { navState, pump, routeState, twoRouteState, wrapper } from './harness';

const useRouteMock = useRoute as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  useRouteMock.mockReturnValue({ key: 'route-a', name: 'route-a' });
});

function useCtx(): SmoothTaskContextValue {
  return useSmoothTask();
}

async function feed(coordinator: NavigationCoordinator, index = 0) {
  await act(() => coordinator.setNavigationState(twoRouteState(index)));
}

describe('route-scoped useDeferredMount', () => {
  it('stays false before any navigation state, true once the route settles', async () => {
    const { result } = await renderHook(() => ({ ready: useDeferredMount(), ctx: useCtx() }), {
      wrapper,
    });
    const coordinator = result.current.ctx.coordinator;
    await pump();
    expect(result.current.ready).toBe(false); // no state yet → not settled
    await feed(coordinator, 0); // route-a focused
    await pump();
    expect(result.current.ready).toBe(true);
  });

  it('waits out an open transition barrier on the route navigator', async () => {
    const { result } = await renderHook(() => ({ ready: useDeferredMount(), ctx: useCtx() }), {
      wrapper,
    });
    const coordinator = result.current.ctx.coordinator;
    // barrier opens before the state that would make route-a eligible
    await act(() => {
      coordinator.transitionStarted('route-a');
      coordinator.setNavigationState(twoRouteState(0));
    });
    await pump();
    expect(result.current.ready).toBe(false); // negative: barrier open → no run
    expect(coordinator.getRouteStatus('route-a').hasPendingTransition).toBe(true);
    await act(() => coordinator.transitionFinished('route-a'));
    await pump();
    expect(result.current.ready).toBe(true);
  });

  it('stays false while the route is not on the focused path', async () => {
    const { result } = await renderHook(() => ({ ready: useDeferredMount(), ctx: useCtx() }), {
      wrapper,
    });
    const coordinator = result.current.ctx.coordinator;
    await feed(coordinator, 1); // route-b focused, route-a not
    await pump();
    expect(result.current.ready).toBe(false);
    expect(coordinator.getRouteStatus('route-a').settled).toBe(false);
    await feed(coordinator, 0); // route-a focused now
    await pump();
    expect(result.current.ready).toBe(true);
  });

  it('is blocked by a barrier on an ancestor navigator (nested route)', async () => {
    useRouteMock.mockReturnValue({ key: 'child', name: 'child' });
    const { result } = await renderHook(() => ({ ready: useDeferredMount(), ctx: useCtx() }), {
      wrapper,
    });
    const coordinator = result.current.ctx.coordinator;
    // 'child' lives inside 'parent' → its navigator node id is 'parent'.
    // Phase 1: sibling focused — 'child' exists but is not on the focus path.
    await act(() =>
      coordinator.setNavigationState(
        navState([routeState('sibling'), routeState('parent', navState([routeState('child')], 0))], 0)
      )
    );
    // Phase 2: open the barrier on the nested navigator while child is still
    // unfocused (sync-draining schedulers must never see it eligible).
    await act(() => coordinator.transitionStarted('child'));
    // Phase 3: focus parent+child — the 'parent' navNode barrier blocks child.
    await act(() =>
      coordinator.setNavigationState(
        navState([routeState('sibling'), routeState('parent', navState([routeState('child')], 0))], 1)
      )
    );
    await pump();
    expect(result.current.ready).toBe(false); // ancestor barrier blocks child
    // the barrier is scoped to the nested navigator: 'parent' itself settled
    expect(coordinator.getRouteStatus('child').hasPendingTransition).toBe(true);
    expect(coordinator.getRouteStatus('parent').settled).toBe(true);
    await act(() => coordinator.transitionFinished('child'));
    await pump();
    expect(result.current.ready).toBe(true);
  });

  it('is sticky — blur/refocus after ready does not reset', async () => {
    const { result } = await renderHook(() => ({ ready: useDeferredMount(), ctx: useCtx() }), {
      wrapper,
    });
    const coordinator = result.current.ctx.coordinator;
    await feed(coordinator, 0);
    await pump();
    expect(result.current.ready).toBe(true);
    await feed(coordinator, 1); // blur
    await pump();
    expect(result.current.ready).toBe(true);
    await feed(coordinator, 0); // refocus
    await pump();
    expect(result.current.ready).toBe(true);
  });
});

describe('route-scoped useAfterTransition', () => {
  it('mode "once" runs a single time even across refocuses', async () => {
    const cb = jest.fn();
    const { result } = await renderHook(() => ({ ctx: useCtx(), run: useAfterTransition(cb) }), {
      wrapper,
    });
    const coordinator = result.current.ctx.coordinator;
    await feed(coordinator, 0);
    await pump();
    expect(cb).toHaveBeenCalledTimes(1);
    // blur → refocus must NOT retrigger 'once'
    await feed(coordinator, 1);
    await feed(coordinator, 0);
    await pump();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('mode "every-focus" runs once per focus epoch', async () => {
    const cb = jest.fn();
    const { result } = await renderHook(
      () => ({ ctx: useCtx(), run: useAfterTransition(cb, { mode: 'every-focus' }) }),
      { wrapper }
    );
    const coordinator = result.current.ctx.coordinator;
    await feed(coordinator, 0); // focus epoch 1
    await pump();
    expect(cb).toHaveBeenCalledTimes(1);

    await feed(coordinator, 1); // blur
    await feed(coordinator, 0); // refocus → epoch 2 → re-arm
    await pump();
    expect(cb).toHaveBeenCalledTimes(2);

    // barrier churn while focus is retained does not create a new epoch
    await act(() => coordinator.transitionStarted('route-a'));
    await act(() => coordinator.transitionFinished('route-a'));
    await pump();
    expect(cb).toHaveBeenCalledTimes(2);

    await feed(coordinator, 1);
    await feed(coordinator, 0); // epoch 3
    await pump();
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('every-focus: a task pending across blur never runs twice (dedupe)', async () => {
    const cb = jest.fn();
    const { result } = await renderHook(
      () => ({ ctx: useCtx(), run: useAfterTransition(cb, { mode: 'every-focus' }) }),
      { wrapper }
    );
    const coordinator = result.current.ctx.coordinator;
    // barrier open for the entire armed window → nothing can run early
    await act(() => coordinator.transitionStarted('route-a'));
    await feed(coordinator, 0); // epoch 1, task armed but blocked
    await pump();
    expect(cb).not.toHaveBeenCalled();
    await feed(coordinator, 1); // blur while pending
    await feed(coordinator, 0); // refocus → epoch 2 → dedupe replaces pending task
    await act(() => coordinator.transitionFinished('route-a'));
    await pump();
    expect(cb).toHaveBeenCalledTimes(1); // ran once, not once per armed task
  });

  it('does not run while a transition barrier is open on its navigator', async () => {
    const cb = jest.fn();
    const { result } = await renderHook(() => ({ ctx: useCtx(), run: useAfterTransition(cb) }), {
      wrapper,
    });
    const coordinator = result.current.ctx.coordinator;
    // sibling screen starts a transition → shared '<root>' navigator barrier
    await act(() => {
      coordinator.transitionStarted('route-b');
      coordinator.setNavigationState(twoRouteState(0));
    });
    await pump();
    expect(cb).not.toHaveBeenCalled(); // sibling's barrier blocks route-a's navigator
    await act(() => coordinator.transitionFinished('route-b'));
    await pump();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('uses the latest callback after re-render', async () => {
    const first = jest.fn();
    const second = jest.fn();
    const { result, rerender } = await renderHook(
      ({ cb }: { cb: TaskCallback }) => ({ ctx: useCtx(), run: useAfterTransition(cb) }),
      { wrapper, initialProps: { cb: first as TaskCallback } }
    );
    const coordinator = result.current.ctx.coordinator;
    // arm the task while the route is blocked so it is still pending
    // when the callback prop changes
    await act(() => {
      coordinator.transitionStarted('route-a');
      coordinator.setNavigationState(twoRouteState(0));
    });
    await rerender({ cb: second });
    await act(() => coordinator.transitionFinished('route-a'));
    await pump();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('route-scoped useIdleTask', () => {
  it('holds tasks while the route is not settled, runs when it settles', async () => {
    const cb = jest.fn();
    const { result } = await renderHook(
      () => ({ ctx: useCtx(), scheduleIdle: useIdleTask() }),
      { wrapper }
    );
    const coordinator = result.current.ctx.coordinator;
    await act(() => {
      coordinator.transitionStarted('route-a');
      coordinator.setNavigationState(twoRouteState(0));
    });
    result.current.scheduleIdle(cb);
    await pump();
    expect(cb).not.toHaveBeenCalled(); // route not settled → task waits
    await act(() => coordinator.transitionFinished('route-a'));
    await pump();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('route-scoped DeferredView', () => {
  it('swaps fallback → children only after the route settles', async () => {
    let coordinator: NavigationCoordinator | null = null;
    const Probe = () => {
      const c = useSmoothTask().coordinator;
      // assign captured value after commit, not during render
      useEffect(() => {
        coordinator = c;
      }, [c]);
      return null;
    };
    await render(
      <>
        <Probe />
        <DeferredView fallback={<Text>loading</Text>}>
          <Text>content</Text>
        </DeferredView>
      </>,
      { wrapper }
    );
    // blocked from the start: barrier open + state fed atomically
    await act(() => {
      coordinator!.transitionStarted('route-a');
      coordinator!.setNavigationState(twoRouteState(0));
    });
    await pump();
    expect(screen.queryByText('loading')).toBeTruthy();
    expect(screen.queryByText('content')).toBeNull();
    await act(() => coordinator!.transitionFinished('route-a'));
    await pump();
    expect(screen.queryByText('content')).toBeTruthy();
    expect(screen.queryByText('loading')).toBeNull();
  });
});
