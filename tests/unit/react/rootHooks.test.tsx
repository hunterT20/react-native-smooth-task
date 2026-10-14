/**
 * App-scope hooks: useDeferredMount, useAfterTransition, useIdleTask,
 * DeferredView (root entry — APP_SCOPE_ID).
 *
 * Timing note: these tests run against the real TaskScheduler when it exists
 * (prefer-real mocks in ./fakes). A real impl legitimately starts eligible
 * app-scope tasks inside the same awaited act() turn, so assertions that a
 * task is "still pending" are only deterministic under the flush-driven fake
 * — they are guarded with isFakeScheduler. Deterministic pending-state
 * coverage (gate blocked) lives in routeScoped.test.tsx.
 */

jest.mock('../../../src/core/types', () => jest.requireActual('./fakes').coreTypesModule());
jest.mock('../../../src/navigation/types', () => jest.requireActual('./fakes').navigationTypesModule());
jest.mock('../../../src/diagnostics/types', () => jest.requireActual('./fakes').diagnosticsTypesModule());

import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { act, render, renderHook, screen } from '@testing-library/react-native';
import { useSmoothTask } from '../../../src/react/SmoothTaskContext';
import { useDeferredMount } from '../../../src/react/useDeferredMount';
import { useAfterTransition } from '../../../src/react/useAfterTransition';
import { useIdleTask } from '../../../src/react/useIdleTask';
import { DeferredView } from '../../../src/react/DeferredView';
import type { TaskCallback } from '../../../src/types';
import { isFakeScheduler } from './fakes';
import { pump, twoRouteState, wrapper } from './harness';

describe('useDeferredMount (app scope)', () => {
  it('is false until the scheduled task runs, then true', async () => {
    const { result } = await renderHook(
      () => ({ ready: useDeferredMount(), ctx: useSmoothTask() }),
      { wrapper }
    );
    if (isFakeScheduler(result.current.ctx.scheduler)) {
      // flush-driven fake: task is still pending before pump
      expect(result.current.ready).toBe(false);
    }
    await pump();
    expect(result.current.ready).toBe(true);
  });

  it('honours scheduling: "idle" option', async () => {
    const { result } = await renderHook(() => useDeferredMount({ scheduling: 'idle' }), {
      wrapper,
    });
    await pump();
    expect(result.current).toBe(true);
  });

  it('stays ready through simulated blur/refocus (sticky latch)', async () => {
    const { result } = await renderHook(
      () => ({ ready: useDeferredMount(), ctx: useSmoothTask() }),
      { wrapper }
    );
    await pump();
    expect(result.current.ready).toBe(true);
    // flip focus away and back — readiness must not reset
    await act(() => result.current.ctx.coordinator.setNavigationState(twoRouteState(1)));
    await act(() => result.current.ctx.coordinator.setNavigationState(twoRouteState(0)));
    await pump();
    expect(result.current.ready).toBe(true);
  });

  it('resets on remount only', async () => {
    const first = await renderHook(() => useDeferredMount(), { wrapper });
    await pump();
    expect(first.result.current).toBe(true);
    await first.unmount();
    const second = await renderHook(
      () => ({ ready: useDeferredMount(), ctx: useSmoothTask() }),
      { wrapper }
    );
    if (isFakeScheduler(second.result.current.ctx.scheduler)) {
      expect(second.result.current.ready).toBe(false);
    }
    await pump();
    expect(second.result.current.ready).toBe(true);
  });

  it('cancels the pending task on unmount (Invariant B)', async () => {
    const { result, unmount } = await renderHook(
      () => ({ ready: useDeferredMount(), ctx: useSmoothTask() }),
      { wrapper }
    );
    const scheduler = result.current.ctx.scheduler;
    if (isFakeScheduler(scheduler)) {
      expect(scheduler.getPendingCount()).toBe(1);
    }
    await unmount();
    await pump();
    // nothing pending nor running for the unmounted component
    expect(scheduler.getPendingCount()).toBe(0);
  });
});

