/**
 * Stack adapter tests — registration lifecycle + event forwarding, run
 * against both adapters (they share src/navigation/listeners.ts and differ
 * only in navigator `kind`). Native-stack emits the same five events
 * (transitionStart/transitionEnd/gestureCancel/focus/blur); gestureCancel is
 * iOS-only but maps to the same coordinator call.
 */

import { useState } from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { useSmoothStackListeners } from '../../../src/navigation/stack/useSmoothStackListeners';
import { useSmoothNativeStackListeners } from '../../../src/navigation/native-stack/useSmoothNativeStackListeners';
import { useSmoothTask } from '../../../src/react/SmoothTaskContext';
import type { NavigatorKind, NavigatorRegistration } from '../../../src/navigation/types';
import type { SmoothStackListenersOptions, SmoothTaskContextValue } from '../../../src/react/types';
import { pump, twoRouteState, wrapper } from './harness';

describe.each<{
  kind: NavigatorKind;
  useListeners: (
    options?: SmoothStackListenersOptions
  ) =>
    ReturnType<typeof useSmoothStackListeners> | ReturnType<typeof useSmoothNativeStackListeners>;
}>([
  { kind: 'stack', useListeners: useSmoothStackListeners },
  { kind: 'native-stack', useListeners: useSmoothNativeStackListeners },
])('$kind listeners', ({ kind, useListeners }) => {
  function useBoth(options?: SmoothStackListenersOptions): {
    ctx: SmoothTaskContextValue;
    registerNavigator: jest.SpyInstance<void, [NavigatorRegistration]>;
    listeners: ReturnType<typeof useListeners>;
  } {
    const ctx = useSmoothTask();
    // Spy during the first render — before the registration effect runs.
    const [registerNavigator] = useState(() => jest.spyOn(ctx.coordinator, 'registerNavigator'));
    return { ctx, registerNavigator, listeners: useListeners(options) };
  }

  const instanceIdPattern = (label: string) => new RegExp(`^${kind}:${label}:\\d+$`);

  it('registers the navigator on mount and unregisters on unmount', async () => {
    const { result, unmount } = await renderHook(() => useBoth({ id: 'root' }), { wrapper });
    const coordinator = result.current.ctx.coordinator;
    expect(coordinator.navigatorCount).toBe(1);
    await unmount();
    expect(coordinator.navigatorCount).toBe(0);
  });

  it('generates a unique labelled instanceId per hook instance', async () => {
    const first = await renderHook(() => useBoth({ id: 'root' }), { wrapper });
    expect(first.result.current.registerNavigator).toHaveBeenCalledTimes(1);
    const [reg] = first.result.current.registerNavigator.mock.calls[0]!;
    expect(reg.kind).toBe(kind);
    expect(reg.label).toBe('root');
    expect(reg.instanceId).toMatch(instanceIdPattern('root'));

    const second = await renderHook(() => useBoth({ id: 'root' }), { wrapper });
    expect(second.result.current.registerNavigator).toHaveBeenCalledTimes(1);
    const [secondReg] = second.result.current.registerNavigator.mock.calls[0]!;
    expect(secondReg.instanceId).toMatch(instanceIdPattern('root'));
    expect(secondReg.instanceId).not.toBe(reg.instanceId);
  });

  it('falls back to an anon label when no id is given', async () => {
    const { result } = await renderHook(() => useBoth(), { wrapper });
    expect(result.current.registerNavigator).toHaveBeenCalledTimes(1);
    const [reg] = result.current.registerNavigator.mock.calls[0]!;
    expect(reg.kind).toBe(kind);
    expect(reg.label).toBeUndefined();
    expect(reg.instanceId).toMatch(instanceIdPattern('anon'));
  });

  it('forwards transitionStart/transitionEnd/gestureCancel/focus/blur to the coordinator', async () => {
    const { result } = await renderHook(() => useBoth({ id: 'root' }), { wrapper });
    const coordinator = result.current.ctx.coordinator;
    const spies = {
      started: jest.spyOn(coordinator, 'transitionStarted'),
      finished: jest.spyOn(coordinator, 'transitionFinished'),
      cancelled: jest.spyOn(coordinator, 'gestureCancelled'),
      focused: jest.spyOn(coordinator, 'routeFocused'),
      blurred: jest.spyOn(coordinator, 'routeBlurred'),
    };
    const l = result.current.listeners;
    await act(() => l.transitionStart({ target: 'route-a' }));
    await act(() => l.transitionEnd({ target: 'route-a' }));
    await act(() => l.gestureCancel({ target: 'route-b' }));
    await act(() => l.focus({ target: 'route-c' }));
    await act(() => l.blur({ target: 'route-c' }));
    expect(spies.started).toHaveBeenCalledWith('route-a');
    expect(spies.finished).toHaveBeenCalledWith('route-a');
    expect(spies.cancelled).toHaveBeenCalledWith('route-b');
    expect(spies.focused).toHaveBeenCalledWith('route-c');
    expect(spies.blurred).toHaveBeenCalledWith('route-c');
  });

  it('drives real gating: transitionStart opens a barrier, transitionEnd closes it', async () => {
    const { result } = await renderHook(() => useBoth(), { wrapper });
    const coordinator = result.current.ctx.coordinator;
    const listeners = result.current.listeners;
    await act(() => coordinator.setNavigationState(twoRouteState(0)));
    expect(coordinator.getRouteStatus('route-a').hasPendingTransition).toBe(false);
    await act(() => listeners.transitionStart({ target: 'route-a' }));
    expect(coordinator.getRouteStatus('route-a').hasPendingTransition).toBe(true);
    expect(coordinator.getRouteStatus('route-a').settled).toBe(false);
    await act(() => listeners.transitionEnd({ target: 'route-a' }));
    expect(coordinator.getRouteStatus('route-a').hasPendingTransition).toBe(false);
    expect(coordinator.getRouteStatus('route-a').settled).toBe(true);
  });

  it('is defensive about malformed events', async () => {
    const { result } = await renderHook(() => useBoth(), { wrapper });
    const coordinator = result.current.ctx.coordinator;
    const started = jest.spyOn(coordinator, 'transitionStarted');
    const focused = jest.spyOn(coordinator, 'routeFocused');
    const blurred = jest.spyOn(coordinator, 'routeBlurred');
    const l = result.current.listeners as unknown as Record<
      string,
      ((e?: unknown) => void) | undefined
    >;
    await act(() => {
      l['transitionStart']?.(undefined);
      l['transitionStart']?.({});
      l['transitionStart']?.({ target: 42 });
      l['focus']?.();
      l['blur']?.({});
    });
    expect(started).not.toHaveBeenCalled();
    expect(focused).not.toHaveBeenCalled();
    expect(blurred).not.toHaveBeenCalled();
  });

  it('returns a referentially stable listeners object', async () => {
    const { result, rerender } = await renderHook(() => useBoth({ id: 'x' }), { wrapper });
    const first = result.current.listeners;
    await rerender({});
    expect(result.current.listeners).toBe(first);
  });

  it('animationEnabled:false ignores all transition events — no barrier ever opens', async () => {
    const { result } = await renderHook(() => useBoth({ animationEnabled: false }), { wrapper });
    const coordinator = result.current.ctx.coordinator;
    await act(() => coordinator.setNavigationState(twoRouteState(0)));
    const l = result.current.listeners;
    await act(() => l.transitionStart({ target: 'route-a' }));
    // gestureCancel must also be ignored — forwarding it would open a
    // barrier awaiting a transitionEnd that may never come.
    await act(() => l.gestureCancel({ target: 'route-a' }));
    expect(coordinator.getRouteStatus('route-a').hasPendingTransition).toBe(false);
    expect(coordinator.getRouteStatus('route-a').settled).toBe(true);
    // focus/blur still forward (diagnostic hints).
    const focused = jest.spyOn(coordinator, 'routeFocused');
    await act(() => l.focus({ target: 'route-a' }));
    expect(focused).toHaveBeenCalledWith('route-a');
  });

  it('keeps working while pump flushes scheduled tasks alongside', async () => {
    const { result } = await renderHook(() => useBoth(), { wrapper });
    const coordinator = result.current.ctx.coordinator;
    await act(() => coordinator.setNavigationState(twoRouteState(0)));
    await act(() => result.current.listeners.transitionStart({ target: 'route-a' }));
    await pump();
    expect(coordinator.getRouteStatus('route-a').settled).toBe(false);
    await act(() => result.current.listeners.transitionEnd({ target: 'route-a' }));
    await pump();
    expect(coordinator.getRouteStatus('route-a').settled).toBe(true);
  });
});

describe('native-stack listeners', () => {
  it('ignores the { closing } data payload on transitionStart/transitionEnd', async () => {
    const { result } = await renderHook(
      () => ({ ctx: useSmoothTask(), listeners: useSmoothNativeStackListeners({ id: 'root' }) }),
      { wrapper }
    );
    const coordinator = result.current.ctx.coordinator;
    const started = jest.spyOn(coordinator, 'transitionStarted');
    const finished = jest.spyOn(coordinator, 'transitionFinished');
    const l = result.current.listeners;
    await act(() => l.transitionStart({ target: 'route-a', data: { closing: true } }));
    await act(() => l.transitionEnd({ target: 'route-a', data: { closing: true } }));
    expect(started).toHaveBeenCalledWith('route-a');
    expect(finished).toHaveBeenCalledWith('route-a');
  });
});
