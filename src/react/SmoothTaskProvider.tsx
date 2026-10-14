/**
 * <SmoothTaskProvider> — owns the NavigationCoordinator + TaskScheduler pair
 * for the React tree below it.
 *
 * Lifecycle:
 *  - Both are created exactly once (lazy ref init) and disposed on unmount.
 *  - Unless `pauseInBackground={false}`, React Native AppState 'change'
 *    events are forwarded to `coordinator.setAppActive(state === 'active')`.
 *    App-scoped tasks are never affected by AppState.
 *
 * Diagnostics prop:
 *  - `true`      → console sink
 *  - sink object → used as-is
 *  - undefined   → noop sink
 *  All events also fan out to `context.diagnostics.subscribe` listeners.
 */

import { useEffect, useState, type ReactElement } from 'react';
import { AppState } from 'react-native';
import { createTaskScheduler } from '../core/TaskScheduler';
import { createDefaultIdleHost } from '../core/IdleHost';
import type { DiagnosticsSink } from '../diagnostics/types';
import { createConsoleDiagnosticsSink, NOOP_DIAGNOSTICS } from '../diagnostics/Diagnostics';
import type { Diagnostics, DiagnosticListener } from '../diagnostics/types';
import { createNavigationCoordinator } from '../navigation/NavigationCoordinator';
import { SmoothTaskContext } from './SmoothTaskContext';
import type { SmoothTaskContextValue, SmoothTaskProviderProps } from './types';

function resolveDiagnosticsSink(prop: SmoothTaskProviderProps['diagnostics']): DiagnosticsSink {
  if (prop === true) return createConsoleDiagnosticsSink();
  if (typeof prop === 'object' && prop !== null && typeof prop.emit === 'function') return prop;
  return NOOP_DIAGNOSTICS;
}

/**
 * Wrap a plain sink into the `Diagnostics` shape exposed on the context
 * (sink + subscribe). Events go to both the sink and the subscribers.
 */
function createDiagnosticsChannel(sink: DiagnosticsSink): Diagnostics {
  const listeners = new Set<DiagnosticListener>();
  return {
    emit(event) {
      try {
        sink.emit(event);
      } catch {
        // a broken sink must never take the app down
      }
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch {
          // same for subscribers
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function SmoothTaskProvider({
  children,
  diagnostics: diagnosticsProp,
  pauseInBackground,
}: SmoothTaskProviderProps): ReactElement {
  // Created exactly once — the scheduler/coordinator pair must be stable for
  // the lifetime of the provider (lazy state initializer runs once).
  const [value] = useState<SmoothTaskContextValue>(() => {
    const diagnostics = createDiagnosticsChannel(resolveDiagnosticsSink(diagnosticsProp));
    const coordinator = createNavigationCoordinator({ diagnostics });
    const scheduler = createTaskScheduler({
      gate: coordinator,
      idleHost: createDefaultIdleHost(),
      diagnostics,
    });
    return { scheduler, coordinator, diagnostics };
  });

  // Forward AppState to the coordinator (default on).
  const pause = pauseInBackground !== false;
  useEffect(() => {
    if (!pause) return undefined;
    const { coordinator } = value;
    // Feed the current state when it is a known value. AppState.currentState
    // may be null early on some platforms — in that case leave the
    // coordinator default untouched rather than wrongly gating route tasks.
    const current = AppState.currentState;
    if (typeof current === 'string') {
      coordinator.setAppActive(current === 'active');
    }
    const subscription = AppState.addEventListener('change', (state) => {
      coordinator.setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, [pause, value]);

  // Dispose both on unmount (scheduler first — it subscribes to the gate).
  useEffect(() => {
    return () => {
      value.scheduler.dispose();
      value.coordinator.dispose();
    };
  }, [value]);

  return <SmoothTaskContext.Provider value={value}>{children}</SmoothTaskContext.Provider>;
}
