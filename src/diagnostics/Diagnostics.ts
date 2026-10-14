/**
 * Diagnostics implementations.
 *
 * The collector is the canonical timestamp authority: emitted events are
 * stamped with `now()` on arrival so sinks/tests see a coherent timeline
 * even when emitters run on different injected clocks.
 */

import type {
  DiagnosticEvent,
  DiagnosticListener,
  DiagnosticsCollector,
  DiagnosticsSink,
} from './types';

/**
 * In-memory collector for tests and dev tooling. Stores every stamped
 * event in `events` and forwards it to subscribers.
 */
export function createDiagnosticsCollector(now: () => number = Date.now): DiagnosticsCollector {
  const events: DiagnosticEvent[] = [];
  const listeners = new Set<DiagnosticListener>();

  return {
    events,

    emit(event: DiagnosticEvent): void {
      const stamped: DiagnosticEvent = { ...event, timestamp: now() };
      events.push(stamped);
      for (const listener of listeners) {
        listener(stamped);
      }
    },

    subscribe(listener: DiagnosticListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    clear(): void {
      events.length = 0;
    },
  };
}

/** Sink that drops every event. */
export const NOOP_DIAGNOSTICS: DiagnosticsSink = {
  emit: () => undefined,
};

/**
 * Sink that forwards events to console methods by level. Useful behind
 * the `diagnostics: true` provider flag.
 */
export function createConsoleDiagnosticsSink(now: () => number = Date.now): DiagnosticsSink {
  return {
    emit(event: DiagnosticEvent): void {
      const stamped: DiagnosticEvent = { ...event, timestamp: now() };
      const line = `[smooth-task] ${stamped.code} — ${stamped.message}`;
      switch (stamped.level) {
        case 'error':
          console.error(line, stamped);
          break;
        case 'warn':
          console.warn(line, stamped);
          break;
        case 'info':
          console.info(line, stamped);
          break;
        case 'debug':
        default:
          console.debug(line, stamped);
          break;
      }
    },
  };
}
