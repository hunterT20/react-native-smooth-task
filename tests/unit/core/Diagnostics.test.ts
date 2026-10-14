import {
  NOOP_DIAGNOSTICS,
  createConsoleDiagnosticsSink,
  createDiagnosticsCollector,
} from '../../../src/diagnostics/Diagnostics';
import type { DiagnosticEvent } from '../../../src/diagnostics/types';

const makeEvent = (overrides?: Partial<DiagnosticEvent>): DiagnosticEvent => ({
  level: 'info',
  code: 'test-event',
  message: 'something happened',
  timestamp: -1,
  ...overrides,
});

describe('createDiagnosticsCollector', () => {
  it('stores every emitted event', () => {
    const collector = createDiagnosticsCollector();
    collector.emit(makeEvent({ code: 'a' }));
    collector.emit(makeEvent({ code: 'b' }));
    expect(collector.events).toHaveLength(2);
    expect(collector.events.map((e) => e.code)).toEqual(['a', 'b']);
  });

  it('stamps events with the injected clock', () => {
    let t = 100;
    const collector = createDiagnosticsCollector(() => t);
    collector.emit(makeEvent({ timestamp: 9999 }));
    t = 200;
    collector.emit(makeEvent({ timestamp: 8888 }));
    expect(collector.events.map((e) => e.timestamp)).toEqual([100, 200]);
  });

  it('forwards stamped events to subscribers until unsubscribed', () => {
    const collector = createDiagnosticsCollector(() => 42);
    const seen: DiagnosticEvent[] = [];
    const unsubscribe = collector.subscribe((event) => seen.push(event));

    collector.emit(makeEvent({ code: 'one' }));
    unsubscribe();
    collector.emit(makeEvent({ code: 'two' }));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.code).toBe('one');
    expect(seen[0]?.timestamp).toBe(42);
    // History still records both emissions.
    expect(collector.events).toHaveLength(2);
  });

  it('supports multiple subscribers', () => {
    const collector = createDiagnosticsCollector();
    const a = jest.fn();
    const b = jest.fn();
    collector.subscribe(a);
    collector.subscribe(b);
    collector.emit(makeEvent());
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('clear() empties the stored events', () => {
    const collector = createDiagnosticsCollector();
    collector.emit(makeEvent());
    collector.emit(makeEvent());
    expect(collector.events).toHaveLength(2);
    collector.clear();
    expect(collector.events).toHaveLength(0);
  });
});

describe('NOOP_DIAGNOSTICS', () => {
  it('swallows events without throwing', () => {
    expect(() => NOOP_DIAGNOSTICS.emit(makeEvent())).not.toThrow();
  });
});

describe('createConsoleDiagnosticsSink', () => {
  it('routes events to console methods by level', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    try {
      const sink = createConsoleDiagnosticsSink(() => 7);
      sink.emit(makeEvent({ level: 'error', code: 'task-failed' }));
      sink.emit(makeEvent({ level: 'warn', code: 'stalled-task' }));
      sink.emit(makeEvent({ level: 'info', code: 'info-x' }));
      sink.emit(makeEvent({ level: 'debug', code: 'task-scheduled' }));

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(debugSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0]?.[0])).toContain('task-failed');
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
      infoSpy.mockRestore();
      debugSpy.mockRestore();
    }
  });
});
