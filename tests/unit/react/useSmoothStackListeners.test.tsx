/**
 * useSmoothStackListeners tests — registration lifecycle + event forwarding.
 */

jest.mock('../../../src/core/types', () => jest.requireActual('./fakes').coreTypesModule());
jest.mock('../../../src/navigation/types', () => jest.requireActual('./fakes').navigationTypesModule());
jest.mock('../../../src/diagnostics/types', () => jest.requireActual('./fakes').diagnosticsTypesModule());

import { act, renderHook } from '@testing-library/react-native';
import { useSmoothStackListeners } from '../../../src/navigation/stack/useSmoothStackListeners';
import { useSmoothTask } from '../../../src/react/SmoothTaskContext';
import type { SmoothTaskContextValue } from '../../../src/react/types';
import { FakeNavigationCoordinator } from './fakes';
import { pump, twoRouteState, wrapper } from './harness';

describe('useSmoothStackListeners', () => {
  function useBoth(id?: string): {
    ctx: SmoothTaskContextValue;
    listeners: ReturnType<typeof useSmoothStackListeners>;
  } {
    return {
      ctx: useSmoothTask(),
      listeners: useSmoothStackListeners(id === undefined ? undefined : { id }),
    };
  }

  it('registers the navigator on mount and unregisters on unmount', async () => {
    const { result, unmount } = await renderHook(() => useBoth('root'), { wrapper });
    const coordinator = result.current.ctx.coordinator;
    expect(coordinator.navigatorCount).toBe(1);
    await unmount();
    expect(coordinator.navigatorCount).toBe(0);
  });

  it('generates a unique labelled instanceId per hook instance', async () => {
    const { result } = await renderHook(() => useBoth('root'), { wrapper });
    const coordinator = result.current.ctx.coordinator;
    if (coordinator instanceof FakeNavigationCoordinator) {
      const [reg] = coordinator.registrations;
      expect(reg?.kind).toBe('stack');
      expect(reg?.label).toBe('root');
      expect(reg?.instanceId).toMatch(/^stack:root:\d+$/);
    }
    const second = await renderHook(() => useBoth('root'), { wrapper });
    const secondCoordinator = second.result.current.ctx.coordinator;
    if (
      coordinator instanceof FakeNavigationCoordinator &&
      secondCoordinator instanceof FakeNavigationCoordinator
    ) {
      expect(secondCoordinator.registrations[0]?.instanceId).toMatch(/^stack:root:\d+$/);
      expect(secondCoordinator.registrations[0]?.instanceId).not.toBe(
        coordinator.registrations[0]?.instanceId
      );
    }
  });

  it('falls back to an anon label when no id is given', async () => {
    const { result } = await renderHook(() => useBoth(), { wrapper });
    const coordinator = result.current.ctx.coordinator;
    if (coordinator instanceof FakeNavigationCoordinator) {
      const [reg] = coordinator.registrations;
      expect(reg?.label).toBeUndefined();
      expect(reg?.instanceId).toMatch(/^stack:anon:\d+$/);
    }
  });

  it('forwards transitionStart/transitionEnd/gestureCancel/focus/blur to the coordinator', async () => {
    const { result } = await renderHook(() => useBoth('root'), { wrapper });
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
  });

  it('returns a referentially stable listeners object', async () => {
    const { result, rerender } = await renderHook(() => useBoth('x'), { wrapper });
    const first = result.current.listeners;
    await rerender({});
    expect(result.current.listeners).toBe(first);
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