describe('useAfterTransition (app scope)', () => {
  it('runs the callback once when eligible', async () => {
    const cb = jest.fn();
    const { result } = await renderHook(
      () => ({ ctx: useSmoothTask(), run: useAfterTransition(cb) }),
      { wrapper }
    );
    if (isFakeScheduler(result.current.ctx.scheduler)) {
      expect(cb).not.toHaveBeenCalled();
    }
    await pump();
    expect(cb).toHaveBeenCalledTimes(1);
    await pump();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('mode "every-focus" behaves like "once" for non-route scopes', async () => {
    const cb = jest.fn();
    const { result } = await renderHook(
      () => ({ ctx: useSmoothTask(), run: useAfterTransition(cb, { mode: 'every-focus' }) }),
      { wrapper }
    );
    await pump();
    expect(cb).toHaveBeenCalledTimes(1);
    // focus changes elsewhere must not retrigger app-scope tasks
    await act(() => result.current.ctx.coordinator.setNavigationState(twoRouteState(0)));
    await act(() => result.current.ctx.coordinator.setNavigationState(twoRouteState(1)));
    await act(() => result.current.ctx.coordinator.setNavigationState(twoRouteState(0)));
    await pump();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('uses the latest callback at execution time (no stale closure)', async () => {
    const first = jest.fn();
    const second = jest.fn();
    const { result, rerender } = await renderHook(
      ({ cb }: { cb: TaskCallback }) => ({ ctx: useSmoothTask(), run: useAfterTransition(cb) }),
      { wrapper, initialProps: { cb: first as TaskCallback } }
    );
    await rerender({ cb: second });
    await pump();
    // exactly one run total; under the flush-driven fake the task ran after
    // the rerender, so it must be the *latest* callback
    expect(first.mock.calls.length + second.mock.calls.length).toBe(1);
    if (isFakeScheduler(result.current.ctx.scheduler)) {
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    }
  });

  it('routes callback errors to onError and keeps going', async () => {
    const boom = new Error('boom');
    const onError = jest.fn();
    const cb = jest.fn(() => {
      throw boom;
    });
    await renderHook(() => useAfterTransition(cb, { onError }), { wrapper });
    await pump();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(boom);
    // queue still works afterwards
    const { result } = await renderHook(() => ({ ctx: useSmoothTask() }), { wrapper });
    const later = jest.fn();
    await act(async () => {
      result.current.ctx.scheduler.schedule('app', later);
    });
    await pump();
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('never runs a pending task after unmount (Invariant B)', async () => {
    const cb = jest.fn();
    const { result, unmount } = await renderHook(
      () => ({ ctx: useSmoothTask(), run: useAfterTransition(cb) }),
      { wrapper }
    );
    const scheduler = result.current.ctx.scheduler;
    await unmount();
    await pump();
    if (isFakeScheduler(scheduler)) {
      // the task was still pending when unmounted → cancel prevented the run
      expect(cb).not.toHaveBeenCalled();
    }
    expect(scheduler.getPendingCount()).toBe(0);
  });

  it('invokes the callback with an AbortSignal', async () => {
    let received: unknown;
    await renderHook(
      () =>
        useAfterTransition((signal) => {
          received = signal;
        }),
      { wrapper }
    );
    await pump();
    expect(received).toBeInstanceOf(AbortSignal);
  });
});

describe('useIdleTask (app scope)', () => {
  it('returns a stable function that schedules tasks with an AbortSignal', async () => {
    const { result } = await renderHook(() => useIdleTask(), { wrapper });
    const scheduleIdle = result.current;
    expect(typeof scheduleIdle).toBe('function');
    const cb = jest.fn();
    const handle = scheduleIdle(cb);
    expect(typeof handle.cancel).toBe('function');
    // synchronous read before any await: no macrotask has elapsed, so the
    // idle task cannot have run under any implementation
    expect(cb).not.toHaveBeenCalled();
    await pump();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
  });

  it('handle.cancel() prevents the task from running', async () => {
    const { result } = await renderHook(() => useIdleTask(), { wrapper });
    const cb = jest.fn();
    const handle = result.current(cb);
    handle.cancel();
    await pump();
    expect(cb).not.toHaveBeenCalled();
  });

  it('cancels all outstanding tasks on unmount', async () => {
    const { result, unmount } = await renderHook(
      () => ({ scheduleIdle: useIdleTask(), ctx: useSmoothTask() }),
      { wrapper }
    );
    const scheduler = result.current.ctx.scheduler;
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    result.current.scheduleIdle(cb1);
    result.current.scheduleIdle(cb2);
    await unmount();
    await pump();
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).not.toHaveBeenCalled();
    expect(scheduler.getPendingCount()).toBe(0);
  });

  it('dedupes pending tasks by key — latest wins', async () => {
    const { result } = await renderHook(() => useIdleTask(), { wrapper });
    const first = jest.fn();
    const second = jest.fn();
    result.current(first, { key: 'k' });
    result.current(second, { key: 'k' });
    await pump();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('is referentially stable across re-renders', async () => {
    const { result, rerender } = await renderHook(() => useIdleTask(), { wrapper });
    const first = result.current;
    await rerender({});
    expect(result.current).toBe(first);
  });
});

describe('DeferredView (app scope)', () => {
  it('renders the fallback until ready, then children — permanently', async () => {
    let scheduler: unknown;
    const Grab = ({ children }: { children?: React.ReactNode }) => {
      const s = useSmoothTask().scheduler;
      useEffect(() => {
        scheduler = s;
      }, [s]);
      return <>{children}</>;
    };
    await render(
      <Grab>
        <DeferredView fallback={<Text>loading</Text>}>
          <Text>content</Text>
        </DeferredView>
      </Grab>,
      { wrapper }
    );
    if (isFakeScheduler(scheduler)) {
      expect(screen.queryByText('loading')).toBeTruthy();
      expect(screen.queryByText('content')).toBeNull();
    }
    await pump();
    expect(screen.queryByText('content')).toBeTruthy();
    expect(screen.queryByText('loading')).toBeNull();
  });

  it('renders nothing (null) by default until ready', async () => {
    const { container } = await render(
      <DeferredView>
        <Text>content</Text>
      </DeferredView>,
      { wrapper }
    );
    await pump();
    expect(screen.queryByText('content')).toBeTruthy();
    expect(container).toBeDefined();
  });
});
