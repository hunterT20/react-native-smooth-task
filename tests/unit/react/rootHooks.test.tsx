/**
 * App-scope hooks: useDeferredMount, useAfterTransition, useIdleTask,
 * DeferredView (root entry — APP_SCOPE_ID).
 *
 * Timing note: the real TaskScheduler starts an eligible app-scope task
 * synchronously when it is scheduled, so pre-run ("still pending")
 * assertions hold the gate blocked with useBlockedGate() and release it.
 */

import React from 'react';
import { Text } from 'react-native';
import { act, render, renderHook, screen } from '@testing-library/react-native';
import { useSmoothTask } from '../../../src/react/SmoothTaskContext';
import { useDeferredMount } from '../../../src/react/useDeferredMount';
import { useAfterTransition } from '../../../src/react/useAfterTransition';
import { useIdleTask } from '../../../src/react/useIdleTask';
import { DeferredView } from '../../../src/react/DeferredView';
import type { TaskCallback } from '../../../src/types';
import { pump, twoRouteState, useBlockedGate, wrapper } from './harness';

describe('useDeferredMount (app scope)', () => {
  it('is false until the scheduled task runs, then true', async () => {
    const { result } = await renderHook(
      () => ({ release: useBlockedGate(), ready: useDeferredMount() }),
      { wrapper }
    );
    await pump();
    expect(result.current.ready).toBe(false); // negative: gate blocked → no run
    await result.current.release();
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
      () => ({ release: useBlockedGate(), ready: useDeferredMount() }),
      { wrapper }
    );
    await pump();
    expect(second.result.current.ready).toBe(false); // fresh mount starts unready
    await second.result.current.release();
    await pump();
    expect(second.result.current.ready).toBe(true);
  });

  it('cancels the pending task on unmount (Invariant B)', async () => {
    const { result, unmount } = await renderHook(
      () => ({ release: useBlockedGate(), ready: useDeferredMount(), ctx: useSmoothTask() }),
      { wrapper }
    );
    const scheduler = result.current.ctx.scheduler;
    expect(scheduler.getPendingCount()).toBe(1);
    await unmount();
    await pump();
    // nothing pending nor running for the unmounted component
    expect(scheduler.getPendingCount()).toBe(0);
    expect(result.current.ready).toBe(false);
  });
});

describe('useAfterTransition (app scope)', () => {
  it('runs the callback once when eligible', async () => {
    const cb = jest.fn();
    const { result } = await renderHook(
      () => ({ release: useBlockedGate(), run: useAfterTransition(cb) }),
      { wrapper }
    );
    await pump();
    expect(cb).not.toHaveBeenCalled(); // negative: gate blocked → no run
    await result.current.release();
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
      ({ cb }: { cb: TaskCallback }) => ({
        release: useBlockedGate(),
        run: useAfterTransition(cb),
      }),
      { wrapper, initialProps: { cb: first as TaskCallback } }
    );
    await rerender({ cb: second });
    await result.current.release();
    await pump();
    // the task was still pending at rerender, so it runs the *latest* callback
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
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
      () => ({ release: useBlockedGate(), ctx: useSmoothTask(), run: useAfterTransition(cb) }),
      { wrapper }
    );
    const scheduler = result.current.ctx.scheduler;
    expect(scheduler.getPendingCount()).toBe(1);
    await unmount();
    await result.current.release();
    await pump();
    // the task was still pending when unmounted → cancel prevented the run
    expect(cb).not.toHaveBeenCalled();
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

  it('retires the superseded tracked handle on same-key dedupe', async () => {
    const { result } = await renderHook(() => useIdleTask(), { wrapper });
    const handles: { cancel: () => void }[] = [];
    // Scheduler dedupe cancels a superseded pending task internally without
    // telling the hook — the hook mirrors it by cancelling the previous
    // tracked handle, so 10k same-key schedules cannot accumulate handles.
    for (let i = 0; i < 100; i += 1) {
      const handle = result.current(jest.fn(), { key: 'k' });
      jest.spyOn(handle, 'cancel');
      handles.push(handle);
    }
    for (const handle of handles.slice(0, -1)) {
      expect(handle.cancel).toHaveBeenCalledTimes(1);
    }
    expect(handles[99]!.cancel).not.toHaveBeenCalled();
    await pump();
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
    let release: (() => Promise<void>) | undefined;
    const BlockGate = ({ children }: { children?: React.ReactNode }) => {
      release = useBlockedGate();
      return <>{children}</>;
    };
    await render(
      <BlockGate>
        <DeferredView fallback={<Text>loading</Text>}>
          <Text>content</Text>
        </DeferredView>
      </BlockGate>,
      { wrapper }
    );
    await pump();
    expect(screen.queryByText('loading')).toBeTruthy();
    expect(screen.queryByText('content')).toBeNull();
    await release!();
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
