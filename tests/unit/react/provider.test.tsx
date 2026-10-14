/**
 * SmoothTaskProvider + SmoothTaskContext tests.
 */

jest.mock('../../../src/core/types', () => jest.requireActual('./fakes').coreTypesModule());
jest.mock('../../../src/navigation/types', () => jest.requireActual('./fakes').navigationTypesModule());
jest.mock('../../../src/diagnostics/types', () => jest.requireActual('./fakes').diagnosticsTypesModule());

import React, { type ReactNode } from 'react';
import { AppState } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { SmoothTaskProvider } from '../../../src/react/SmoothTaskProvider';
import { useSmoothTask } from '../../../src/react/SmoothTaskContext';
import { useDeferredMount } from '../../../src/react/useDeferredMount';
import type { DiagnosticEvent } from '../../../src/diagnostics/types';
import { twoRouteState, wrapper } from './harness';

const addEventListenerMock = AppState.addEventListener as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SmoothTaskProvider', () => {
  it('provides scheduler + coordinator + diagnostics through context', async () => {
    const { result } = await renderHook(() => useSmoothTask(), { wrapper });
    expect(result.current.scheduler).toBeDefined();
    expect(result.current.coordinator).toBeDefined();
    expect(result.current.diagnostics).toBeDefined();
    expect(typeof result.current.scheduler.schedule).toBe('function');
    expect(typeof result.current.coordinator.setNavigationState).toBe('function');
    expect(typeof result.current.diagnostics.subscribe).toBe('function');
  });

  it('throws a descriptive error when useSmoothTask has no provider', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    let caught: unknown;
    try {
      await renderHook(() => useSmoothTask());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toContain(
      'react-native-smooth-task: useSmoothTask must be used within <SmoothTaskProvider>'
    );
    consoleSpy.mockRestore();
  });

  it('names the calling hook in the missing-provider error', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    let caught: unknown;
    try {
      await renderHook(() => useDeferredMount());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toContain('useDeferredMount must be used within <SmoothTaskProvider>');
    consoleSpy.mockRestore();
  });

  it('wires AppState changes to coordinator.setAppActive', async () => {
    const { result } = await renderHook(() => useSmoothTask(), { wrapper });
    const coordinator = result.current.coordinator;
    const setAppActiveSpy = jest.spyOn(coordinator, 'setAppActive');

    expect(addEventListenerMock).toHaveBeenCalledWith('change', expect.any(Function));
    const handler = addEventListenerMock.mock.calls[0]?.[1] as (state: string) => void;

    // route-a focused with no barrier → settled while app is active
    await act(() => coordinator.setNavigationState(twoRouteState(0)));
    expect(coordinator.getRouteStatus('route-a').settled).toBe(true);

    await act(() => handler('background'));
    expect(setAppActiveSpy).toHaveBeenCalledWith(false);
    // appActive=false must make route scopes ineligible
    expect(coordinator.getRouteStatus('route-a').settled).toBe(false);
    expect(coordinator.isEligible('app')).toBe(true); // app scope never gated

    await act(() => handler('active'));
    expect(setAppActiveSpy).toHaveBeenLastCalledWith(true);
    expect(coordinator.getRouteStatus('route-a').settled).toBe(true);
  });

  it('does not subscribe to AppState when pauseInBackground={false}', async () => {
    const noPause = ({ children }: { children?: ReactNode }) => (
      <SmoothTaskProvider pauseInBackground={false}>{children}</SmoothTaskProvider>
    );
    await renderHook(() => useSmoothTask(), { wrapper: noPause });
    expect(addEventListenerMock).not.toHaveBeenCalled();
  });

  it('disposes scheduler and coordinator on unmount', async () => {
    const { result, unmount } = await renderHook(() => useSmoothTask(), { wrapper });
    const schedulerDispose = jest.spyOn(result.current.scheduler, 'dispose');
    const coordinatorDispose = jest.spyOn(result.current.coordinator, 'dispose');
    const subscriptionRemove = addEventListenerMock.mock.results[0]?.value.remove as jest.Mock;

    await unmount();
    expect(schedulerDispose).toHaveBeenCalledTimes(1);
    expect(coordinatorDispose).toHaveBeenCalledTimes(1);
    expect(subscriptionRemove).toHaveBeenCalled();
  });

  it('keeps the same context value across re-renders', async () => {
    const Probe = ({ children }: { children?: ReactNode }) => (
      <SmoothTaskProvider>{children}</SmoothTaskProvider>
    );
    const { result, rerender } = await renderHook(() => useSmoothTask(), { wrapper: Probe });
    const first = result.current;
    await rerender({});
    expect(result.current).toBe(first);
  });

  describe('diagnostics prop', () => {
    const event: DiagnosticEvent = {
      level: 'warn',
      code: 'test-event',
      message: 'hello',
      timestamp: 1,
    };

    it('undefined → noop sink (no throw, subscribers still work)', async () => {
      const { result } = await renderHook(() => useSmoothTask(), { wrapper });
      const seen: DiagnosticEvent[] = [];
      result.current.diagnostics.subscribe((e) => seen.push(e));
      expect(() => result.current.diagnostics.emit(event)).not.toThrow();
      expect(seen).toHaveLength(1);
    });

    it('custom sink object receives emitted events', async () => {
      const events: DiagnosticEvent[] = [];
      const withSink = ({ children }: { children?: ReactNode }) => (
        <SmoothTaskProvider diagnostics={{ emit: (e) => events.push(e) }}>
          {children}
        </SmoothTaskProvider>
      );
      const { result } = await renderHook(() => useSmoothTask(), { wrapper: withSink });
      await act(() => result.current.diagnostics.emit(event));
      expect(events).toEqual([event]);
    });

    it('true → console sink forwards by level', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const withConsole = ({ children }: { children?: ReactNode }) => (
        <SmoothTaskProvider diagnostics={true}>{children}</SmoothTaskProvider>
      );
      const { result } = await renderHook(() => useSmoothTask(), { wrapper: withConsole });
      await act(() => result.current.diagnostics.emit(event));
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
