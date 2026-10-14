/**
 * Diagnostics contracts — LOCKED. Shared by core, navigation and react layers.
 */

export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DiagnosticEvent {
  level: DiagnosticLevel;
  /**
   * Stable machine-readable code, e.g.:
   * 'task-scheduled' | 'task-started' | 'task-completed' | 'task-failed'
   * | 'task-cancelled' | 'barrier-opened' | 'barrier-closed' | 'stalled-task'
   * | 'missing-provider' | 'missing-adapter' | 'untracked-route'
   */
  code: string;
  message: string;
  scopeId?: string;
  routeKey?: string;
  details?: Record<string, unknown>;
  timestamp: number;
}

export type DiagnosticListener = (event: DiagnosticEvent) => void;

/** Anything that can receive diagnostic events. */
export interface DiagnosticsSink {
  emit(event: DiagnosticEvent): void;
}

/** Sink + subscription support. */
export interface Diagnostics extends DiagnosticsSink {
  subscribe(listener: DiagnosticListener): () => void;
}

/** Collector interface for tests and dev tooling. */
export interface DiagnosticsCollector extends Diagnostics {
  readonly events: readonly DiagnosticEvent[];
  clear(): void;
}

/**
 * Create a diagnostics collector that stores every event.
 * `now` is injectable for deterministic tests.
 */
export declare function createDiagnosticsCollector(now?: () => number): DiagnosticsCollector;

/** Sink that drops everything. */
export declare const NOOP_DIAGNOSTICS: DiagnosticsSink;

/** Sink that forwards to console methods by level. */
export declare function createConsoleDiagnosticsSink(now?: () => number): DiagnosticsSink;
